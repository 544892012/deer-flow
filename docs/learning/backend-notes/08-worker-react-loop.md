# worker.py 详解：ReAct 循环的运行时宿主

---

## 核心定位

`worker.py`（`packages/harness/deerflow/runtime/runs/worker.py`）是 **ReAct 循环的运行时宿主**。它不参与 ReAct 循环的内部逻辑（那是 LangGraph 框架的事），而是负责：

1. **构建和配置 Agent**（调用 `agent_factory`）
2. **启动 `agent.astream()`**（ReAct 循环入口）
3. **逐 chunk 消费并发布到 StreamBridge**（SSE 推送给前端）
4. **管理 run 的生命周期状态**（pending → running → success/error/interrupted）

## worker.py 的执行步骤

```python
async def run_agent(bridge, run_manager, record, *, agent_factory, graph_input, config, ...):

    # 步骤 1: 标记 run 状态为 running
    await run_manager.set_status(run_id, RunStatus.running)

    # 步骤 2: 发布 metadata 事件（前端 useStream 需要 run_id + thread_id）
    await bridge.publish(run_id, "metadata", {"run_id": ..., "thread_id": ...})

    # 步骤 3: 构建 Agent（调用 make_lead_agent）
    agent = agent_factory(config=runnable_config)
    #   → 返回 CompiledStateGraph

    # 步骤 4: 挂载 checkpointer 和 store
    agent.checkpointer = checkpointer   # 持久化对话状态
    agent.store = store                 # 跨线程存储

    # 步骤 5: 设置中断节点（如果有）
    agent.interrupt_before_nodes = interrupt_before
    agent.interrupt_after_nodes = interrupt_after

    # 步骤 6: 构建 stream_mode 列表
    # "messages-tuple" → "messages"，过滤掉 "events"（不支持）

    # 步骤 7: ★★★ 启动 ReAct 循环 ★★★
    async for chunk in agent.astream(graph_input, config, stream_mode=...):
        # 这里的每一个 chunk 对应 ReAct 循环中的一次节点执行
        # 框架内部：model → tools → model → ... 每次节点产出都 yield 一个 chunk
        await bridge.publish(run_id, sse_event, serialize(chunk))

    # 步骤 8: 更新最终状态
    await run_manager.set_status(run_id, RunStatus.success)
```

## agent.astream() 产出的 chunk 内容

`agent.astream()` 的输出取决于 `stream_mode`：

### stream_mode="values"（默认）

每次节点执行后，yield 完整的 state 快照：

```python
# chunk 示例（第 1 次 yield：before_agent 执行后）
{
    "messages": [HumanMessage("帮我分析一下股票")],
    "sandbox": {...},
    "thread_data": {...}
}

# chunk 示例（第 2 次 yield：model 执行后，LLM 决定调用工具）
{
    "messages": [
        HumanMessage("帮我分析一下股票"),
        AIMessage(content="", tool_calls=[{"name": "get_stock_info", "args": {"symbol": "AAPL"}}])
    ],
    ...
}

# chunk 示例（第 3 次 yield：tools 执行后）
{
    "messages": [
        HumanMessage("帮我分析一下股票"),
        AIMessage(tool_calls=[...]),
        ToolMessage(name="get_stock_info", content="Apple Inc. 股价: $185.50...")
    ],
    ...
}

# chunk 示例（第 4 次 yield：model 再次执行后，LLM 给出最终回复）
{
    "messages": [
        HumanMessage("帮我分析一下股票"),
        AIMessage(tool_calls=[...]),
        ToolMessage(...),
        AIMessage(content="根据查询结果，Apple 当前股价为 $185.50...")
    ],
    ...
}
```

### stream_mode="updates"

每次节点执行后，yield 增量更新（`{节点名: 写入的数据}`）：

```python
# model 节点执行后
{"model": {"messages": [AIMessage(tool_calls=[...])]}}

# tools 节点执行后
{"tools": {"messages": [ToolMessage(name="get_stock_info", content="...")]}}

# model 再次执行后
{"model": {"messages": [AIMessage(content="最终回复...")]}}
```

