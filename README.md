# 🤖 ML 智学平台 — 机器学习教学实验平台

基于 **Next.js + Supabase** 的前后端分离机器学习教学平台。在原「机器学习模型训练平台」
([参考项目](https://github.com/lhbzx1984/ML)) 基本功能之上,扩展了完整的**教学管理**能力:
多角色账号体系、课程平台、实验步骤引导、JupyterLab 实验环境接入、云端 GPU 算力自动分配。

## ✨ 功能总览

### 三种角色

| 角色 | 能力 |
|------|------|
| **管理员** | 开通/禁用教师与学生账号、重置密码;接入云端 GPU 节点;查看平台全部课程与 GPU 分配记录 |
| **教师** | 开设课程(邀请码加入)、上传教学资料、开设实验并编写实验步骤、配置 GPU 需求;实时查看每个学生的步骤完成进度、实验会话与 GPU 占用;批改实验报告 |
| **学生** | 凭邀请码加入课程、下载资料;按教师设定的实验步骤逐步学习(可勾选完成、查看提示);一键开启实验会话(平台自动分配 GPU)进入 JupyterLab;提交实验报告查看评分 |

### GPU 算力分配(后端自动分配)

- 管理员在后台登记云端 GPU 服务器(阿里云 / AutoDL / 自建服务器等),填写节点地址、GPU 型号、卡数;
- 学生开启需要 GPU 的实验时,后端通过数据库级**原子分配**从在线节点中挑选空闲卡,
  占用最低空闲卡号,写入分配记录;
- 会话结束(学生自主结束或教师强制结束)自动释放卡片,释放记录全程可查;
- 教师端可实时查看本课程学生的会话与 GPU 占用,并强制释放。

### JupyterLab 实验环境接入

三种接入方式(按优先级自动选择,详见下文「GPU 服务器接入指南」):

1. **Webhook 开通服务**(推荐,真正的动态容器):平台 POST 实验信息到
   `PROVISION_WEBHOOK_URL`,由部署在 GPU 服务器上的开通服务拉起绑定指定 GPU 的
   JupyterLab 容器,返回访问地址(附完整示例 `deploy/spawner_example.py`);
2. **节点直连**:GPU 节点登记了 `endpoint` 时,直接生成该节点的 JupyterLab 带 token 地址;
3. **平台默认入口**:配置 `NEXT_PUBLIC_DEFAULT_JUPYTER_URL` 作为兜底。

### 在线训练工作台(保留原平台全部基本功能)

浏览器端纯 TypeScript 实现的机器学习训练,无需任何后端:

- **模型**:线性回归、逻辑回归(softmax 多分类)、决策树、随机森林、SVM(hinge loss SGD)、K 近邻、K-Means 聚类
- **数据集**:鸢尾花(真实数据)、三分类合成、房价回归合成、客户分群合成、自定义 CSV 上传
- **可视化**:损失/准确率曲线、混淆矩阵、预测值 vs 实际值散点图、聚类结果图
- **推理**:输入特征即时预测,输出置信度与各类别概率
- **导出**:模型参数 + 训练历史导出 JSON
- 训练记录自动入库,教师可查看学生的训练情况;可作为实验类型(在线训练实验)布置给学生

## 🏗️ 技术架构

```
┌─────────────────────────────┐      ┌──────────────────────────────┐
│   Next.js 14 (App Router)   │      │        Supabase              │
│  ┌───────────────────────┐  │      │  ┌────────────────────────┐  │
│  │ 前端 React + Tailwind │  │ SSR  │  │ Postgres 数据库 + RLS  │  │
│  │ /login /admin /teacher│──┼──────┼─▶│ Auth (JWT 邮箱登录)    │  │
│  │ /student /train       │  │      │  │ Storage (教学资料)     │  │
│  ├───────────────────────┤  │      │  └────────────────────────┘  │
│  │ 后端 API Routes       │  │      │   云端 GPU 服务器(节点)     │
│  │ /api/admin/*  service │──┼──────┼─▶ service_role 特权操作      │
│  │ /api/sessions GPU分配 │──┼──────┼─▶ JupyterLab 开通 Webhook   │
│  └───────────────────────┘  │      │                              │
└─────────────────────────────┘      └──────────────────────────────┘
```

- **前端**:Next.js 14 App Router + TypeScript + Tailwind CSS + Recharts
- **后端**:Supabase(Postgres 数据库 + Auth 认证 + Storage 对象存储)
  - 行级安全(RLS)按角色隔离数据,普通操作由前端直连 Supabase 完成
  - 特权操作(开通账号、GPU 分配)走 Next.js API Routes + service_role 密钥
- **中间件**:`middleware.ts` 统一刷新会话并做角色路径隔离

## 📦 目录结构

```
├── app/
│   ├── login/               # 登录
│   ├── admin/               # 管理端:概览 / 账号管理 / GPU 资源池 / 课程总览
│   ├── teacher/             # 教师端:我的课程 / 课程详情 / 实验详情 / GPU 算力
│   ├── student/             # 学生端:我的课程 / 课程详情 / 实验学习
│   ├── train/               # 在线训练工作台(原平台功能)
│   ├── settings/            # 个人设置(改密码)
│   └── api/
│       ├── admin/users/     # 开通账号 / 禁用 / 重置密码 / 删除 (service_role)
│       ├── admin/stats/     # 平台统计
│       └── sessions/        # 实验会话: 开启(分配GPU+JupyterLab) / 结束(释放GPU)
├── components/AppShell.tsx  # 三端共用框架(侧边栏 + 顶栏)
├── lib/
│   ├── supabase/            # client / server / admin(service_role) 三种客户端
│   ├── auth.ts              # 服务端会话工具
│   └── ml/                  # 内置机器学习库(模型/数据集/训练/推理)
├── supabase/schema.sql      # 数据库表 + RLS 策略 + GPU 分配 RPC(一键执行)
├── deploy/spawner_example.py# JupyterLab 开通服务示例(部署在 GPU 服务器)
├── scripts/create-admin.mjs # 创建首个管理员账号
└── middleware.ts            # 会话刷新 + 角色路由隔离
```

## 🚀 快速开始

### 1. 创建 Supabase 项目

1. 打开 [supabase.com](https://supabase.com) → New Project(免费额度即可);
2. 进入 **SQL Editor**,粘贴并执行 [`supabase/schema.sql`](supabase/schema.sql) 全部内容
   (创建所有表、RLS 策略、GPU 分配函数、`materials` 存储桶);
3. 在 **Project Settings → API** 中拿到三个值:
   - `Project URL`
   - `anon public` 密钥
   - `service_role` 密钥(⚠️ 只能放在服务端)

### 2. 配置并启动

```bash
cp .env.local.example .env.local
# 编辑 .env.local 填入上面三个值

npm install
npm run dev          # http://localhost:3000
```

> **国内网络提示**:若本机无法直连 `*.supabase.co`(症状:Dashboard 打得开但 `npm run dev` 报
> fetch failed / 连接超时),在 `.env.local` 中加一行 `ML_PROXY=http://127.0.0.1:7897`
> (指向你的代理软件端口),`npm run dev` / `npm run start` / 建管理员脚本会自动走代理;
> 代理未开启时自动改为直连。使用平台的**浏览器也需要能访问 supabase.co**(保持代理软件开启)。

### 3. 创建管理员账号

```bash
node scripts/create-admin.mjs admin@school.edu.cn admin123456 平台管理员
```

用该账号登录 → 管理端「账号管理」为教师和学生开通账号
(设置角色、学号/工号与初始密码),把账号发给师生即可使用。

### 4. 使用流程

```
管理员开通账号 → 教师登录开设课程 → 学生用邀请码加入课程
    → 教师上传资料、开设实验(配置步骤/GPU需求)
    → 学生按步骤学习,开启实验会话(自动分配 GPU)进入 JupyterLab
    → 学生提交报告 → 教师查看进度、批改报告
```

## 🖥️ 一台 GPU 机器带一个班(推荐起步方式)

只有 1~2 台 GPU 机器时的完整方案,见 **[docs/one-machine-setup.md](docs/one-machine-setup.md)**:

- 一台 8 卡机器 = 8 个并发学生,第 9 人自动提示「算力已满 8/8」
- 每个学生独占一张卡 + 独立目录 + 独立 token + CPU/内存配额
- 到点自动销毁容器并释放卡位(平台 cron + 容器自毁双保险)
- 学生端显示「剩余 5/8 卡」与「⏳ 剩余 1:58:32」倒计时

```bash
# 1. GPU 机器上启动开通服务
pip install fastapi uvicorn docker requests
export SPAWNER_SECRET='随机字符串' GPU_COUNT=8 PLATFORM_HOST=<机器IP>
uvicorn spawner_example:app --host 0.0.0.0 --port 9000

# 2. 平台 .env.local
SPAWNER_SECRET=同一个随机字符串
CRON_SECRET=另一个随机字符串
```

管理端登记节点时填「卡数 = 机器实际卡数」「开通服务地址 = http://机器IP:9000」即可。

## 🖥️ GPU 服务器接入指南

平台把「GPU 资源」抽象为节点池:一台云端 GPU 服务器 = 一个节点(N 卡 = N 个可分配卡位)。

### 方式一:Webhook 开通服务(动态 JupyterLab 容器,推荐)

在 GPU 服务器上部署示例开通服务(需要 Docker 与 NVIDIA Container Toolkit):

```bash
pip install fastapi uvicorn docker
uvicorn spawner_example:app --host 0.0.0.0 --port 9000   # 在 deploy/ 目录
```

平台侧 `.env.local` 配置:

```ini
PROVISION_WEBHOOK_URL=http://<GPU服务器IP>:9000/provision
```

学生开启实验时,平台会携带实验/用户/时长信息调用该服务;服务用 Docker 启动
`jupyter/scipy-notebook` 容器(注入 GPU 与 `NVIDIA_VISIBLE_DEVICES`),返回
带 token 的 JupyterLab 地址,学生端「进入 JupyterLab」按钮即可直达。

### 方式二:节点直连

在 GPU 服务器上常驻一个 JupyterLab:

```bash
pip install jupyterlab
jupyter lab --ip 0.0.0.0 --port 8888 --no-browser
```

管理员在「GPU 资源池」登记节点时填入 `http://<GPU服务器IP>:8888` 作为
**Jupyter 网关地址**,平台会自动生成带 token 的会话地址。

> 云服务商(阿里云 PAI / AutoDL / 恒源云等)如提供可直接访问的 Jupyter 实例地址,
> 也可直接登记为节点 endpoint 使用;GPU 卡位仍由平台统一记账分配。

### 实验结果自动执行验证(Jupyter 内核)

配置 `.env.local` 中的以下两项后,学生实验页会出现「▶ 运行代码并验证输出」按钮:

```ini
JUPYTER_EXECUTE_URL=http://<Jupyter服务器IP>:8888
JUPYTER_EXECUTE_TOKEN=<jupyter server token>
```

工作流程:学生提交代码 → 平台调用 Jupyter Server REST API 启动 python3 内核 →
通过 WebSocket 发送 execute_request → 收集真实运行输出(stdout/执行结果/报错栈)→
与教师填写的「预期输出」比对 → 关闭内核。运行记录(输出/是否匹配)存入数据库,教师端可见。

未配置这两项时,平台退回「代码逐行一致性校验」模式,功能不受影响。
在 GPU 服务器上启动带 token 的 Jupyter Server:

```bash
jupyter lab --ip 0.0.0.0 --port 8888 --no-browser --LabApp.token="<你的token>"
```

## ☁️ 部署到云服务器

```bash
# 服务器上 (Linux + Node 18+)
git clone <你的仓库> && cd ml
npm install
cp .env.local.example .env.local && vim .env.local   # 填入 Supabase 配置
npm run build
npx pm2 start npm --name ml-platform -- run start    # 或 systemd
```

Nginx 反向代理 80 → 3000 即可对外提供服务(参考原项目的阿里云部署方式)。

## 🔐 安全设计

- service_role 密钥仅存在于服务端环境变量,API 路由均校验调用者角色
- 数据库 RLS 按角色隔离:学生只能看到自己加入的课程/自己的进度;
  教师只能管理自己的课程;管理员全部可见
- 普通用户无法自助提权(触发器拦截 profiles.role/status 的非管理员修改)
- GPU 分配使用数据库函数 + 行锁,防止并发分配到同一张卡

## 📄 许可证

MIT
