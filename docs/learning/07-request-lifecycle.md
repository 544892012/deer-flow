# 07 - 请求生命周期：从 HTTP 到 Agent Loop 的完整链路

## 全景调用链

```
用户浏览器
  │
  │ POST /api/langgraph/threads/{thread_id}/runs
  │ Body: {"input": {"messages": [...]}, "config": {"configurable": {...}}}
  ▼
┌─────────────────────────────────┐
│  Nginx (端口 2026)              │
│  /api/langgraph/* → 2024       │
└──────────┬──────────────────────┘
           ▼
┌─────────────────────────────────┐
│  LangGraph Server (端口 2024)   │
│                                 │
│  入口：runtime/runs/worker.py   │
│  函数：run_agent()              │
└──────────┬──────────────────────┘
           │
           │ ① agent_factory(config)
           │    即 make_lead_agent(config)
           ▼
┌─────────────────────────────────┐
│  make_lead_agent(config)        │
│  agents/lead_agent/agent.py     │
│                                 │
│  1. 解析 model_name             │
│  2. _build_middlewares()        │
│  3. get_available_tools()       │
│  4. apply_prompt_template()     │
│  5. create_agent(               │
│       model, tools, middleware, │
│       system_prompt,            │
│       state_schema=ThreadState  │
│     )                           │
│                                 │
│  返回：CompiledStateGraph       │
└──────────┬──────────────────────┘
           │
           │ ② agent.astream(input, config, stream_mode)
           ▼
┌──────────────────────────────────────────────────────────┐
│               LangGraph ReAct 循环                        │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  before_agent 中间件                              │    │
│  │  ThreadData → Uploads → Sandbox                  │    │
│  └──────────────────┬───────────────────────────────┘    │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  ┌─── ReAct 循环 ────────────────────────────┐   │    │
│  │  │                                            │   │    │
│  │  │  before_model 中间件                       │   │    │
│  │  │  (Summarization, ViewImage, LoopDetect...) │   │    │
│  │  │         ↓                                  │   │    │
│  │  │  LLM 推理 → AIMessage                     │   │    │
│  │  │         ↓                                  │   │    │
│  │  │  after_model 中间件                        │   │    │
│  │  │  (SubagentLimit, Clarification)            │   │    │
│  │  │         ↓                                  │   │    │
│  │  │  有 tool_calls?                            │   │    │
│  │  │    ├── 是 → 执行工具 → ToolMessage         │   │    │
│  │  │    │        ↑____________________________│   │    │
│  │  │    │        (回到 before_model)             │   │    │
│  │  │    │                                       │   │    │
│  │  │    └── 否 → 退出循环                       │   │    │
│  │  └────────────────────────────────────────────┘   │    │
│  └──────────────────┬───────────────────────────────┘    │
│                     ▼                                    │
│  ┌──────────────────────────────────────────────────┐    │
│  │  after_agent 中间件                               │    │
│  │  释放 Sandbox、更新 Memory、生成 Title            │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────┬───────────────────────────────────┘
                       │
                       │ ③ 每个 chunk → bridge.publish()
                       ▼
┌──────────────────────────────────────────────────────────┐
│  SSE 事件流                                               │
│                                                          │
│  event: metadata    → {run_id, thread_id}                │
│  event: values      → 全量状态快照                        │
│  event: messages    → (AIMessageChunk, metadata)         │
│  event: custom      → {type: "task_started/running/..."}│
│  event: end         → 流结束                              │
└──────────────────────┬───────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│  前端 (Next.js)                                           │
│  useStream() → 解析 SSE → 渲染聊天消息                    │
└──────────────────────────────────────────────────────────┘
```

## 详细步骤解析

### 第一步：langgraph.json 注册 Agent 工厂

```json
{
  "graphs": {
    "lead_agent": "deerflow.agents:make_lead_agent"
  },
  "checkpointer": {
    "path": "./packages/harness/deerflow/agents/checkpointer/async_provider.py:make_checkpointer"
  }
}
```

- `graphs.lead_agent` 声明了 Agent 工厂函数的 Python 导入路径
- LangGraph Server 启动时加载此配置，知道「收到请求时调用哪个函数创建 Agent」
- `checkpointer` 声明了检查点工厂，用于持久化线程状态

