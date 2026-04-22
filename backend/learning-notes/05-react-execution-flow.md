# Agent 创建后的 ReAct 执行流程

---

## 核心问题

`make_lead_agent(config)` 返回一个 `CompiledStateGraph`。调用 `agent.astream(input, config)` 后，**剩下的全部工作由 LangGraph 框架完成**——这是一个标准的 ReAct（Reasoning + Acting）循环。

## 整体调用链

```
用户请求
│
├→ stream_run()                              # thread_runs.py — HTTP 入口
│   └→ start_run()                           # services.py — 编排
│       ├→ agent_factory = resolve_agent_factory()  # 返回 make_lead_agent 函数引用
│       ├→ graph_input = normalize_input(body.input)
│       ├→ config = build_run_config(...)
│       └→ asyncio.create_task(run_agent(...))      # 后台任务
│
└→ run_agent()                               # worker.py — 后台执行
    ├→ 1. set_status(running)
    ├→ 2. publish metadata (run_id, thread_id)
    ├→ 3. agent = agent_factory(config)       # ← make_lead_agent(config)
    │      → 返回 CompiledStateGraph
    ├→ 4. agent.checkpointer = checkpointer   # 挂载持久化
    ├→ 5. agent.store = store                 # 挂载跨线程存储
    ├→ 6. 构建 stream_mode 列表
    ├→ 7. agent.astream(input, config, stream_mode=...)  ← ReAct 循环开始
    │      │
    │      ↓ （框架完全接管）
    │      ┌─────────────────────────────────────────────┐
    │      │              ReAct 循环                      │
    │      │                                             │
    │      │  before_agent → before_model → model_node   │
    │      │       ↑                          ↓          │
    │      │       │                   有 tool_calls?    │
    │      │       │                    ↙         ↘      │
    │      │       │                 是             否    │
    │      │       │                 ↓              ↓     │
    │      │   after_model ← tools_node     after_agent  │
    │      │       │                              ↓      │
    │      │       └──→ 继续循环              END（结束）│
    │      └─────────────────────────────────────────────┘
    │
    ├→ 8. 逐 chunk 发布到 StreamBridge → SSE 推送给前端
    └→ 9. set_status(success / interrupted / error)
```

## create_agent 构建的 StateGraph 结构

`langchain.agents.factory.create_agent()` 的核心工作是构建一个 **StateGraph**（状态图），然后 `compile()` 返回 `CompiledStateGraph`。

图中有以下节点和边：

### 节点（Nodes）

| 节点名 | 类型 | 职责 |
|--------|------|------|
| `{middleware}.before_agent` | Middleware 钩子 | 入口时运行一次（初始化线程目录、加载上传文件等） |
| `{middleware}.before_model` | Middleware 钩子 | 每轮循环前运行（注入 context、修改 messages 等） |
| `model` | 核心节点 | 调用 LLM（`model.ainvoke(messages)`），返回 AIMessage |
| `{middleware}.after_model` | Middleware 钩子 | 每轮循环后运行（检测循环、处理异常等） |
| `tools` | ToolNode | 执行 LLM 返回的 tool_calls，生成 ToolMessage |
| `{middleware}.after_agent` | Middleware 钩子 | 结束时运行一次（生成标题、更新记忆等） |

### 边（Edges）— 决定执行流向

```
START → before_agent[0] → before_agent[1] → ... → before_model[0] → ... → model
                                                                              │
                                                                    （条件边）
                                                                   ↙          ↘
                                                            有 tool_calls    无 tool_calls
                                                                  ↓               ↓
                                                          after_model →      after_agent → END
                                                                  ↓
                                                          （条件边）
                                                         有待执行工具?
                                                          ↙        ↘
                                                        是          否
                                                        ↓           ↓
                                                     tools      after_agent → END
                                                        ↓
                                                （条件边：tools → ?）
                                                 return_direct?
                                                  ↙          ↘
                                                是            否
                                                ↓             ↓
                                          after_agent    before_model（回到循环）
```

### 关键条件边逻辑

**model → tools / end**（`_make_model_to_tools_edge`）：

```python
def model_to_tools(state):
    # 1. 检查 middleware 的 jump_to 指令
    if state.get("jump_to"):
        return resolve_jump(...)

    # 2. 最后一条 AIMessage 没有 tool_calls → 结束循环
    if len(last_ai_message.tool_calls) == 0:
        return exit_node

    # 3. 有待执行的 tool_calls → 并行发送到 tools 节点
    if pending_tool_calls:
        return [Send("tools", tool_call) for tool_call in pending_tool_calls]

    # 4. 有 structured_response → 结束
    if "structured_response" in state:
        return exit_node

    # 5. 其他情况（middleware 注入了 ToolMessage）→ 回到 model
    return model_destination
```

**tools → model / end**（`_make_tools_to_model_edge`）：

```python
def tools_to_model(state):
    # 1. 所有工具都设置了 return_direct → 结束（直接返回工具结果给用户）
    if all(tool.return_direct for tool in executed_tools):
        return exit_node

    # 2. 执行了 structured_output 工具 → 结束
    if any(tool.name in structured_output_tools for tool in tool_messages):
        return exit_node

    # 3. 默认：回到 model 继续循环
    return model_destination
```

## model_node 内部流程

model_node 是 ReAct 循环的核心，每轮执行过程：

