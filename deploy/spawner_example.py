#!/usr/bin/env python3
"""
ML 智学平台 —— GPU 机器池 · JupyterLab 开通服务 (Spawner)

部署在**那台 GPU 机器**上。平台为学生开启实验时调用本服务, 本服务在同一台机器上
为每个学生启动一个 **绑定平台分配卡号** 的 JupyterLab 容器, 并返回访问地址。

与旧版的区别(多学生共享一台机器时必须修):
  1. 真实卡号绑定: NVIDIA_VISIBLE_DEVICES = 平台分配的 gpu_indexes (不再随机挑卡)
  2. 资源隔离: 每个容器限制 CPU / 内存 / shm / 进程数, 一个学生跑飞不会拖垮全班
  3. 目录隔离: 每个学生独立 home/work 目录, 互相看不到
  4. 就绪检测: 等 Jupyter 真正可以访问再返回 URL(避免点进去 404)
  5. 卡位互斥: 同一张卡已被占用时拒绝第二次分配(双保险)
  6. 超时自毁: 达到课程时长 + 宽限后由本服务自动销毁, 不再依赖学生手动结束
  7. 秘钥鉴权: 只有平台后端(持有 SPAWNER_SECRET)能调用

安装(在 GPU 机器上执行):
    pip install fastapi uvicorn docker requests
    export SPAWNER_SECRET='换成一段随机字符串'
    export GPU_COUNT=8                 # 本机卡数, 与平台登记的卡数保持一致
    export PLATFORM_HOST=10.0.0.12     # 本机对平台/学生可见的 IP
    uvicorn spawner_example:app --host 0.0.0.0 --port 9000

平台侧 .env.local / 管理端节点配置:
    开通服务地址 = http://<GPU机器IP>:9000
    秘钥 = 与 SPAWNER_SECRET 相同(平台环境变量 SPAWNER_SECRET)

可选环境变量:
    NOTEBOOK_IMAGE     默认 jupyter/scipy-notebook:latest
    CPU_PER_CONTAINER  默认 4
    MEM_PER_CONTAINER  默认 16g
    SHM_SIZE           默认 2g
    PIDS_LIMIT         默认 512
    USERS_DIR          默认 /srv/ml-users      学生目录根
    DATASETS_DIR       可选, 只读挂载到容器 /home/jovyan/datasets
    PORT_RANGE_START   默认 9100
    GRACE_MINUTES      默认 10 (超过课程时长后仍然允许多跑几分钟, 便于收尾)
    STARTUP_TIMEOUT    默认 240 秒
"""

import os
import secrets
import socket
import threading
import time
from pathlib import Path

import docker
import requests
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

# ---------------- 配置 ----------------
SPAWNER_SECRET = os.environ.get("SPAWNER_SECRET", "")
if not SPAWNER_SECRET:
    raise SystemExit(
        "启动失败: 必须设置环境变量 SPAWNER_SECRET(平台与管理端节点配置需保持一致)"
    )

GPU_COUNT = int(os.environ.get("GPU_COUNT", "8"))
NOTEBOOK_IMAGE = os.environ.get("NOTEBOOK_IMAGE", "jupyter/scipy-notebook:latest")
CPU_PER_CONTAINER = float(os.environ.get("CPU_PER_CONTAINER", "4"))
MEM_PER_CONTAINER = os.environ.get("MEM_PER_CONTAINER", "16g")
SHM_SIZE = os.environ.get("SHM_SIZE", "2g")
PIDS_LIMIT = int(os.environ.get("PIDS_LIMIT", "512"))
USERS_DIR = Path(os.environ.get("USERS_DIR", "/srv/ml-users"))
DATASETS_DIR = os.environ.get("DATASETS_DIR", "")
PORT_RANGE_START = int(os.environ.get("PORT_RANGE_START", "9100"))
GRACE_MINUTES = int(os.environ.get("GRACE_MINUTES", "10"))
STARTUP_TIMEOUT = int(os.environ.get("STARTUP_TIMEOUT", "240"))
PUBLIC_HOST = os.environ.get("PLATFORM_HOST", "127.0.0.1")
CONTAINER_PREFIX = "mlp-"

