#!/usr/bin/env python3
"""
ML 智学平台 —— GPU 机器池 · JupyterLab 开通服务 (无 Docker / 进程模式)

适用场景: 矩池云、九章云等**按容器出租**的 GPU 实例, 或者任何拿不到 Docker
守护进程的环境。本服务直接用子进程为每个学生起一个 JupyterLab, 不依赖 Docker。

与 Docker 版 (spawner_example.py) 的 HTTP 契约完全一致, 平台侧无需改动:
    GET  /healthz
    POST /provision    {session_id, user_id, experiment_id, gpu_indexes, duration_minutes, ...}
    POST /teardown     {session_id}
    GET  /status/{session_id}
    POST /gc

每个学生获得:
    - 独立端口、独立 token、独立 root_dir (互相看不到文件)
    - CUDA_VISIBLE_DEVICES=<平台分配的卡号>  (真正的卡隔离)
    - CPU 亲和性绑定(每人不抢同一批核)、内存软上限(超限自动回收)
    - 到期自动 kill(后台线程 + /gc)

安装(在 GPU 机器上执行):
    pip install fastapi uvicorn requests
    pip install jupyterlab scikit-learn pandas matplotlib    # 按课程需要

    export SPAWNER_SECRET='与平台一致的随机字符串'
    export GPU_COUNT=1                  # 本机卡数
    export PLATFORM_HOST=10.0.0.12      # 学生浏览器能访问到的 IP/域名
    export SPAWNER_MODE=process
    python -m uvicorn spawner_process:app --host 0.0.0.0 --port 9000

可选环境变量:
    CPU_PER_CONTAINER   每人绑定几个核, 默认 2
    MEM_PER_CONTAINER   每人内存软上限, 默认 16g (超过 1.2 倍由后台线程 kill)
    USERS_DIR           学生目录根, 默认 /srv/ml-users
    DATASETS_DIR        可选, 每人目录下软链接到 datasets
    PORT_RANGE_START    默认 9100
    GRACE_MINUTES       超时宽限, 默认 10 分钟
    STARTUP_TIMEOUT     默认 120 秒
    STATE_FILE          进程状态文件, 默认 /var/lib/ml-spawner/state.json

⚠️ 端口可达性: 学生浏览器要能访问 9100 ~ 9100+卡数 这些端口。
   矩池云租用时请在「高级设置 → 端口」里把这些端口加上; 如果只能开一个端口,
   请改用 spawner_proxy.py(单端口 + 路径前缀反代)。
"""

import json
import os
import re
import shutil
import signal
import socket
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path

import requests
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# ---------------- 配置 ----------------
SPAWNER_SECRET = os.environ.get("SPAWNER_SECRET", "")
if not SPAWNER_SECRET:
    raise SystemExit(
        "启动失败: 必须设置环境变量 SPAWNER_SECRET(与平台 .env.local 中一致)"
    )

GPU_COUNT = int(os.environ.get("GPU_COUNT", "1"))
CPU_PER_CONTAINER = int(os.environ.get("CPU_PER_CONTAINER", "2"))
MEM_PER_CONTAINER = os.environ.get("MEM_PER_CONTAINER", "16g")
USERS_DIR = Path(os.environ.get("USERS_DIR", "/srv/ml-users"))
DATASETS_DIR = os.environ.get("DATASETS_DIR", "")
PORT_RANGE_START = int(os.environ.get("PORT_RANGE_START", "9100"))
GRACE_MINUTES = int(os.environ.get("GRACE_MINUTES", "10"))
STARTUP_TIMEOUT = int(os.environ.get("STARTUP_TIMEOUT", "120"))
PUBLIC_HOST = os.environ.get("PLATFORM_HOST", "127.0.0.1")
STATE_FILE = Path(os.environ.get("STATE_FILE", "/var/lib/ml-spawner/state.json"))

app = FastAPI(title="ML 智学平台 GPU Spawner (process mode)", version="1.0")
_state_lock = threading.Lock()
USERS_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE.parent.mkdir(parents=True, exist_ok=True)


# ---------------- 工具 ----------------
def require_secret(x_spawner_secret: str | None) -> None:
    if not x_spawner_secret or not secrets.compare_digest(x_spawner_secret, SPAWNER_SECRET):
        raise HTTPException(status_code=401, detail="spawner 秘钥校验失败")


