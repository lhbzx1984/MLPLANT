# 一台 GPU 机器带一个班 —— 部署与使用指南

适用场景:只有 1 台(或几台)GPU 机器,要给一个班的学生分配算力上课。
不需要接云厂商 API,机器可以是从矩池云/九章云按周或按月租的,也可以是学校自己的服务器。

## 原理

```
学生点「开启实验」→ 平台从卡位池挑一张空闲卡 → 调用机器上的 spawner
   → spawner 启动容器, NVIDIA_VISIBLE_DEVICES=分配的卡号
   → 等 Jupyter 就绪 → 返回 http://机器IP:端口/lab?token=xxx
   → 学生直接用浏览器做实验
学生点「结束」/ 到点 → spawner 销毁容器 → 平台释放卡位
```

- **8 卡机器 = 8 个并发学生**,第 9 个人会看到「算力已满 8/8」,等有人结束即可
- 每个学生:独占一张卡、独立目录、独立 token、独立的 CPU/内存配额
- 一个学生跑飞(死循环、吃满显存)不会影响其他人
- 到点自动销毁,不会漏计费

## 一、GPU 机器准备

```bash
# 1. 驱动与容器运行时
nvidia-smi                      # 确认能看到所有卡
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi   # 确认 GPU 可用

# 2. 预拉镜像(第一次会慢,建议提前拉好)
docker pull jupyter/scipy-notebook:latest

# 3. 学生工作目录
sudo mkdir -p /srv/ml-users
```

如果要预装 sklearn / pandas / torch 等课程依赖,建议自建镜像并固定版本——这样「预期输出比对」才稳定:

```dockerfile
FROM jupyter/scipy-notebook:latest
RUN pip install --no-cache-dir scikit-learn==1.5.0 pandas==2.2.2 torch==2.3.1
```

> 自建镜像后,把 spawner 的 `NOTEBOOK_IMAGE` 环境变量指向你的镜像名。

## 二、在 GPU 机器上启动 spawner

```bash
pip install fastapi uvicorn docker requests

export SPAWNER_SECRET='换成一串随机字符串'   # 平台侧要填一样的
export GPU_COUNT=8                          # 本机卡数
export PLATFORM_HOST=192.168.1.50           # 学生浏览器能访问的机器 IP
export NOTEBOOK_IMAGE='jupyter/scipy-notebook:latest'
export CPU_PER_CONTAINER=4                  # 每人 4 核
export MEM_PER_CONTAINER=16g                # 每人 16G 内存
export SHM_SIZE=2g                          # PyTorch DataLoader 必需

uvicorn spawner_example:app --host 0.0.0.0 --port 9000
```

开机自启(可选):

```ini
# /etc/systemd/system/ml-spawner.service
[Unit]
Description=ML Platform GPU Spawner
After=docker.service

[Service]
ExecStart=/usr/local/bin/uvicorn spawner_example:app --host 0.0.0.0 --port 9000
Environment=SPAWNER_SECRET=你的秘钥
Environment=GPU_COUNT=8
Environment=PLATFORM_HOST=192.168.1.50
Environment=WORKDIR=/opt/ml-spawner
WorkingDirectory=/opt/ml-spawner
Restart=always

[Install]
WantedBy=multi-user.target
```

自检:

```bash
curl http://127.0.0.1:9000/healthz
# {"ok":true,"gpu_count":8,"running":0,"gpus":["GPU 0: NVIDIA A100 ..."]}
```

## 三、平台侧配置(`.env.local`)

```ini
# spawner 秘钥(与机器上的 SPAWNER_SECRET 完全一致)
SPAWNER_SECRET=换成一串随机字符串
# 定时回收接口的调用秘钥
CRON_SECRET=另一串随机字符串
```

改完重启平台:`Ctrl+C` 后 `npm run start`。

## 四、管理端登记这台机器

1. 登录管理员 →「GPU 资源池」→「接入 GPU 节点」
2. 填写:
   - 节点名称:`教学楼-8卡-A100`
   - **卡数:8**(必须与机器实际卡数一致)
   - **开通服务地址(Spawner):**`http://192.168.1.50:9000`
   - Jupyter 网关地址:留空(用了 spawner 就不需要)
3. 保存后卡片上会显示 Spawner 地址;状态保持「在线」

> 如果同学期有两台机器,登记两个节点,「实验绑定节点」时选「自动分配」即可按空闲度分配。

## 五、教师配置实验

教师 →「我的课程」→ 课程详情 →「开设实验」:

- **需要 GPU**:选「需要」
- **GPU 卡数**:1(一人一卡)
- **会话时长**:按课时填,如 120 分钟
- **运行节点**:选刚登记的节点,或「自动分配」

## 六、学生上课的体验