```python
async def amodel_node(state, runtime):
    # 1. 构建 ModelRequest
    request = ModelRequest(
        model=model,                  # ChatModel 实例
        tools=default_tools,          # 所有可用工具
        system_message=system_message,# 系统提示词
        messages=state["messages"],   # 历史消息（含上一轮的 ToolMessage）
        ...
    )

    # 2. 经过 wrap_model_call middleware 链（如有）
    #    middleware 可以拦截/修改请求，或包装重试逻辑
    response = await awrap_model_call_handler(request, _execute_model_async)

    # 3. _execute_model_async 内部：
    #    a. bind_tools — 把工具 schema 绑定到 model
    #    b. model.ainvoke([system_message, ...messages])
    #    c. 返回 AIMessage（可能包含 tool_calls）
    #    d. 处理 structured_output（如果有）

    return {"messages": response.result}
```

## ToolNode 并行执行

当 model 返回多个 tool_calls 时，LangGraph 使用 `Send()` 机制并行执行：

```python
# 条件边返回 Send 列表，每个 tool_call 独立发送到 tools 节点
return [
    Send("tools", ToolCallWithContext(tool_call=tc, state=state))
    for tc in pending_tool_calls
]
```

每个 `Send` 会创建独立的执行分支，`ToolNode` 查找对应工具并执行：

```python
tool = self.tools_by_name[tool_call["name"]]
result = await tool.ainvoke(tool_call["args"])
# → 返回 ToolMessage，追加到 state["messages"]
```

所有并行 tool 执行完毕后，结果汇聚回主图，再次进入条件边判断。

## Middleware 在 ReAct 循环中的执行时机

| 钩子 | 执行频率 | 典型 Middleware | 作用 |
|------|---------|----------------|------|
| `before_agent` | 1 次（入口） | ThreadDataMiddleware, SandboxMiddleware, UploadsMiddleware | 初始化线程目录、准备沙箱、处理上传文件 |
| `before_model` | 每轮循环 | DanglingToolCallMiddleware, ViewImageMiddleware | 修补缺失的 ToolMessage、注入图片详情 |
| `wrap_model_call` | 每轮循环（包裹 model 调用） | ToolErrorHandlingMiddleware | 捕获工具异常转换为 ToolMessage |
| `after_model` | 每轮循环 | LoopDetectionMiddleware, SubagentLimitMiddleware | 检测循环调用、限制并发子代理数 |
| `after_agent` | 1 次（出口） | TitleMiddleware, MemoryMiddleware, ClarificationMiddleware | 生成标题、更新记忆、处理澄清请求 |

完整的 Middleware 执行顺序（DeerFlow 中 `_build_middlewares` 构建）：

```
1.  ToolErrorHandlingMiddleware  — wrap_model_call：捕获工具执行异常
2.  SandboxMiddleware            — before_agent：创建沙箱环境
3.  ThreadDataMiddleware         — before_agent：设置线程数据目录
4.  UploadsMiddleware            — before_agent：处理用户上传文件
5.  DanglingToolCallMiddleware   — before_model：修补缺失的 ToolMessage
6.  SummarizationMiddleware      — (如启用) 压缩过长的对话历史
7.  TodoMiddleware               — (如 plan_mode) 注入 TODO 管理工具
8.  TokenUsageMiddleware         — 跟踪 token 使用量
9.  TitleMiddleware              — after_agent：首次交互后生成对话标题
10. MemoryMiddleware             — after_agent：将对话排入记忆更新队列
11. ViewImageMiddleware          — before_model：(如模型支持视觉) 注入图片描述
12. DeferredToolFilterMiddleware — (如启用工具搜索) 延迟加载工具
13. SubagentLimitMiddleware      — after_model：(如启用子代理) 限制并发数
14. LoopDetectionMiddleware      — after_model：检测重复工具调用循环
15. ClarificationMiddleware      — after_model：拦截澄清请求（始终最后）
```

## 流式输出机制

`agent.astream()` 每产生一个 chunk，`worker.py` 都会发布到 `StreamBridge`：

```python
async for chunk in agent.astream(input, config, stream_mode=mode):
    if record.abort_event.is_set():
        break
    await bridge.publish(run_id, sse_event, serialize(chunk))
```

StreamBridge 是一个内存中的 pub/sub 系统：
- **发布者**：worker 的 `run_agent` 协程
- **消费者**：SSE 响应的 `sse_consumer` 异步生成器
- **格式**：每个事件序列化为 SSE 帧（`event: values\ndata: {...}\n\n`）

支持的 stream_mode：

| stream_mode | SSE event | 内容 |
|-------------|-----------|------|
| `values` | `values` | 完整 state 快照（每个节点执行后） |
| `updates` | `updates` | 增量更新（`{node_name: writes}`） |
| `messages` | `messages` | LLM token 流式输出 |
| `debug` | `debug` | 调试信息 |

## 停止条件总结

ReAct 循环在以下条件下停止：

1. **LLM 无 tool_calls** — 最常见的停止条件，LLM 判断已获得足够信息，直接给出文本回复
2. **所有 tool_calls 都是 return_direct** — 工具结果直接返回用户，不经过 LLM 再处理
3. **Structured Output** — 生成了结构化输出响应
4. **Middleware jump_to="end"** — Middleware 指令强制结束
5. **recursion_limit** — 达到最大递归深度（默认 10,000）
6. **abort_event** — 用户取消请求
7. **异常** — 执行过程中抛出未捕获的异常

## 关键结论

1. **make_lead_agent 只负责"组装图"**，真正的 ReAct 循环完全由 LangGraph 框架的 `graph.astream()` 驱动
2. **ReAct 循环 = model_node ↔ tools_node 交替执行**，通过条件边决定跳转方向
3. **Middleware 是 LangGraph 的一等公民**，通过 StateGraph 的节点和边实现，不是外部包装
4. **工具并行执行** — 多个 tool_calls 通过 `Send()` 机制并行分发到 ToolNode
5. **整个流程是异步非阻塞的** — `astream` 产生的每个 chunk 实时推送给前端