def parse_size(text: str) -> int:
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$", text.lower())
    if not m:
        return 16 * 1024**3
    mult = {"": 1, "k": 1024, "m": 1024**2, "g": 1024**3, "t": 1024**4}
    return int(float(m.group(1)) * mult[m.group(2)])


MEM_LIMIT_BYTES = parse_size(MEM_PER_CONTAINER)


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(STATE_FILE)


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def port_free(port: int, state: dict) -> bool:
    for e in state.values():
        if int(e.get("port", 0)) == port:
            return False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def allocate_port(state: dict) -> int:
    for port in range(PORT_RANGE_START, PORT_RANGE_START + 200):
        if port_free(port, state):
            return port
    raise HTTPException(status_code=503, detail="本机没有可用端口")


def cpu_set_for(gpu_index: int) -> set[int] | None:
    """把可用的 CPU 核按卡号切段, 避免多个学生抢同一批核"""
    try:
        allowed = sorted(os.sched_getaffinity(0))
    except AttributeError:
        return None
    if not allowed:
        return None
    per = max(1, CPU_PER_CONTAINER)
    start = (gpu_index % max(1, GPU_COUNT)) * per
    picked = [allowed[i % len(allowed)] for i in range(start, start + per)]
    return set(picked)


def gpu_busy(gpu_index: int, state: dict) -> bool:
    for e in state.values():
        if str(gpu_index) in [str(i) for i in e.get("gpu_indexes", [])] and pid_alive(
            int(e.get("pid", 0))
        ):
            return True
    return False


def jupyter_cmd(port: int, token: str, root_dir: Path) -> list[str]:
    """
    优先用**当前解释器**的 jupyter(保证与 spawner 同一 Python 环境,
    学生在里面才能 import 到本环境安装的 sklearn/pandas);
    退回 PATH 里的 jupyter 可执行文件。
    """
    try:
        probe = subprocess.run(
            [sys.executable, "-m", "jupyter", "--version"],
            capture_output=True, timeout=30,
        )
        if probe.returncode == 0:
            base = [sys.executable, "-m", "jupyter", "lab"]
        else:
            raise FileNotFoundError
    except (FileNotFoundError, subprocess.SubprocessError):
        jupyter = shutil.which("jupyter")
        if not jupyter:
            raise HTTPException(
                status_code=500,
                detail="未找到 jupyter:请在启动 spawner 的同一个环境里 pip install jupyterlab",
            ) from None
        base = [jupyter, "lab"]
    return base + [
        "--no-browser",
        "--ip=0.0.0.0",
        f"--port={port}",
        f"--ServerApp.token={token}",
        "--ServerApp.password=",
        "--ServerApp.allow_root=True",
        "--ServerApp.allow_remote_access=True",
        "--ServerApp.shutdown_no_activity_timeout=0",
        "--ServerApp.disable_check_xsrf=False",
        f"--ServerApp.root_dir={root_dir}",
    ]


def wait_ready(port: int, token: str, proc: subprocess.Popen, timeout: int) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            r = requests.get(
                f"http://127.0.0.1:{port}/api",
                headers={"Authorization": f"token {token}"},
                timeout=2,
            )
            if r.status_code == 200:
                return True
        except requests.RequestException:
            pass
        time.sleep(1.5)
    return False


def kill_tree(pid: int) -> None:
    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    for _ in range(16):
        if not pid_alive(pid):
            return
        time.sleep(0.5)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def rss_bytes(pid: int) -> int:
    try:
        out = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True, text=True, timeout=5,
        ).stdout.strip()
        return int(out) * 1024 if out else 0
    except (subprocess.SubprocessError, ValueError):
        return 0


def prepare_dirs(user_id: str) -> Path:
    root = USERS_DIR / user_id.replace("-", "")[:32]
    work = root / "work"
    for p in (root, work):
        p.mkdir(parents=True, exist_ok=True)
    for sub in ("jupyter-config", "jupyter-data", "jupyter-runtime"):
        (root / sub).mkdir(exist_ok=True)
    if DATASETS_DIR and Path(DATASETS_DIR).is_dir():
        link = root / "datasets"
        if not link.exists():
            try:
                link.symlink_to(DATASETS_DIR, target_is_directory=True)
            except OSError:
                pass
    return work


