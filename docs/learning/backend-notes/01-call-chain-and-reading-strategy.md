# 调用链路、流程日志与读代码策略

***

## 1. make\_lead\_agent 的完整调用链路

### 核心概念

`make_lead_agent` 是一个 **工厂函数**（Factory Function）：

- 它不是 agent 本身，而是"创建 agent 的函数"
- 每次请求都会调用它创建一个新的 graph 实例
- 接收 `RunnableConfig` 参数，可以*根据不同请求动态选择 model、tools、mid*dleware

### 路径一：LangGraph Server 原生 API（端口 2024）

这是前端直连 LangGraph Server 的主路径：

```
langgraph.json 配置注册
│  "graphs": { "lead_agent": "deerflow.agents:make_lead_agent" }
│
└→ LangGraph Server 启动时
   │  langgraph_api/graph.py: _graph_from_spec()
   │  → importlib.import_module("deerflow.agents")
   │  → 找到 make_lead_agent 函数引用（注意：此时不调用，只是注册）
   │
   └→ 收到 HTTP 请求时
      │  POST /threads/{id}/runs/stream
      │
      └→ langgraph_runtime_inmem 的 worker 执行
         │  graph = graph_factory(config=runnable_config)
         │  └→ make_lead_agent(config) ←←← 实际调用点
         │
         └→ graph.astream(input, config=...) → ReAct loop
```

关键点：

- `langgraph.json` 的 `"deerflow.agents:make_lead_agent"` 告诉 LangGraph Server "这个函数就是 graph factory"
- LangGraph Server 启动时只是 import 这个函数，不调用
- 每次收到请求时，才会调用 `make_lead_agent(config)` 来创建一个新的 agent graph
- 返回的是一个编译好的 `CompiledStateGraph`，然后用 `.astream()` 跑 ReAct 循环

**在这条路径中，后端自己的代码只有两处：**

1. `langgraph.json` — 一行配置，注册 graph factory
2. `deerflow/agents/lead_agent/agent.py` 中的 `make_lead_agent()` — 工厂函数本体

**其余全部由 LangGraph 框架完成：**

- HTTP 路由、请求解析 → `langgraph_api` 的内置 Starlette 路由
- 调用 factory → `langgraph_api/graph.py: get_graph() → invoke_factory(value, graph_id, config, ...)`
- Checkpointer 注入、Store 注入 → `get_graph()` 自动设置 `config["configurable"]`
- 流式执行 → `langgraph_api/stream.py: astream_state() → graph.astream(input, config, ...)`
- SSE 序列化、响应返回 → 框架的 `StreamingResponse`

简单说：**后端只提供了"如何构建 agent"的逻辑（make\_lead\_agent），其余的 HTTP 服务、流式传输、checkpoint 持久化等运行时基础设施全是框架干的。**

> **`agent.astream()`** **是整个服务的核心 loop**
>
> 无论走哪条路径，最终都是调用 `agent.astream(input, config, stream_mode=...)` 启动 ReAct 循环。这是一个 **异步生成器**，它驱动 `model → tools → model → ...` 的循环，每完成一个图节点的执行就 yield 一个 chunk。`worker.py` 中的 `async for chunk in agent.astream(...)` 是这个 loop 的消费端——逐 chunk 接收并通过 `StreamBridge` 发布为 SSE 事件推送给前端。循环在 LLM 不再返回 `tool_calls` 时自然结束。
>
> 代码位置：`packages/harness/deerflow/runtime/runs/worker.py` → `run_agent()` 函数 → 第 7 步

### 路径二：Gateway API（端口 8001）

这是 Gateway 自己的运行时，走的是同样的函数，但调用链路不同：

```
POST /api/threads/{id}/runs/stream
│  thread_runs.py: stream_run()
│
└→ services.py: start_run()
   │  agent_factory = resolve_agent_factory(assistant_id)
   │  └→ return make_lead_agent  （返回函数引用）
   │
   └→ asyncio.create_task(run_agent(agent_factory=agent_factory, ...))
      │
      └→ worker.py: run_agent()
         │  agent = agent_factory(config=runnable_config)
         │  └→ make_lead_agent(config) ←←← 实际调用点
         │
         └→ agent.astream(input, config=...) → ReAct loop
```

### make\_lead\_agent 内部做了什么