app = FastAPI(title="ML 智学平台 GPU Spawner", version="2.0")
docker_client = docker.from_env()
USERS_DIR.mkdir(parents=True, exist_ok=True)


# ---------------- 请求模型 ----------------
class ProvisionRequest(BaseModel):
    session_id: str
    user_id: str
    user_name: str = ""
    experiment_id: str
    experiment_title: str = ""
    node_name: str = ""
    gpu_indexes: list[int] = Field(default_factory=list)  # 平台分配的卡号
    duration_minutes: int = 120


class TeardownRequest(BaseModel):
    session_id: str | None = None
    container_id: str | None = None


# ---------------- 工具函数 ----------------
def require_secret(x_spawner_secret: str | None) -> None:
    if not x_spawner_secret or not secrets.compare_digest(
        x_spawner_secret, SPAWNER_SECRET
    ):
        raise HTTPException(status_code=401, detail="spawner 秘钥校验失败")


def container_name(session_id: str) -> str:
    return f"{CONTAINER_PREFIX}{session_id.replace('-', '')[:16]}"


def find_container(session_id: str):
    try:
        return docker_client.containers.get(container_name(session_id))
    except docker.errors.NotFound:
        return None


def port_in_use(port: int) -> bool:
    """检查端口是否已被本机进程或已有容器占用"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.3)
        if s.connect_ex(("127.0.0.1", port)) == 0:
            return True
    for c in docker_client.containers.list():
        for bindings in (c.attrs.get("NetworkSettings", {}).get("Ports") or {}).values():
            for b in bindings or []:
                if str(b.get("HostPort")) == str(port):
                    return True
    return False


def allocate_port() -> int:
    port = PORT_RANGE_START
    while port < PORT_RANGE_START + 200:
        if not port_in_use(port):
            return port
        port += 1
    raise HTTPException(status_code=503, detail="本机没有可用端口")


def gpu_busy(gpu_index: int) -> bool:
    """该卡是否已被某个运行中的平台容器占用(双保险, 平台侧已做卡位分配)"""
    for c in docker_client.containers.list(all=False):
        if not (c.name or "").startswith(CONTAINER_PREFIX):
            continue
        if str(c.labels.get("mlp-gpu-index")) == str(gpu_index):
            return True
    return False


def running_count() -> int:
    return len(
        [c for c in docker_client.containers.list(all=False) if (c.name or "").startswith(CONTAINER_PREFIX)]
    )


def jupyter_ready(port: int, token: str) -> bool:
    try:
        r = requests.get(
            f"http://127.0.0.1:{port}/api",
            headers={"Authorization": f"token {token}"},
            timeout=2,
        )
        return r.status_code == 200
    except requests.RequestException:
        return False


def prepare_user_dir(user_id: str) -> Path:
    """每个学生独立工作目录, 并放开权限给容器内 jovyan(uid 1000)"""
    work = USERS_DIR / user_id.replace("-", "")[:32] / "work"
    work.mkdir(parents=True, exist_ok=True)
    try:
        os.chown(work, 1000, 100)  # jovyan
        os.chown(work.parent, 1000, 100)
    except PermissionError:
        os.chmod(work, 0o777)
        os.chmod(work.parent, 0o777)
    return work


def start_container(req: ProvisionRequest, gpu_indexes: list[int]) -> dict:
    port = allocate_port()
    token = secrets.token_hex(16)
    expires_at = int(time.time()) + (req.duration_minutes + GRACE_MINUTES) * 60
    work_dir = prepare_user_dir(req.user_id)

    volumes = {str(work_dir): {"bind": "/home/jovyan/work", "mode": "rw"}}
    if DATASETS_DIR and Path(DATASETS_DIR).is_dir():
        volumes[DATASETS_DIR] = {"bind": "/home/jovyan/datasets", "mode": "ro"}

    device_request = docker.types.DeviceRequest(
        device_ids=[str(i) for i in gpu_indexes], capabilities=[["gpu"]]
    )

    container = docker_client.containers.run(
        NOTEBOOK_IMAGE,
        detach=True,
        name=container_name(req.session_id),
        ports={"8888/tcp": port},
        environment={
            "JUPYTER_ENABLE_LAB": "yes",
            "JUPYTER_TOKEN": token,
            "GRANT_SUDO": "no",
            "NB_USER": "jovyan",
        },
        volumes=volumes,
        device_requests=[device_request],
        # —— 资源隔离: 防止单个学生拖垮整台机器 ——
        nano_cpus=int(CPU_PER_CONTAINER * 1e9),
        mem_limit=MEM_PER_CONTAINER,
        memswap_limit=MEM_PER_CONTAINER,
        shm_size=SHM_SIZE,
        pids_limit=PIDS_LIMIT,
        # —— 便于平台对账/回收 ——
        labels={
            "mlp-session": req.session_id,
            "mlp-user": req.user_id,
            "mlp-experiment": req.experiment_id,
            "mlp-gpu-index": ",".join(str(i) for i in gpu_indexes),
            "mlp-port": str(port),
            "mlp-token": token,
            "mlp-expires-at": str(expires_at),
        },
        restart_policy={"Name": "no"},
    )

    # 等待 Jupyter 真正就绪, 再返回 URL
    deadline = time.time() + STARTUP_TIMEOUT
    while time.time() < deadline:
        container.reload()
        if container.status not in ("running", "created"):
            logs = container.logs(tail=40).decode("utf-8", "ignore")
            container.remove(force=True)
            raise HTTPException(
                status_code=500, detail=f"容器启动失败: {logs[-600:]}"
            )
        if container.status == "running" and jupyter_ready(port, token):
            break
        time.sleep(2)
    else:
        container.remove(force=True)
        raise HTTPException(
            status_code=504,
            detail=f"Jupyter 在 {STARTUP_TIMEOUT}s 内未就绪, 请联系管理员检查镜像",
        )

    return {
        "url": f"http://{PUBLIC_HOST}:{port}/lab?token={token}",
        "container_id": container.short_id,
        "port": port,
        "token": token,
        "gpu_indexes": gpu_indexes,
        "expires_at": expires_at,
    }


# ---------------- 接口 ----------------
@app.get("/healthz")
def healthz():
    """平台/管理员用来确认这台机器能否接活"""
    info = {"ok": True, "gpu_count": GPU_COUNT, "running": running_count()}
    try:
        out = docker_client.containers.run(
            NOTEBOOK_IMAGE, "nvidia-smi -L", remove=True,
            device_requests=[docker.types.DeviceRequest(count=-1, capabilities=[["gpu"]])],
        )
        info["gpus"] = out.decode("utf-8", "ignore").strip().splitlines()
    except Exception as e:  # noqa: BLE001
        info["ok"] = False
        info["gpus"] = [f"nvidia-smi 不可用: {e}"]
    return info


@app.post("/provision")
def provision(req: ProvisionRequest, x_spawner_secret: str | None = Header(default=None)):
    """为一个学生会话启动 JupyterLab 容器(幂等)"""
    require_secret(x_spawner_secret)

    existing = find_container(req.session_id)
    if existing is not None:
        existing.reload()
        if existing.status == "running":
            labels = existing.labels
            return {
                "url": f"http://{PUBLIC_HOST}:{labels.get('mlp-port')}/lab?token={labels.get('mlp-token')}",
                "container_id": existing.short_id,
                "port": int(labels.get("mlp-port", 0)),
                "reused": True,
                "gpu_indexes": [
                    int(i) for i in (labels.get("mlp-gpu-index") or "").split(",") if i != ""
                ],
                "expires_at": int(labels.get("mlp-expires-at", 0)),
            }
        existing.remove(force=True)

    gpu_indexes = req.gpu_indexes or []
    if not gpu_indexes:
        raise HTTPException(status_code=400, detail="请求缺少 gpu_indexes(平台未分配卡号)")
    for idx in gpu_indexes:
        if idx < 0 or idx >= GPU_COUNT:
            raise HTTPException(status_code=400, detail=f"卡号 {idx} 超出本机范围 0..{GPU_COUNT - 1}")
        if gpu_busy(idx):
            raise HTTPException(status_code=409, detail=f"卡 {idx} 已被占用, 请平台重新分配")
    if running_count() >= GPU_COUNT:
        raise HTTPException(status_code=503, detail="本机容器数已达卡数上限")

    return start_container(req, gpu_indexes)


@app.post("/teardown")
def teardown(req: TeardownRequest, x_spawner_secret: str | None = Header(default=None)):
    """停止并删除容器(立即释放卡)"""
    require_secret(x_spawner_secret)
    container = find_container(req.session_id) if req.session_id else None
    if container is None and req.container_id:
        try:
            container = docker_client.containers.get(req.container_id)
        except docker.errors.NotFound:
            return {"ok": True, "already_gone": True}
    if container is None:
        return {"ok": True, "already_gone": True}
    container.remove(force=True)
    return {"ok": True}


@app.get("/status/{session_id}")
def status(session_id: str, x_spawner_secret: str | None = Header(default=None)):
    require_secret(x_spawner_secret)
    c = find_container(session_id)
    if c is None:
        return {"running": False}
    c.reload()
    return {
        "running": c.status == "running",
        "container_id": c.short_id,
        "gpu_indexes": [
            int(i) for i in (c.labels.get("mlp-gpu-index") or "").split(",") if i != ""
        ],
        "expires_at": int(c.labels.get("mlp-expires-at", 0)),
        "url": f"http://{PUBLIC_HOST}:{c.labels.get('mlp-port')}/lab?token={c.labels.get('mlp-token')}",
    }


@app.post("/gc")
def gc(x_spawner_secret: str | None = Header(default=None)):
    """手动触发一次回收(平台定时任务也会调用)"""
    require_secret(x_spawner_secret)
    return {"removed": sweep(verbose=True)}


def sweep(verbose: bool = False) -> int:
    """销毁超过 expires_at 的容器"""
    removed = 0
    now = int(time.time())
    for c in docker_client.containers.list(all=False):
        if not (c.name or "").startswith(CONTAINER_PREFIX):
            continue
        try:
            expires_at = int(c.labels.get("mlp-expires-at", "0"))
        except ValueError:
            expires_at = 0
        # 没有过期标记的容器(异常遗留)也给 12 小时兜底
        try:
            created = int(
                time.mktime(time.strptime(c.attrs["Created"][:19], "%Y-%m-%dT%H:%M:%S"))
            )
        except (KeyError, ValueError):
            created = now
        deadline = expires_at if expires_at > 0 else created + 12 * 3600
        if now > deadline:
            if verbose:
                print(f"[gc] 回收 {c.name} (session={c.labels.get('mlp-session')})")
            try:
                c.remove(force=True)
                removed += 1
            except docker.errors.APIError as e:  # noqa: BLE001
                print(f"[gc] 回收失败 {c.name}: {e}")
    return removed


def reaper_loop() -> None:
    """后台线程: 每 30 秒清理一次超时容器, 保证卡不会被永久占用"""
    while True:
        try:
            sweep()
        except Exception as e:  # noqa: BLE001
            print(f"[reaper] 异常: {e}")
        time.sleep(30)


@app.on_event("startup")
def _start_reaper() -> None:
    threading.Thread(target=reaper_loop, daemon=True).start()
    print(f"[spawner] 就绪: 卡数={GPU_COUNT} 镜像={NOTEBOOK_IMAGE} "
          f"端口={PORT_RANGE_START}起 时长宽限={GRACE_MINUTES}分钟")
