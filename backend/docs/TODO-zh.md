# TODO 列表

## 已完成能力

- [x] 仅在首次调用文件系统或 bash 工具后再启动沙箱
- [x] 为全流程增加澄清（Clarification）流程
- [x] 实现上下文摘要机制，避免上下文爆炸
- [x] 集成 MCP（Model Context Protocol）以扩展工具
- [x] 增加文件上传并支持自动文档转换
- [x] 实现自动线程标题生成
- [x] 增加计划模式与 TodoList 中间件
- [x] 通过 ViewImageMiddleware 支持视觉模型
- [x] 基于 SKILL.md 格式的技能（Skills）系统

## 计划中能力

- [ ] 池化沙箱资源以减少沙箱容器数量
- [ ] 增加认证/授权层
- [ ] 实现限流
- [ ] 增加指标与监控
- [ ] 上传支持更多文档格式
- [ ] 技能市场 / 远程技能安装
- [ ] 优化 agent 热路径中的异步并发（IM 渠道多任务场景）
  - 在 `packages/harness/deerflow/tools/builtins/task_tool.py` 中用 `asyncio.sleep()` 替代 `time.sleep(5)`（子代理轮询）
  - 在 `packages/harness/deerflow/sandbox/local/local_sandbox.py` 中用 `asyncio.create_subprocess_shell()` 替代 `subprocess.run()`
  - 在社区工具（tavily、jina_ai、firecrawl、infoquest、image_search）中用 `httpx.AsyncClient` 替代同步 `requests`
  - 在 title_middleware 与 memory updater 中用异步 `model.ainvoke()` 替代同步 `model.invoke()`
  - 对剩余阻塞型文件 I/O 考虑使用 `asyncio.to_thread()` 包装
  - 生产环境：使用 `langgraph up`（多 worker）而非 `langgraph dev`（单 worker）

## 已解决问题

- [x] 确保 `state.artifacts` 中无重复文件
- [x] 长时间思考但内容为空（答案出现在思考过程中）