```python
def make_lead_agent(config: RunnableConfig):
    # 1. 解析配置
    cfg = config.get("configurable", {})
    model_name = cfg.get("model_name")
    thinking_enabled = cfg.get("thinking_enabled", True)
    subagent_enabled = cfg.get("subagent_enabled", False)
    
    # 2. 构建 middleware 链（12个）
    middlewares = _build_middlewares(config, model_name)
    # → [ThreadData, Uploads, Sandbox, Dangling, LLMError, SandboxAudit,
    #    ToolError, Summarization, Title, Memory, LoopDetection, Clarification]
    
    # 3. 加载工具
    tools = get_available_tools(model_name, groups, subagent_enabled)
    
    # 4. 生成系统提示词
    system_prompt = apply_prompt_template(subagent_enabled, ...)
    
    # 5. 调用 langchain 的 create_agent 构建 StateGraph
    return create_agent(
        model=create_chat_model(name=model_name),
        tools=tools,
        middleware=middlewares,
        system_prompt=system_prompt,
        state_schema=ThreadState,
    )
    # 返回一个 CompiledStateGraph，包含 model → tools 的 ReAct 循环
```

***

## 2. \[FLOW] 流程追踪日志

### 修改的文件（13个）

| 文件                                                              | 作用             |
| --------------------------------------------------------------- | -------------- |
| `app/gateway/routers/thread_runs.py`                            | HTTP 入口        |
| `app/gateway/services.py`                                       | 服务层 start\_run |
| `deerflow/runtime/runs/worker.py`                               | Agent 执行器      |
| `deerflow/agents/lead_agent/agent.py`                           | Agent 工厂       |
| `deerflow/agents/middlewares/thread_data_middleware.py`         | 线程数据           |
| `deerflow/agents/middlewares/uploads_middleware.py`             | 文件上传           |
| `deerflow/agents/middlewares/dangling_tool_call_middleware.py`  | 悬空工具调用修复       |
| `deerflow/agents/middlewares/llm_error_handling_middleware.py`  | LLM 错误处理 + 重试  |
| `deerflow/agents/middlewares/tool_error_handling_middleware.py` | 工具错误处理         |
| `deerflow/agents/middlewares/title_middleware.py`               | 标题生成           |
| `deerflow/agents/middlewares/memory_middleware.py`              | 记忆更新           |
| `deerflow/sandbox/middleware.py`                                | 沙箱生命周期         |
| `deerflow/tools/tools.py`                                       | 工具加载           |

### 实际测试日志输出（时间顺序）

```
[FLOW] 🔧 make_lead_agent — building agent graph
[FLOW] 🧰 Tools loaded: total=9 — [web_search, web_fetch, ...]
[FLOW] 🔗 Base runtime middlewares built: [ThreadData, Uploads, Sandbox, ...]
[FLOW] 🔗 Full middleware chain: [ThreadData, ..., Clarification]
[FLOW]   📂 ThreadDataMiddleware.before_agent
[FLOW]   📎 UploadsMiddleware.before_agent
[FLOW]   📦 SandboxMiddleware.before_agent — lazy_init=True
[FLOW]   🤖 LLM call (async) — model=deepseek-chat, messages=1, tools=9
[FLOW]   🤖 LLM response (async) — has_tool_calls=False
[FLOW]   🏷️  TitleMiddleware.aafter_model — generated title: Greeting in One Word
[FLOW]   🧠 MemoryMiddleware.after_agent — queuing memory update
[FLOW]   📦 SandboxMiddleware.after_agent
```

### 使用方法

启动服务后，在控制台搜索 `[FLOW]` 即可看到完整的请求处理链路。

***

## 3. 读后端代码的策略

这个项目分层多、抽象深，而且大量依赖 LangGraph/LangChain 框架的隐式机制，读起来吃力是正常的。以下是建议的学习方法：

### 3.1 先搞清"谁调用谁"，不要深入细节

核心调用链只有一条主线：

```
HTTP 请求                             → app/gateway/routers/thread_runs.py
  └→ start_run()                      → app/gateway/services.py
     └→ run_agent()                   → packages/harness/deerflow/runtime/runs/worker.py
        └→ make_lead_agent()          → packages/harness/deerflow/agents/lead_agent/agent.py
           └→ graph.astream()         → langchain/agents/factory.py（框架代码）
              └→ ReAct 循环            → model 节点 ↔ tools 节点 交替执行
```