# ---------------- 请求模型 ----------------
class ProvisionRequest(BaseModel):
    session_id: str
    user_id: str
    user_name: str = ""
    experiment_id: str
    experiment_title: str = ""
    node_name: str = ""
    gpu_indexes: list[int] = Field(default_factory=list)
    duration_minutes: int = 120


class TeardownRequest(BaseModel):
    session_id: str | None = None


# ---------------- 接口 ----------------
@app.get("/healthz")
def healthz():
    info = {
        "ok": True,
        "mode": "process",
        "gpu_count": GPU_COUNT,
        "running": sum(1 for e in load_state().values() if pid_alive(int(e.get("pid", 0)))),
        "host": PUBLIC_HOST,
        "port_range": [PORT_RANGE_START, PORT_RANGE_START + GPU_COUNT - 1],
    }
    try:
        info["gpus"] = subprocess.run(
            ["nvidia-smi", "-L"], capture_output=True, text=True, timeout=10
        ).stdout.strip().splitlines()
    except (subprocess.SubprocessError, FileNotFoundError) as e:
        info["ok"] = False
        info["gpus"] = [f"nvidia-smi 不可用: {e}"]
    try:
        info["jupyter"] = shutil.which("jupyter") or f"{sys.executable} -m jupyterlab"
    except Exception:  # noqa: BLE001
        info["jupyter"] = None
    return info


@app.post("/provision")
def provision(req: ProvisionRequest, x_spawner_secret: str | None = Header(default=None)):
    require_secret(x_spawner_secret)

    with _state_lock:
        state = load_state()

        # 幂等: 同一会话已在运行则直接复用
        existing = state.get(req.session_id)
        if existing and pid_alive(int(existing.get("pid", 0))):
            return {
                "url": f"http://{PUBLIC_HOST}:{existing['port']}/lab?token={existing['token']}",
                "pid": existing["pid"],
                "port": existing["port"],
                "reused": True,
                "gpu_indexes": existing.get("gpu_indexes", []),
                "expires_at": existing.get("expires_at", 0),
            }

        gpu_indexes = req.gpu_indexes or []
        if not gpu_indexes:
            raise HTTPException(status_code=400, detail="请求缺少 gpu_indexes(平台未分配卡号)")
        for idx in gpu_indexes:
            if idx < 0 or idx >= GPU_COUNT:
                raise HTTPException(
                    status_code=400,
                    detail=f"卡号 {idx} 超出本机范围 0..{GPU_COUNT - 1}(检查 GPU_COUNT 环境变量)",
                )
            if gpu_busy(idx, state):
                raise HTTPException(status_code=409, detail=f"卡 {idx} 已被占用, 请平台重新分配")

        alive = {k: v for k, v in state.items() if pid_alive(int(v.get("pid", 0)))}
        if len(alive) >= GPU_COUNT:
            raise HTTPException(status_code=503, detail="本机实例数已达卡数上限")

        port = allocate_port(state)
        token = secrets.token_hex(16)
        work_dir = prepare_dirs(req.user_id)
        root = work_dir.parent
        expires_at = int(time.time()) + (req.duration_minutes + GRACE_MINUTES) * 60

        env = os.environ.copy()
        env["CUDA_VISIBLE_DEVICES"] = ",".join(str(i) for i in gpu_indexes)
        env["JUPYTER_CONFIG_DIR"] = str(root / "jupyter-config")
        env["JUPYTER_DATA_DIR"] = str(root / "jupyter-data")
        env["JUPYTER_RUNTIME_DIR"] = str(root / "jupyter-runtime")
        env["JUPYTER_PLATFORM_DIRS"] = "1"
        env["OPENBLAS_NUM_THREADS"] = "1"  # 防止 8 个学生各开满线程把机器打满

        preexec = None
        cpus = cpu_set_for(gpu_indexes[0])
        if cpus:
            def preexec() -> None:  # type: ignore[misc]
                os.setsid()
                try:
                    os.sched_setaffinity(0, cpus)
                except OSError:
                    pass
        else:
            def preexec() -> None:  # type: ignore[misc]
                os.setsid()

        log_file = root / "jupyter.log"
        with open(log_file, "ab") as log:
            proc = subprocess.Popen(
                jupyter_cmd(port, token, work_dir),
                stdout=log, stderr=subprocess.STDOUT,
                env=env, preexec_fn=preexec, cwd=str(work_dir),
            )

        if not wait_ready(port, token, proc, STARTUP_TIMEOUT):
            tail = ""
            try:
                tail = log_file.read_text("utf-8", "ignore")[-800:]
            except OSError:
                pass
            kill_tree(proc.pid)
            raise HTTPException(
                status_code=504,
                detail=f"Jupyter 启动失败或超时(检查 jupyterlab 是否安装)。日志尾部: {tail}",
            )

        state[req.session_id] = {
            "session_id": req.session_id,
            "user_id": req.user_id,
            "experiment_id": req.experiment_id,
            "gpu_indexes": gpu_indexes,
            "port": port,
            "token": token,
            "pid": proc.pid,
            "root_dir": str(root),
            "started_at": int(time.time()),
            "expires_at": expires_at,
            "cpu_set": sorted(cpus) if cpus else None,
        }
        save_state(state)

    return {
        "url": f"http://{PUBLIC_HOST}:{port}/lab?token={token}",
        "pid": proc.pid,
        "port": port,
        "token": token,
        "gpu_indexes": gpu_indexes,
        "expires_at": expires_at,
    }