### stream_mode="messages"

LLM token 级别的流式输出（实时打字效果）：

```python
# (message_chunk, metadata)
(AIMessageChunk(content="根"), {"langgraph_node": "model"})
(AIMessageChunk(content="据"), {"langgraph_node": "model"})
(AIMessageChunk(content="查"), {"langgraph_node": "model"})
...
```

## chunk 序号与 ReAct 循环的对应关系（values 模式）

```
chunk #1 — ThreadDataMiddleware.before_agent 执行后
chunk #2 — UploadsMiddleware.before_agent 执行后
chunk #3 — SandboxMiddleware.before_agent 执行后
chunk #4 — (如有) SummarizationMiddleware.before_model 执行后
chunk #5 — model 节点执行后（包含 AIMessage，可能有 tool_calls）
chunk #6 — TitleMiddleware.after_model 执行后
chunk #7 — LoopDetectionMiddleware.after_model 执行后
chunk #8 — tools 节点执行后（包含 ToolMessage）
chunk #9 — (循环回到) before_model → model 执行后
chunk #10 — after_model 执行后
... （循环直到 LLM 不再调用工具）
chunk #N — MemoryMiddleware.after_agent 执行后
chunk #N+1 — SandboxMiddleware.after_agent 执行后
```

## worker.py 与 ReAct 循环的关系

```
┌────────────── worker.py ──────────────────────────┐
│                                                   │
│  run_agent()                                      │
│    │                                              │
│    ├→ agent = agent_factory(config)                │
│    │                                              │
│    ├→ async for chunk in agent.astream(...):       │
│    │     │                                        │
│    │     │  ┌───── LangGraph 框架内部 ──────┐     │
│    │     │  │                               │     │
│    │     │  │  ReAct 循环                   │     │
│    │     │  │  before_agent → before_model  │     │
│    │     │  │  → model → after_model        │     │
│    │     │  │  → (条件边) → tools           │     │
│    │     │  │  → (条件边) → 回循环/结束     │     │
│    │     │  │                               │     │
│    │     │  │  每个节点执行完 → yield chunk │     │
│    │     │  └───────────────────────────────┘     │
│    │     │                                        │
│    │     └→ bridge.publish(chunk)  → SSE → 前端   │
│    │                                              │
│    └→ set_status(success/error)                   │
│                                                   │
└───────────────────────────────────────────────────┘
```

**关键认知**：`worker.py` 只是 ReAct 循环的"消费者"，它通过 `async for` 被动接收框架 yield 出来的 chunk。ReAct 循环的控制权完全在 LangGraph 框架内部——`worker.py` 无法控制循环次数、节点跳转或工具调用，它只能选择是否中止（`abort_event`）。

## 已添加的 Debug 日志

在 `worker.py` 中添加了 `_log_chunk_detail()` 函数，对每个 chunk 打印详细信息：

- **values 模式**：打印 state_keys、总消息数、最近 3 条消息摘要（类型 + 内容预览 + tool_calls）
- **updates 模式**：打印执行的节点名、写入的 keys、新增消息的类型
- **messages 模式**：打印 token chunk 的类型和内容
- 所有模式都打印 chunk 序号，方便追踪 ReAct 循环的进度

日志输出示例：

```
[STREAM] chunk #1 mode=values — state_keys=['messages', 'sandbox', 'thread_data'], total_msgs=1, recent=[Human(帮我分析一下股票)]
[STREAM] chunk #5 mode=values — state_keys=['messages', ...], total_msgs=2, recent=[Human(...) | AI(tools=['get_stock_info'], content='')]
[STREAM] chunk #8 mode=values — state_keys=['messages', ...], total_msgs=3, recent=[AI(tools=[...]) | Tool(get_stock_info: 'Apple Inc...')]
[STREAM] chunk #12 mode=values — state_keys=['messages', ...], total_msgs=4, recent=[Tool(...) | AI('根据查询结果...')]
```