### 第二步：HTTP 请求到达

```
POST /api/langgraph/threads/{thread_id}/runs/stream
Content-Type: application/json

{
  "input": {
    "messages": [{"role": "user", "content": "帮我写个 Python 脚本"}]
  },
  "config": {
    "configurable": {
      "model_name": "deepseek-v3",
      "thinking_enabled": true,
      "subagent_enabled": true,
      "max_concurrent_subagents": 3
    }
  },
  "stream_mode": ["values", "messages"]
}
```

Nginx 将 `/api/langgraph/*` 代理到 LangGraph Server（端口 2024）。

### 第三步：run_agent() 启动执行

`runtime/runs/worker.py:run_agent()` 是执行入口：

```python
async def run_agent(bridge, run_manager, record, *, agent_factory, ...):
    # 1. 标记运行状态为 running
    await run_manager.set_status(run_id, RunStatus.running)

    # 2. 发布 metadata SSE 事件
    await bridge.publish(run_id, "metadata", {"run_id": ..., "thread_id": ...})

    # 3. 构建 Runtime（注入 thread_id 到中间件可访问的上下文）
    runtime = Runtime(context={"thread_id": thread_id}, store=store)
    config["configurable"]["__pregel_runtime"] = runtime

    # 4. 调用工厂函数创建 Agent
    agent = agent_factory(config=runnable_config)
    #        ↑ 就是 make_lead_agent(config)
    #        ↑ 返回 CompiledStateGraph

    # 5. 挂载 checkpointer（用于恢复历史对话）
    agent.checkpointer = checkpointer

    # 6. 启动流式执行
    async for chunk in agent.astream(graph_input, config=runnable_config, stream_mode=...):
        await bridge.publish(run_id, sse_event, serialize(chunk))
        # 每个 chunk 是 LangGraph 图的一个状态变化

    # 7. 标记完成
    await run_manager.set_status(run_id, RunStatus.success)
```

### 第四步：make_lead_agent 创建 CompiledStateGraph

`create_agent()` 是 LangChain 提供的 ReAct Agent 构造器，返回 `CompiledStateGraph`：

```python
def make_lead_agent(config: RunnableConfig):
    model_name = _resolve_model_name(requested_model_name)
    middlewares = _build_middlewares(config, model_name=model_name)
    tools = get_available_tools(model_name=model_name, subagent_enabled=True)
    system_prompt = apply_prompt_template(...)

    return create_agent(
        model=create_chat_model(name=model_name, thinking_enabled=True),
        tools=tools,
        middleware=middlewares,
        system_prompt=system_prompt,
        state_schema=ThreadState,
    )
    # 返回 CompiledStateGraph，自带 .astream() / .invoke()
```

`CompiledStateGraph` 内部结构：

```
CompiledStateGraph
├── nodes:
│   ├── "agent"   → 调用 LLM + 中间件
│   └── "tools"   → 执行工具调用
├── edges:
│   ├── START → "agent"
│   ├── "agent" → (有tool_calls?) → "tools"
│   ├── "agent" → (无tool_calls?) → END
│   └── "tools" → "agent"
├── state_schema: ThreadState
├── checkpointer: AsyncSqliteSaver / InMemorySaver / ...
└── middleware_chain: [ThreadData, Uploads, Sandbox, ...]
```

### 第五步：ReAct 循环执行

`agent.astream()` 启动 LangGraph 的核心循环：

```
调用 astream({"messages": [HumanMessage("帮我写个脚本")]})
  │
  ├── [before_agent] 中间件执行：
  │     ThreadDataMiddleware → 设置 workspace/uploads/outputs 路径
  │     UploadsMiddleware    → 注入已上传文件信息
  │     SandboxMiddleware    → 获取沙箱（懒初始化）
  │
  ├── [ReAct 循环 - 第 1 轮]
  │     ├── [before_model] SummarizationMiddleware → 检查 token 是否超限
  │     ├── LLM 推理 → AIMessage(tool_calls=[{name:"bash", args:{...}}])
  │     ├── [after_model] SubagentLimitMiddleware → 检查 task 调用数
  │     ├── 执行 bash 工具 → ToolMessage(content="文件已创建")
  │     └── 回到 before_model
  │
  ├── [ReAct 循环 - 第 2 轮]
  │     ├── [before_model] ...
  │     ├── LLM 推理 → AIMessage(content="脚本已写好，路径是...")
  │     ├── [after_model] ...
  │     ├── 无 tool_calls → 退出循环
  │     └── 
  │
  ├── [after_agent] 中间件执行：
  │     SandboxMiddleware → 释放沙箱
  │     MemoryMiddleware  → 异步队列更新长期记忆
  │     TitleMiddleware   → 生成对话标题
  │
  └── 完成
```

