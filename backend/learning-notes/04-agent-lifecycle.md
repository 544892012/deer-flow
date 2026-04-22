# Agent 实例的生命周期：每个请求都创建新 Agent

---

## 结论

**每个 run（请求）都会调用 `make_lead_agent(config)` 创建一个全新的 Agent 实例。** 不同请求之间不共享 Agent 对象。

## 为什么这么设计

`make_lead_agent` 是一个 **工厂函数**（Factory Function），不是单例。每次请求可能携带不同的配置：
- 不同的 model（`deepseek-reasoner` vs `gpt-4o`）
- 不同的 thinking 模式（开启/关闭）
- 不同的 agent_name（自定义 Agent）
- 不同的 tool groups

所以必须为每个请求动态构建 Agent 图。

## 两条路径的调用方式

### 路径一：LangGraph Server（端口 2024）

框架代码 `langgraph_api/graph.py` 的 `get_graph()` 函数：

```python
# langgraph_api/graph.py
async def get_graph(graph_id, config, ...):
    value = GRAPHS[graph_id]              # 取出注册的 make_lead_agent 函数
    if is_factory(graph_id):              # 判断是否是工厂函数
        config = ensure_config(config)
        value = invoke_factory(value, graph_id, config, server_runtime)
        # → 实际调用 make_lead_agent(config=runnable_config)
    yield graph_obj  # 返回编译好的 CompiledStateGraph
```

每次 `POST /threads/{id}/runs/stream` 请求到达时，LangGraph 的 worker 会调用 `get_graph()`，进而调用 `make_lead_agent(config)`。

### 路径二：Gateway API（端口 8001）

Gateway 的 `services.py` 和 `worker.py`：

```python
# services.py
agent_factory = resolve_agent_factory(body.assistant_id)  # 返回 make_lead_agent 函数引用
# → 传递给 run_agent(agent_factory=agent_factory, ...)

# worker.py
agent = agent_factory(config=runnable_config)  # 每次 run 都调用工厂函数
# → make_lead_agent(config) 返回新的 CompiledStateGraph
```

## make_lead_agent 每次调用做了什么

```
make_lead_agent(config)
  │
  ├─ 1. 解析请求级配置（model_name, thinking_enabled, agent_name 等）
  ├─ 2. 构建 Middleware 链（14 个，每次都创建新实例）
  ├─ 3. 加载工具列表（get_available_tools → MCP 工具走缓存）
  ├─ 4. 生成系统提示词（apply_prompt_template）
  └─ 5. create_agent() → 返回 CompiledStateGraph
```

## 哪些东西是"按请求创建"，哪些是"共享"的

| 对象 | 生命周期 | 说明 |
|------|---------|------|
| **CompiledStateGraph** | 请求级 | 每次 `make_lead_agent()` 返回新的图实例 |
| **Middleware 实例** | 请求级 | 每个 middleware 都是新建的 |
| **LLM Model** | 请求级 | `create_chat_model()` 创建新的 ChatModel 客户端 |
| **MCP 工具列表** | 缓存共享 | `get_cached_mcp_tools()` 返回缓存的工具（按 mtime 热更新） |
| **Config 工具** | 重新解析 | 每次从 `config.yaml` 读取并 `resolve_variable()` |
| **Checkpointer** | 进程级共享 | 同一个 SQLite/Postgres 连接 |
| **Store** | 进程级共享 | 线程数据存储 |

## 性能影响

每次请求创建新 Agent 不会产生显著性能问题，因为：
1. `make_lead_agent` 只做对象组装（~10ms），不做 I/O
2. MCP 工具走缓存，不会每次都启动 MCP Server 子进程
3. LLM Model 创建只是构造 HTTP 客户端对象，没有连接开销
4. 真正耗时的是 LLM 推理和工具调用，这些与 Agent 创建无关

如果框架日志中看到 "Slow graph load" 警告，说明 `make_lead_agent` 中有耗时操作（如 MCP 首次加载），可以通过预热来解决。

## 线程（Thread）的作用

虽然每个请求都创建新 Agent，但 **对话历史通过 Thread + Checkpointer 保持连续**：
- Thread 是对话会话的逻辑标识
- Checkpointer 负责持久化每一轮对话的 state（消息、artifacts 等）
- 新 Agent 通过 `config["configurable"]["thread_id"]` 关联到已有 Thread
- 执行 `graph.astream(input, config)` 时，框架自动从 Checkpointer 加载历史 state

所以用户看到的效果是"同一个 Agent 在持续对话"，但底层每次都是新建 Agent + 加载历史 state。这和 HTTP 的无状态设计理念一致——服务端不持有 session 对象，通过 ID 重建上下文。