先把这条主线想明白，其他都是"分支"。

### 3.2 用 \[FLOW] 日志来"看"流程

已经在 13 个关键文件中加好了流程日志。启动服务后发一个请求，在控制台搜 `[FLOW]`，能完整看到：

- 哪个 middleware 先执行、哪个后执行
- LLM 调用了几次、每次带了多少 tools
- 工具调用了哪些、成功与否

### 3.3 用 Debug 打断点来"走"流程

已经配好了 `.vscode/launch.json`，直接用 F5 启动。建议打断点的位置：

| 文件                                                              | 函数                      | 看什么            |
| --------------------------------------------------------------- | ----------------------- | -------------- |
| `deerflow/agents/lead_agent/agent.py`                           | `make_lead_agent()` 入口  | 整个 agent 如何被构建 |
| `deerflow/agents/middlewares/llm_error_handling_middleware.py`  | `awrap_model_call()`    | 每次 LLM 调用的输入输出 |
| `deerflow/agents/middlewares/tool_error_handling_middleware.py` | `awrap_tool_call()`     | 工具调用的参数和返回值    |
| `deerflow/tools/tools.py`                                       | `get_available_tools()` | 工具如何被加载和过滤     |

### 3.4 先学框架概念，再读框架代码

最吃力的地方其实是 LangGraph/LangChain 框架本身。只需先学两个核心概念：

- **StateGraph**：节点图，每个节点是一个函数，边是条件跳转。`make_lead_agent` 返回的就是一个编译好的 StateGraph
- **RunnableConfig**：配置对象，贯穿整个执行链，类似于 Go 的 `context.Context`

只要理解这两个，就能理解 `make_lead_agent` 在做什么。

### 3.5 按"切片"读，不要通读

不要试图从头到尾读懂所有代码。按功能切片读：

| 想了解什么          | 读哪个文件                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| 工具是怎么加载的       | `deerflow/tools/tools.py`                                                      |
| 记忆怎么工作的        | `deerflow/agents/middlewares/memory_middleware.py` + `deerflow/agents/memory/` |
| sandbox 怎么运行命令 | `deerflow/sandbox/tools.py`                                                    |
| 系统提示词怎么生成的     | `deerflow/agents/lead_agent/prompt.py`                                         |
| 子 Agent 怎么协作   | `deerflow/subagents/executor.py` + `deerflow/tools/builtins/task_tool.py`      |
| 上下文怎么压缩的       | `deerflow/agents/middlewares/summarization_middleware.py`                      |

### 3.6 结合已有的学习文档

`docs/learning/` 下已有一组正式学习文档：

| 文件                             | 内容                                  |
| ------------------------------ | ----------------------------------- |
| [01-architecture-overview.md](../01-architecture-overview.md) | 整体架构、技术栈、服务端口 |
| [02-agent-and-middleware.md](../02-agent-and-middleware.md) | Agent 编排模型、ThreadState、Middleware 链 |
| [03-sub-agents.md](../03-sub-agents.md) | 子 Agent 协作、调用序列、并发控制 |
| [04-sandbox-and-filesystem.md](../04-sandbox-and-filesystem.md) | 沙箱架构、虚拟路径、安全机制 |
| [05-context-management.md](../05-context-management.md) | 5 层上下文管理系统 |
| [06-multi-agent-reference.md](../06-multi-agent-reference.md) | 多 Agent 设计模式参考 |
| [07-request-lifecycle.md](../07-request-lifecycle.md) | 完整请求链路（HTTP → ReAct 循环） |
| [08-deerflow-tech-sharing-outline.md](../08-deerflow-tech-sharing-outline.md) | 技术分享提纲、讲稿骨架、Demo 脚本 |

建议阅读顺序：`01 → 07 → 02 → 03 → 05`（先整体 → 链路 → Agent → 子Agent → 上下文）

***

## 4. 框架内部执行过程的调试手段

框架内部的 ReAct 循环（LLM 调用 → 工具执行 → LLM 再次调用 → ...）对业务代码是黑盒的。以下是打印和观察每一步的方法：

### 4.1 stream\_mode="debug"（推荐：零配置，最详细）

