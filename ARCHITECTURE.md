# V1 数据与工作流

## 有界对话流程

1. 最新输入先经过本地当前风险匹配和社交/无效输入识别。
2. 医学请求在demo使用规则，在live调用DeepSeek结构化意图/原文提取。证据片段必须在最新输入中出现。
3. 风险、范围外、用药、报告入口、问候/澄清进入相应分支。风险暂停被保留，不能用“继续”绕过。
4. 受支持的医学请求：模型提出唯一允许的 `search_knowledge` function call；服务端检查名称与JSON参数后执行本地检索。外部检索另有服务器控制的条件与固定公共查询。
5. 生成结构化回答，传入近4轮对话、本次事实、确认背景、已确认报告和来源。
6. 硬检查引用ID、片段、科室清单；live增加模型复核。失败不提交本轮事实/消息/结果，返回记录编号。
7. 成功后以咨询revision做条件更新并持久化。问候等不会覆盖已有医学结果。

LangGraph仅承载有界医疗对话图，不做无限自主循环。报告上传、登录和记忆确认是FastAPI业务端点。没有微调、RAG分类器、Redis或MCP。

## 长短期记忆

- `Consultation.payload`：消息、本次事实、最近结果、档案快照、待确认候选。输入原文定位通过后可更新本次事实。
- `Account.profile`：只有用户手动填写或确认的字段；每个字段含value/source/confirmed_at。病程、当前症状不自动导入长期档案。
- 创建新咨询时读取档案快照，单独传入上下文。不会把档案年龄/病史静默复制为本次事实。
- 当前在本机缓存咨询锁与revision，数据库用条件更新防止旧版本覆盖。Docker单API进程；多进程/分布式锁与正式迁移另行设计。

## 报告可信边界

上传限制 → 文本/PDF/可选OCR → 保存original_text与初始字段 → 用户编辑confirmed_text/rows → revision确认 → 确定性字段整理。

确认前不得整理、不得进入模型上下文。未能解析的布局保留原文，不拼造指标表。报告原文不是医学知识证据，确认后仍不能据此诊断。原始文件不永久保存，文字与确认内容保存在本地数据库。

## 存储和日志

SQLAlchemy同时支持SQLite与PostgreSQL。账号、登录令牌、咨询和报告独立表；档案和对话以JSON承载。登录令牌只存哈希，密码随机盐PBKDF2。

日志仅写节点/工具/错误码等元数据，成功与失败共享run_id。业务数据持久化不等于写入调试日志。模型与工具返回是非可信数据，不能更改服务器工具清单/URL白名单。

## 局限

依赖示例医院摘要、少量成人咳嗽资料；简单关键词风险规则无法替代临床分诊。当前没有完善的临床评测、全格式报告理解或通用症状覆盖。外部正文待审核，发布日期不推断；冲突不自动判定。

官方开发文档参考：

- https://api-docs.deepseek.com/api/create-chat-completion/
- https://docs.siliconflow.com/en/api-reference/embeddings/create-embeddings
- https://docs.sqlalchemy.org/en/20/orm/quickstart.html
- https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html
- https://open.bochaai.com/