### 第六步：SSE 流式推送

每个状态变化通过 `StreamBridge` 推送为 SSE 事件：

| SSE 事件 | 触发时机 | 数据内容 |
|----------|---------|---------|
| `metadata` | 运行开始 | `{run_id, thread_id}` |
| `values` | 每次状态变化 | 完整 ThreadState 快照 |
| `messages` | LLM 产出每个 token | `(AIMessageChunk, metadata)` |
| `custom` | 子任务事件 | `{type: "task_started/running/completed"}` |
| `end` | 运行结束 | — |

### 第七步：前端接收

前端通过 LangGraph SDK 的 `useStream` hook 消费 SSE：

```typescript
const { messages, threadId } = useStream({
  apiUrl: "/api/langgraph",
  threadId: currentThreadId,
  // 解析 SSE 事件，实时渲染聊天气泡
});
```

## 两种调用方式对比

| 维度 | LangGraph Server（HTTP 方式） | DeerFlowClient（嵌入式方式） |
|------|------------------------------|------------------------------|
| 入口 | `langgraph.json` + HTTP 请求 | `DeerFlowClient.astream()` |
| Agent 创建 | `run_agent()` 调用 `agent_factory()` | `_ensure_agent()` 调用 `create_agent()` |
| 检查点 | LangGraph Server 自动管理 | 需手动传入 `checkpointer` |
| 流式输出 | SSE → `StreamBridge` | Python async generator |
| 适用场景 | Web 应用、多端接入 | Python SDK 嵌入、测试 |

## ReAct 循环的底层实现

ReAct 循环的核心实现在 **LangChain 的 `langchain.agents.factory.create_agent()`** 函数中（不是 DeerFlow 自己写的）。

源码位置：`backend/.venv/lib/python3.12/site-packages/langchain/agents/factory.py`

### create_agent 做了什么？

`create_agent()` 不是简单的工具函数，它在内部 **构造了一个完整的 LangGraph StateGraph 并编译**：

```python
def create_agent(model, tools, middleware, system_prompt, state_schema, ...):
    # 1. 构造 StateGraph（状态机图）
    graph = StateGraph(state_schema=resolved_state_schema)

    # 2. 添加两个核心节点
    graph.add_node("model", model_node)      # LLM 推理节点
    graph.add_node("tools", ToolNode(...))   # 工具执行节点

    # 3. 为每个中间件添加节点
    for m in middleware:
        graph.add_node(f"{m.name}.before_agent", m.before_agent)
        graph.add_node(f"{m.name}.before_model", m.before_model)
        graph.add_node(f"{m.name}.after_model",  m.after_model)
        graph.add_node(f"{m.name}.after_agent",  m.after_agent)

    # 4. 连接边（构造执行流）
    graph.add_edge(START, entry_node)            # 入口
    graph.add_conditional_edges(                  # 条件分支
        loop_exit_node,
        model_to_tools_edge,                     # 有 tool_calls → tools
                                                  # 无 tool_calls → exit
    )
    graph.add_conditional_edges(                  # 工具执行完回到模型
        "tools",
        tools_to_model_edge,                     # → loop_entry_node
    )

    # 5. 编译为 CompiledStateGraph
    return graph.compile(checkpointer=..., recursion_limit=10_000)
```

### 编译后的图结构

