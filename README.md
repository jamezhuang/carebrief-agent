# CareBrief Agent

面向健康信息咨询、就诊方向参考和个人资料整理的 AI Agent 工程项目。

## v0.1.0

源码、版本说明与 Docker 镜像已发布：

- [版本发布](https://github.com/jamezhuang/carebrief-agent/releases/tag/v0.1.0)
- API：`ghcr.io/jamezhuang/carebrief-api:0.1.0`
- Web：`ghcr.io/jamezhuang/carebrief-web:0.1.0`

维护者已在 Windows Docker Desktop 中完成独立数据库部署及 GHCR 镜像运行验收：登录、基础问答、MD 上传与勾选检索，以及重启后账号、文件和记录保留。此记录是人工功能验收，不代表完整回归测试全部通过或医学准确率已经评估。

## 功能与技术

- Next.js / React / TypeScript 工作台与 FastAPI 后端。
- LangGraph 编排与 Function Calling，多轮健康问答及工具选择。
- PostgreSQL / pgvector 向量召回与关键词混合检索，查询规划与重排。
- 本地知识检索、可选外部搜索和网页读取。
- 用户文档选择与引用、健康档案候选确认和冲突处理。
- 上下文压缩与摘要持久化、运行记录、失败分析、反馈及停止生成。

## Docker 镜像部署

以下命令使用 Windows PowerShell。需要 Docker Desktop Linux 容器模式及 Docker Compose 2.24.4 或更新版本（镜像覆盖文件使用 `!override`）。

### 1. 获取源码与配置

```powershell
git clone https://github.com/jamezhuang/carebrief-agent.git
Set-Location carebrief-agent
Copy-Item release.env.example .env
Copy-Item apps/api/.env.example apps/api/.env
notepad .env
notepad apps/api/.env
```

根目录 `.env`：
- `RELEASE_POSTGRES_PASSWORD`：替换为自己的随机字母数字密码，不能使用占位符；可用 PowerShell `[Guid]::NewGuid().ToString('N')` 生成。
- 镜像部署固定使用 API 18000、Web 3100；覆盖文件会覆盖端口配置。

后端 `apps/api/.env`：
- 填写 `DEEPSEEK_API_KEY` 与 `SILICONFLOW_API_KEY`。
- 默认 `PROVIDER_MODE=live`、`RAG_BACKEND=postgres`。
- 联网搜索填写 `BOCHA_API_KEY`；不用时设置 `EXTERNAL_SEARCH_ENABLED=false`。
- 模型名称、Embedding 维度及服务地址按实际账号支持的配置填写。建索引后更换 Embedding 配置需要重新建立匹配的索引。
- 核心镜像保持 `CRAWL4AI_ENABLED=false`、`OCR_ENABLED=false`。

实际配置文件包含密钥，只保存在本机。Compose 会覆盖数据库连接地址和容器内存储路径。

### 2. 拉取镜像并启动数据库

以下各步骤成功后再执行下一步：

```powershell
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml config --quiet
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml pull api web
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml up -d --wait rag-db
```

### 3. 首次初始化

```powershell
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml run --rm --no-deps api python -m scripts.rag init
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml run --rm --no-deps api python -m scripts.workspace_init
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml run --rm --no-deps api python -m scripts.rag import
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml run --rm --no-deps api python -m scripts.hybrid build
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml run --rm --no-deps api python -m scripts.hybrid status
```

导入会调用 Embedding API。首批种子应显示 3 份文档、3 个分块，关键词索引 pending 为 0。普通重启无需重复导入。

### 4. 启动并访问

确保本机 18000、3100 端口未被其他服务占用：

```powershell
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml up -d --no-build --wait api web
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml ps
Invoke-RestMethod http://127.0.0.1:18000/health
```

- [工作台](http://127.0.0.1:3100/workspace)
- [运行记录](http://127.0.0.1:3100/workspace?tab=runs)
- [API 文档](http://127.0.0.1:18000/docs)

新数据库需要注册新账号。检查基础问答、上传并勾选一份测试 MD 后提问，以及重启后的文件与记录保留。HTTP 就绪不代表索引或模型配置一定可用，应结合 /health 和实际请求验证。

### 5. 日常停止与恢复

```powershell
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml stop
docker compose -p carebrief-release -f compose.yaml -f compose.images.yaml up -d --no-build --wait
```

数据库和 API 缓存使用命名卷。不要使用 `down -v`，该命令会删除数据卷。重启保留不等于备份，重要数据需另外备份。

## 从源码构建

使用根目录 `.env` 设置 API_PORT、WEB_PORT，并配置后端密钥；只使用 `compose.yaml`：

```powershell
docker compose -p carebrief-source -f compose.yaml up -d --wait rag-db
docker compose -p carebrief-source -f compose.yaml build api
```

随后按上面的初始化顺序运行，但删除每条命令中的 `-f compose.images.yaml`，项目名统一改为 `carebrief-source`。最后执行：

```powershell
docker compose -p carebrief-source -f compose.yaml up -d --build --wait api web
```

前端 API 地址在构建时写入。预构建镜像固定连接本机 18000；更换后端地址需调整构建参数并重新构建前端。此默认部署用于本机体验，远程部署还需调整浏览器可访问的 API 地址、CORS 和 HTTPS 配置。

## 配置文件

| 示例 | 实际配置 | 用途 |
| --- | --- | --- |
| release.env.example | 根目录 .env | Compose 数据库密码和源码部署端口 |
| apps/api/.env.example | apps/api/.env | 模型、Embedding、检索与后端开关 |
| apps/web/.env.local.example | apps/web/.env.local | 本机前端开发 |
| apps/api/workspace.env.example | 按需合并到后端 .env | 工作台高级配置 |
| apps/api/crawl4ai-integration.env.example | 按需合并到后端 .env | 可选浏览器环境参考 |

`compose.rag.yml` 是单独数据库的开发配置，不需要与上述统一部署一起启动。历史安装、修复和源码整理脚本保留供开发使用，新用户不需要逐个执行。

## 发布边界与后续工作

- 当前公共种子只有 3 份；完整广东医院目录、额外知识正文及测评资料未随版本发布。
- 核心镜像不包含 Crawl4AI 浏览器渲染或 PaddleOCR 环境；相关功能需单独安装和验收。
- 外部搜索受服务配置、网络和网站可访问性影响，不保证完整名单或任意网页可读。
- 停止生成使用进程内任务管理，当前部署使用一个后端工作进程。
- 上下文压缩已有运行记录，实际计费 Token 节省尚未证明；首次输出成功率、检索超时和引用一致性仍需持续回归。
- 密钥、个人上传文件、健康档案、缓存、数据库备份和原始测评对话不随仓库或镜像发布。

本项目提供健康信息辅助，不替代医生诊断、处方或急诊评估。

## 界面展示

### 工作台与基础科普
支持自然语言健康信息问答。

![工作台与基础科普](docs/screenshots/01-workspace.png)

### 文件问答与来源引用
勾选上传文件后，整理文档内容并展示段落来源。截图使用虚构演示资料。

![文件问答与来源引用](docs/screenshots/02-document-chat.png)

### Agent 运行记录
展示执行状态、最终校验结果和单轮耗时。运行成功不代表医学内容已经人工审核。

![Agent 运行记录](docs/screenshots/04-agent-runs.png)
