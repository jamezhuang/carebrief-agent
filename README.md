# CareBrief Agent

面向健康信息咨询和就诊方向参考的 AI Agent 工程项目。

## 版本状态

正在整理首个版本 `v0.1.0`。本仓库已初始化发布说明、上传排除规则和用于本机验证的前后端 Docker 配置。完整应用源码与正式镜像尚未发布。用户已在本机完成前后端镜像构建；后端核心依赖导入和容器网络数据库连接检查已通过，完整应用启动和工作台功能联调仍待验证。功能描述对应开发中的本地项目，不代表仓库已经具备完整运行条件。

## 项目能力

- 多轮健康信息咨询、基础科普和一般就诊方向参考。
- PostgreSQL / pgvector 公共知识检索，结合向量召回、关键词召回、查询规划与重排。
- 由大模型通过 Function Calling 选择工具，检索本地资料、发现网页并读取外部来源；浏览器读取作为可选兜底。
- 用户文档选择与引用，以及个人健康信息候选提取、确认和冲突处理。
- 对话上下文压缩与摘要持久化。
- Agent 运行事件、失败分析与回归测评。
- 前端停止生成、当前回答复制和反馈入口。

外部信息获取取决于检索服务配置、网站可访问性和页面内容，不能保证任意问题都能取得完整资料。

## 技术组成

| 部分 | 技术 |
| --- | --- |
| 前端 | Next.js / React / TypeScript |
| 后端 | Python / FastAPI |
| Agent 编排 | LangGraph / Function Calling |
| 公共知识存储 | PostgreSQL / pgvector |
| 模型服务 | DeepSeek 与配置的 Embedding 服务 |
| 可选网页读取 | Crawl4AI / Playwright |

最终依赖版本和部署方式以随后提交的代码与配置为准。

## 发布范围

GitHub 保留运行所需源码、依赖声明、配置示例、数据库初始化或迁移文件、必要测试和部署说明。

真实 API 密钥、账号凭据、个人上传文档、健康档案、数据库备份、测评原始对话、虚拟环境、依赖目录与本地缓存不随项目发布。公共知识数据须确认来源与再分发条件后单独整理。

容器镜像计划通过 GitHub Container Registry 发布；镜像构建与启动验证通过前，不创建正式版本标签。Docker 构建还需要独立的构建上下文排除规则，不能只依赖 `.gitignore`。

## 当前验收边界

长对话测试曾完成 24 轮请求，但部分回答依赖输出修复；实际计费 Token 节省尚未验证。后续需要继续检查首次输出成功率、检索超时、引用一致性和重启后的摘要恢复。

当前停止生成采用进程内任务管理，部署先使用单个后端工作进程；多进程取消协调尚需完善。

本项目提供健康信息辅助，不替代医生诊断、处方或急诊评估。

## 前端镜像的本机验证

将本仓库 `apps/web/Dockerfile` 和 `apps/web/.dockerignore` 应用到现有完整项目后，在项目根目录执行：

```powershell
docker build --progress=plain --build-arg NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:18000 -t carebrief-web:0.1.0-check ./apps/web
```

当前仓库尚未上传前端源码和锁文件，不能直接从本仓库构建完整应用。上述命令面向已有本地项目。用户已在 Docker Desktop Linux 模式下完成前端镜像构建；工作台页面与后端的功能联调仍需确认。

该配置适用于当前未提供自定义 `next.config.*` 的情况；添加运行时配置后需同步调整镜像。浏览器使用的 `NEXT_PUBLIC_API_BASE_URL` 在构建时写入，修改地址后需要重新构建。静态资源通过 `public` 目录复制到运行镜像。

停止占用 3100 端口的原前端开发服务后，可运行：

```powershell
docker run --rm --name carebrief-web-check -p 127.0.0.1:3100:3000 carebrief-web:0.1.0-check
```

使用 `http://127.0.0.1:3100/workspace` 验证工作台，使用 `http://127.0.0.1:3100/workspace?tab=runs` 验证运行与反馈页面。后端使用 18000 端口；可按下面的启动助手切换为容器运行，切换前停止原本机后端。

## 核心后端镜像的本机验证

当前 Dockerfile 安装混合检索、文档入库、工作台和网页工具的依赖清单，并通过它们递归安装基础依赖。不安装开发测试、PaddleOCR 或 Crawl4AI 的额外环境；默认 `CRAWL4AI_ENABLED=false`。浏览器兜底与 OCR 需要后续配置并单独验收，当前镜像不代表这些能力已经完成容器化。

构建会复制应用代码、脚本与公共知识种子 `data/knowledge.json`。个人档案、上传资料、SQLite 文件与本地缓存不随镜像复制；其他公共资料需要在整理发布清单后另行处理。

将配置应用到已有完整项目，在项目根目录执行：

```powershell
docker build --progress=plain -t carebrief-api:0.1.0-check ./apps/api
docker run --rm --entrypoint python carebrief-api:0.1.0-check -c "import fastapi, langgraph, sqlalchemy, psycopg, pgvector, jieba, docx; print('core dependencies OK')"
```

依赖导入检查不会启动应用，也不证明数据库、登录、检索或模型 API 已经通过联调。

完整启动前须核对容器内的数据库地址、缓存与文档路径、运行时密钥注入、CORS 和数据持久化挂载。当前仅使用一个 Uvicorn 工作进程。既有 Windows 虚拟环境路径不能直接用于 Linux 容器。

当前 GitHub 仓库仍未包含全部应用源码、依赖清单与公共种子，不能直接从仓库构建。正式镜像、版本标签与 GHCR 发布待完整验收后进行。

## 后端运行配置与启动助手

`apps/api/scripts/prepare_docker_runtime.py` 从本机 `apps/api/.env` 生成私有的 Docker 配置，不修改原文件。它将 RAG 数据库地址转换为数据库容器名称与内部 5432 端口，将支持的存储路径转换为 `/app/.cache` 或 `/app/data`，加入工作台 3100 的 CORS 配置。遇到挂载范围外的存储路径会停止并报告字段名称。

生成的 `.cache/docker-runtime/api.env` 与 `api.dotenv` 含运行凭据，仅用于本机运行，不能上传仓库或发给他人。

先停止原本机 Uvicorn 服务，保持现有数据库和前端容器运行。将启动助手下载到完整本地项目对应位置后，在项目根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\api\scripts\start_docker_api.ps1
```

启动助手使用现有 `carebrief-api:0.1.0-check` 镜像，自动获取 `ai-consultation-v1-rag-db-1` 的自定义网络，将现有 `.cache`、`data` 目录挂载到容器，发布 `127.0.0.1:18000`，并检查 `/openapi.json`。如同名容器或端口已经存在，会停止而不会自动删除。

配置转换的 8 项自动测试已通过；PowerShell 启动助手仍需在用户 Windows 环境执行验证。HTTP 就绪后还需要手动验证现有账号登录、档案、上传文件、知识检索、模型回答及重启后的数据恢复。浏览器兜底和 OCR 尚未在这个核心镜像中启用。
