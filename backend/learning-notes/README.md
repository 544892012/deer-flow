# DeerFlow 后端学习笔记

按功能模块拆分，建议阅读顺序：

| # | 文件 | 内容 |
|---|------|------|
| 1 | [01-call-chain-and-reading-strategy.md](01-call-chain-and-reading-strategy.md) | 调用链路、流程日志、读代码策略 |
| 2 | [02-dev-server-startup.md](02-dev-server-startup.md) | `make dev` 启动了什么、端口监听、HTTP 接口 |
| 3 | [03-mcp-tool-loading.md](03-mcp-tool-loading.md) | MCP 工具加载机制（缓存、热更新、接入步骤） |
| 4 | [04-agent-lifecycle.md](04-agent-lifecycle.md) | Agent 实例生命周期：每请求创建新 Agent |
| 5 | [05-react-execution-flow.md](05-react-execution-flow.md) | ReAct 执行流程（StateGraph、条件边、ToolNode） |
| 6 | [06-stategraph-nodes-edges.md](06-stategraph-nodes-edges.md) | StateGraph 节点与边详解（Middleware 映射、ASCII 图） |
| 7 | [07-subagent-mechanism.md](07-subagent-mechanism.md) | Subagent 调用机制（task 工具、线程模型、并行控制） |
| 8 | [08-worker-react-loop.md](08-worker-react-loop.md) | worker.py 详解：ReAct 循环运行时宿主 |
| 9 | [09-tool-call-decision.md](09-tool-call-decision.md) | LLM 如何决定调用 Tool/Subagent |
| 10 | [10-skills-loading.md](10-skills-loading.md) | Skills 加载与使用机制（prompt 注入 + read_file 读取） |
| 11 | [11-sandbox-mechanism.md](11-sandbox-mechanism.md) | Sandbox 机制（代码执行环境隔离、路径映射、安全策略） |
| 12 | [12-api-request-guide.md](12-api-request-guide.md) | API 请求指南 — cURL / Postman 发消息示例 |
| 13 | [13-system-prompt-design.md](13-system-prompt-design.md) | System Prompt 设计分析（模块化拼装、条件注入、prompt 工程技巧） |
