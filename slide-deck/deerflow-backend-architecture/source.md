# DeerFlow 后端架构技术分享

## 项目概述

DeerFlow 是字节跳动开源的多 Agent 协作框架，基于 LangGraph + LangChain 构建。后端采用 Python 实现，通过工厂模式 + 框架运行时的架构，实现了灵活的 Agent 编排和工具调用。

## 核心调用链

```
HTTP 请求 → thread_runs.py（HTTP入口）
  └→ start_run() → services.py（服务层编排）
     └→ run_agent() → worker.py（Agent执行器）
        └→ make_lead_agent(config) → agent.py（工厂函数）
           └→ graph.astream() → ReAct 循环
```

后端只提供了"如何构建 Agent"的逻辑（make_lead_agent），其余的 HTTP 服务、流式传输、checkpoint 持久化等运行时基础设施全是 LangGraph 框架完成。

## 双服务架构

| 服务 | 端口 | 作用 |
|------|------|------|
| LangGraph Server | 2024 | Agent 运行时，LangGraph Platform API |
| Gateway API | 8001 | 自定义 REST API，额外业务逻辑 |

langgraph.json 注册 graph factory → CLI 启动 uvicorn → 框架绑定端口 2024。项目代码不写任何端口配置。

## make_lead_agent 工厂函数

每次请求都创建新 Agent 实例，5个步骤：
1. 解析配置（model_name, thinking_enabled, subagent_enabled）
2. 构建 Middleware 链（12-17个）
3. 加载工具（Config工具 + 内置工具 + MCP工具 + ACP工具）
4. 生成系统提示词
5. create_agent() → 返回 CompiledStateGraph

## Agent 生命周期

- 每请求创建新 Agent 实例（~10ms，纯对象组装）
- MCP 工具走缓存，不每次启动子进程
- 对话历史通过 Thread + Checkpointer 保持连续
- 用户看到"同一 Agent 持续对话"，底层是新 Agent + 加载历史 state

## ReAct 循环（Reasoning + Acting）

StateGraph 核心节点：
- before_agent 节点：入口运行一次（ThreadData, Uploads, Sandbox）
- before_model 节点：每轮循环前（Summarization, ViewImage）
- model 节点：调用 LLM，返回 AIMessage
- after_model 节点：每轮循环后（Title, LoopDetection）
- tools 节点（ToolNode）：执行 tool_calls
- after_agent 节点：出口运行一次（Memory, Sandbox清理）

条件边决定流向：有 tool_calls → 执行工具 → 回到 model；无 tool_calls → 结束。

## Middleware 系统

17 个 Middleware，两种图表现形式：
- **生成节点**：before_agent/before_model/after_model/after_agent
- **内联模式**：wrap_model_call（洋葱模型）/ wrap_tool_call

关键 Middleware：
| Middleware | 钩子 | 作用 |
|-----------|------|------|
| ThreadDataMiddleware | before_agent | 创建线程数据目录 |
| SandboxMiddleware | before_agent + after_agent | 沙箱生命周期 |
| LLMErrorHandlingMiddleware | wrap_model_call | LLM 异常重试 |
| ToolErrorHandlingMiddleware | wrap_tool_call | 工具异常处理 |
| SummarizationMiddleware | before_model | 压缩过长对话 |
| MemoryMiddleware | after_agent | 更新长期记忆 |
| LoopDetectionMiddleware | after_model | 检测循环调用 |

## 四类工具体系

| 类型 | 来源 | 示例 |
|------|------|------|
| Config 工具 | config.yaml | web_search, web_fetch |
| 内置工具 | 硬编码 | present_file, ask_clarification |
| MCP 工具 | extensions_config.json | yfinance 等外部服务 |
| ACP 工具 | acp_config.json | 外部 Agent 调用 |

MCP 工具通过懒加载单例缓存 + mtime 热更新机制，支持运行时动态加载。

## LLM 决策机制

"要不要调用工具"完全由 LLM 自主决定：
1. 调用前：bind_tools() 把工具 schema 告诉 LLM
2. LLM 返回 AIMessage，可能包含 tool_calls
3. 框架检查 tool_calls 字段，决定图跳转方向

Subagent 也是一个普通工具（task tool），LLM 通过 tool_calls 触发。

## Subagent 多代理协作

主 Agent 通过 task 工具委托子代理，子代理在后台线程池运行独立 ReAct 循环：

- 子代理继承 parent sandbox 和 thread_data
- 子代理固定 thinking_enabled=False
- 子代理不含 task 工具（防止递归嵌套）
- 三层并行控制：LLM层截断（3个）+ 调度线程池 + 执行线程池

## Sandbox 代码执行环境

两种 Provider：
| 维度 | LocalSandbox | AioSandbox |
|------|-------------|------------|
| 隔离 | 宿主机 subprocess | Docker 容器 |
| 适用 | 本地开发 | 生产环境 |
| bash | 默认禁用 | 默认启用 |

虚拟路径映射：/mnt/user-data/ → 真实文件系统路径。通过路径校验防止越权。

## Skills 技能系统

Skills 不是 LangChain Tool，而是通过系统提示词注入的"知识文档"。LLM 在运行时通过 read_file 工具读取 SKILL.md 获取技能指令。

## 流式输出与调试

- agent.astream() 每产生 chunk → StreamBridge → SSE 推送前端
- 支持 stream_mode: values / updates / messages / debug
- [FLOW] 日志追踪 13 个关键文件的执行流程
- LangGraph Studio 可视化调试界面
- LangSmith/Langfuse Tracing 完整链路追踪

## 一句话总结

DeerFlow 后端代码只负责"组装 Agent"（make_lead_agent 构建 StateGraph），之后整个 ReAct 循环完全交给 LangGraph 框架运行——框架驱动 model → tools → model → ... 的循环，直到 LLM 不再调用工具为止。这是典型的工厂模式 + 框架运行时分离架构。