1. 打开实验页,「实验环境」区域会显示 **当前 3/8 卡占用,剩余 5 个位置**
2. 点「开启实验会话」→ 首次启动约 10~40 秒(镜像已预拉的情况下)
3. 进入 JupyterLab,右上角显示 **⏳ 剩余 1:58:32**,最后 5 分钟变红
4. 做完点「结束会话并释放 GPU」,卡位立刻给下一个同学
5. 忘记结束也没关系:到点后平台 cron + spawner 自毁,双保险回收

## 七、定时回收(强烈建议配置)

平台侧每 5 分钟跑一次,回收超时会话、清理残留卡位:

```bash
# crontab -e
*/5 * * * * curl -s -X POST http://127.0.0.1:3000/api/cron/reap -H "x-cron-secret: 你的CRON_SECRET" > /dev/null
```

也可以管理员在浏览器直接调用(需已登录管理员)。手工触发一次:

```bash
curl -X POST http://127.0.0.1:3000/api/cron/reap -H "x-cron-secret: 你的CRON_SECRET"
# {"ok":true,"checkedRunning":3,"stoppedSessions":[],"releasedAllocations":0,...}
```

## 八、扩容与排队

| 情况 | 表现 | 处理 |
|------|------|------|
| 学生数 > 卡数 | 后到的学生看到「算力已满 8/8」 | 等同学结束;或错峰;或加卡 |
| 一个学生想开两个实验 | 提示「你已有进行中的实验会话」 | 先结束当前会话(防止一人占多卡) |
| 机器临时离线 | 学生开启时报「无法连接开通服务」 | 检查 spawner 是否运行、地址/秘钥是否正确 |
| 容器起不来 | 返回容器日志片段 | 通常是镜像名错、显存不足或 shm 太小 |

## 十、矩池云等容器实例(无 Docker)怎么跑

矩池云/九章云按容器出租的实例通常**没有 Docker 守护进程**,请改用进程版 `spawner_process.py`(HTTP 契约与 Docker 版完全一致,平台无需改动)。

```bash
# 1) 从 Windows 上传(在 D:\ml 目录执行; 主机与端口填你控制台上的)
scp -P 29920 deploy/spawner_process.py root@hz-4.matpool.com:/root/

# 2) 机器上装依赖(矩池云镜像一般已自带 jupyterlab)
pip install fastapi uvicorn requests
python -c "import jupyterlab; print('jupyterlab ok')"
nvidia-smi -L | wc -l          # 这个数字就是 GPU_COUNT

# 3) 启动
export SPAWNER_SECRET='与平台 .env.local 中一致'
export GPU_COUNT=8
export PLATFORM_HOST=公网可访问的主机或IP
export CPU_PER_CONTAINER=2
python -m uvicorn spawner_process:app --host 0.0.0.0 --port 9000
```

**端口导出是硬前提**:平台要能访问 `9000`,学生浏览器要能访问 `9100 ~ 9100+N-1`。
在矩池云控制台的「端口导出」里配置;如果只能开少量端口,把 `GPU_COUNT` 调小
(例如导出 9000 与 9100-9102 → 同时支持 3 名学生)。

本地自测(不需要外网端口就能验证整条链路):

```bash
curl -s localhost:9000/healthz -H "X-Spawner-Secret: $SPAWNER_SECRET"
curl -s -X POST localhost:9000/provision \
  -H "Content-Type: application/json" -H "X-Spawner-Secret: $SPAWNER_SECRET" \
  -d '{"session_id":"t1","user_id":"u1","experiment_id":"e1","gpu_indexes":[0],"duration_minutes":30}'
nvidia-smi                       # 应看到 python 进程占用了卡 0
curl -s -X POST localhost:9000/teardown \
  -H "Content-Type: application/json" -H "X-Spawner-Secret: $SPAWNER_SECRET" \
  -d '{"session_id":"t1"}'
```

## 九、常见问题

**Q: 学生点进去是 404 / 连接被拒绝?**
检查 `PLATFORM_HOST` 是否是学生浏览器能访问的 IP(不是 127.0.0.1),以及机器防火墙是否放开 9100-9300 端口段。

**Q: `healthz` 里 gpus 显示 nvidia-smi 不可用?**
没装 NVIDIA Container Toolkit,或 Docker 未配置 GPU 默认运行时。

**Q: 学生说"卡住了"?**
进机器 `docker stats` 看该容器 CPU/内存是否打满;必要时教师端「结束并释放 GPU」强制回收。

**Q: 想限制每人显存?**
`NVIDIA_VISIBLE_DEVICES` 只能整卡隔离;要更细粒度需用 MIG(A100/H100)并对每个 MIG 实例单独建容器。

**Q: 一台机器能带多少人?**
8 卡 = 8 个并发。轻量实验(sklearn/数据分析)可以在 spawner 里把 `CPU_PER_CONTAINER` 调小、并让多个学生共享一张卡(把 `experiment.gpu_count` 设为 0 走 CPU 模式),但深度学习实验建议一人一卡。