LangGraph 的 `agent.astream()` 支持 `stream_mode="debug"`，会输出每个图节点的完整执行细节：

```python
async for chunk in agent.astream(input, config, stream_mode="debug"):
    print(chunk)
```

debug chunk 示例：

```python
# 节点开始执行
{"type": "task", "timestamp": "...", "step": 1, "payload": {
    "id": "xxx", "name": "model", "input": {...}, "triggers": ["start:model"]
}}

# 节点执行完毕
{"type": "task_result", "timestamp": "...", "step": 1, "payload": {
    "id": "xxx", "name": "model", "result": [("messages", AIMessage(tool_calls=[...]))]
}}

# 条件边判断
{"type": "checkpoint", "timestamp": "...", "step": 2, "payload": {
    "config": {...}, "values": {"messages": [...]}
}}
```

**如何使用**：在 Gateway 请求中加 `stream_mode=["debug"]`：

```bash
curl -N -X POST http://127.0.0.1:2024/threads/{thread_id}/runs/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "assistant_id": "lead_agent",
    "input": {"messages": [{"role": "user", "content": "帮我分析苹果股票"}]},
    "stream_mode": ["debug", "values"]
  }'
```

SSE 中会出现 `event: debug` 的事件，里面包含每个节点的 name、input、output。

### 4.2 已有的 \[FLOW] 日志（自定义埋点）

在项目代码 13 个关键文件中已经加了 `[FLOW]` 前缀的日志（见第 2 章）。启动后在控制台搜 `[FLOW]` 可看到：

- `make_lead_agent` 构建过程
- 每个 middleware 的 `before_agent`、`before_model`、`after_model`、`after_agent` 钩子执行
- LLM 调用的输入（消息数、工具数）和输出（是否有 tool\_calls）

### 4.3 已有的 \[STREAM] 日志（chunk 级别追踪）

`worker.py` 中已添加的 `_log_chunk_detail()` 函数（见 [08-worker-react-loop.md](08-worker-react-loop.md)），对每个 chunk 打印：

- **values 模式**：state\_keys、消息总数、最近 3 条消息摘要
- **updates 模式**：执行的节点名、写入的 keys
- **messages 模式**：token chunk 类型和内容

控制台搜 `[STREAM]` 即可看到 ReAct 循环的完整进度。

### 4.4 LangSmith Tracing（可视化追踪，需 API Key）

配置环境变量：

```bash
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=deer-flow-debug
```

启动后，每次请求的完整执行链路（包括 LLM 调用参数、工具调用参数和返回值、每一步耗时）都会上报到 [LangSmith](https://smith.langchain.com/)。在 Web UI 中可以看到：

- 完整的 trace 树（graph → model → tool → model → ...）
- 每步的 input/output（完整的 messages、tool\_calls、ToolMessage）
- token 使用量和耗时
- 错误详情

### 4.5 Langfuse Tracing（开源替代方案）

如果不想用 LangSmith，也支持 Langfuse（开源 LLM 可观测性平台）：

```bash
LANGFUSE_TRACING=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxx
LANGFUSE_SECRET_KEY=sk-lf-xxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

### 4.6 LangGraph Studio（可视化调试界面）

`make dev` 启动后自动连接 [LangGraph Studio](https://smith.langchain.com/studio/)。在 Studio 中可以：

- 实时看到 StateGraph 的图结构
- 每个节点高亮显示当前执行到哪一步
- 查看每一步的完整 state 快照
- 手动 replay 某一步

### 调试手段对比

| 方法                    | 配置成本             | 信息详细度 | 适用场景                   |
| --------------------- | ---------------- | ----- | ---------------------- |
| `[FLOW]` 日志           | 零（已内置）           | ★★★   | 快速确认 middleware 执行顺序   |
| `[STREAM]` chunk 日志   | 零（已内置）           | ★★★   | 追踪 ReAct 循环进度和消息流转     |
| `stream_mode="debug"` | 零（改请求参数）         | ★★★★★ | 查看每个节点的完整 input/output |
| LangSmith Tracing     | 需 API Key        | ★★★★★ | 生产环境完整链路追踪，Web UI 可视化  |
| LangGraph Studio      | 零（`make dev` 自带） | ★★★★  | 可视化图执行过程、交互式调试         |