```
START
  │
  ▼
┌────────────────────────────────────────────────────────────────────────┐
│  before_agent 中间件链 (仅执行一次)                                     │
│  ThreadData.before_agent → Uploads.before_agent → Sandbox.before_agent │
└────────────────┬───────────────────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│  ┌── ReAct 循环（loop_entry_node ~ loop_exit_node）────────────────┐  │
│  │                                                                  │  │
│  │  before_model 中间件链                                           │  │
│  │  Summarization.before_model → ViewImage.before_model → ...      │  │
│  │         ↓                                                        │  │
│  │  "model" 节点                                                    │  │
│  │    model_node(state, runtime):                                   │  │
│  │      request = ModelRequest(model, tools, messages, ...)         │  │
│  │      model.bind_tools(tools)                                     │  │
│  │      output = model.ainvoke(messages)                            │  │
│  │      return {"messages": [output]}                               │  │
│  │         ↓                                                        │  │
│  │  after_model 中间件链                                            │  │
│  │  SubagentLimit.after_model → LoopDetection.after_model → ...    │  │
│  │         ↓                                                        │  │
│  │  ┌─ 条件分支（model_to_tools_edge）─────────────────────────┐   │  │
│  │  │                                                           │   │  │
│  │  │  tool_calls 为空？                                        │   │  │
│  │  │    └── 是 → exit_node（退出循环）                         │   │  │
│  │  │                                                           │   │  │
│  │  │  tool_calls 不为空？                                      │   │  │
│  │  │    └── 否 → "tools" 节点                                  │   │  │
│  │  │              │                                            │   │  │
│  │  │              │ ToolNode 并行执行所有 tool_calls            │   │  │
│  │  │              │ 每个产出 ToolMessage                       │   │  │
│  │  │              │                                            │   │  │
│  │  │              ▼                                            │   │  │
│  │  │         tools_to_model_edge                               │   │  │
│  │  │              └── → loop_entry_node（回到循环开头）         │   │  │
│  │  └───────────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────┬───────────────────────────────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│  after_agent 中间件链 (仅执行一次)                                      │
│  Sandbox.after_agent → Memory.after_agent → Title.after_agent          │
└────────────────┬───────────────────────────────────────────────────────┘
                 │
                 ▼
                END
```

### 退出循环的条件

循环退出逻辑在 `_make_model_to_tools_edge` 中：

```python
def model_to_tools(state):
    last_ai_message = get_last_ai_message(state)
    
    # 条件 1：中间件设置了 jump_to（如 ClarificationMiddleware 跳到 END）
    if state.get("jump_to"):
        return resolve_jump(jump_to)
    
    # 条件 2：LLM 没有调用任何工具 → 退出循环
    if len(last_ai_message.tool_calls) == 0:
        return exit_node
    
    # 条件 3：有待执行的 tool_calls → 并行发送到 tools 节点
    pending = [c for c in tool_calls if not already_executed]
    if pending:
        return [Send("tools", call) for call in pending]
    
    # 条件 4：有结构化输出 → 退出
    if "structured_response" in state:
        return exit_node
    
    # 条件 5：其他情况 → 继续循环
    return loop_entry_node
```

### 中间件不是简单函数调用

中间件**不是**在 Python 函数栈里顺序调用的。`create_agent` 把每个中间件的每个 hook 都转化为 **LangGraph 图的独立节点**，通过边连接：

```
ThreadData.before_agent → (edge) → Uploads.before_agent → (edge) → Sandbox.before_agent
```

这意味着：
- 每个中间件 hook 的执行都会产生检查点
- 中间件可以通过 `Command(goto=END)` 跳转到任意节点
- 状态更新通过 LangGraph 的 reducer 合并（不是直接覆盖）
- recursion_limit 设置为 10,000（允许大量工具调用轮次）

## 关键源码文件

| 文件 | 角色 |
|------|------|
| `backend/langgraph.json` | Agent 工厂注册 |
| `runtime/runs/worker.py` | `run_agent()` — 启动 Agent 循环 |
| `agents/lead_agent/agent.py` | `make_lead_agent()` — 创建 Agent |
| `.venv/.../langchain/agents/factory.py` | `create_agent()` — ReAct 循环核心实现 |
| `client.py` | `DeerFlowClient` — 嵌入式调用方式 |
| `agents/checkpointer/async_provider.py` | 检查点工厂 |
| `runtime/stream_bridge.py` | SSE 事件桥接 |