@app.post("/teardown")
def teardown(req: TeardownRequest, x_spawner_secret: str | None = Header(default=None)):
    require_secret(x_spawner_secret)
    if not req.session_id:
        raise HTTPException(status_code=400, detail="缺少 session_id")

    with _state_lock:
        state = load_state()
        entry = state.pop(req.session_id, None)
        save_state(state)

    if not entry:
        return {"ok": True, "already_gone": True}
    kill_tree(int(entry["pid"]))
    return {"ok": True}


@app.get("/status/{session_id}")
def status(session_id: str, x_spawner_secret: str | None = Header(default=None)):
    require_secret(x_spawner_secret)
    entry = load_state().get(session_id)
    if not entry:
        return {"running": False}
    alive = pid_alive(int(entry["pid"]))
    return {
        "running": alive,
        "port": entry["port"],
        "gpu_indexes": entry.get("gpu_indexes", []),
        "expires_at": entry.get("expires_at", 0),
        "rss_mb": round(rss_bytes(int(entry["pid"])) / 1024**2) if alive else 0,
        "url": (
            f"http://{PUBLIC_HOST}:{entry['port']}/lab?token={entry['token']}" if alive else None
        ),
    }


@app.post("/gc")
def gc(x_spawner_secret: str | None = Header(default=None)):
    require_secret(x_spawner_secret)
    return {"removed": sweep(verbose=True)}


def sweep(verbose: bool = False) -> int:
    """回收: 超时 / 进程已死 / 内存超软上限"""
    with _state_lock:
        state = load_state()
        removed = 0
        now = int(time.time())
        for sid, entry in list(state.items()):
            pid = int(entry.get("pid", 0))
            reason = None
            if not pid_alive(pid):
                reason = "进程已退出"
            elif now > int(entry.get("expires_at", 0)):
                reason = "会话超时"
            else:
                mem = rss_bytes(pid)
                if mem > MEM_LIMIT_BYTES * 1.2:
                    reason = f"内存超限 {round(mem / 1024**3, 1)}G > {MEM_PER_CONTAINER}"
            if reason:
                if verbose:
                    print(f"[gc] 回收 {sid}: {reason}")
                kill_tree(pid)
                state.pop(sid, None)
                removed += 1
        save_state(state)
    return removed


def reaper_loop() -> None:
    while True:
        try:
            sweep()
        except Exception as e:  # noqa: BLE001
            print(f"[reaper] 异常: {e}")
        time.sleep(30)


@app.on_event("startup")
def _startup() -> None:
    # 启动时清理上次进程退出后残留的记录
    sweep()
    threading.Thread(target=reaper_loop, daemon=True).start()
    print(
        f"[spawner-process] 就绪: 卡数={GPU_COUNT} 每人{CPU_PER_CONTAINER}核/{MEM_PER_CONTAINER} "
        f"端口从 {PORT_RANGE_START} 起 上限 {GPU_COUNT} 人"
    )
