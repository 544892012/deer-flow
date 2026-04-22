# DeerFlow Lead Agent 的 StateGraph 节点与边详解

---

## 概述

`create_agent()` 函数（位于 `langchain/agents/factory.py`）根据传入的 middleware 列表动态构建 StateGraph。不同的 middleware 钩子类型决定了它在图中的存在形式：

| 钩子类型 | 图中表现 | 执行时机 |
|---------|---------|---------|
| `before_agent` | 独立节点 `{name}.before_agent` | 入口运行一次 |
| `before_model` | 独立节点 `{name}.before_model` | 每轮循环在 model 之前 |
| `after_model` | 独立节点 `{name}.after_model` | 每轮循环在 model 之后 |
| `after_agent` | 独立节点 `{name}.after_agent` | 出口运行一次 |
| `wrap_model_call` | **不生成节点**，内联在 model_node 内部 | 每轮循环，包裹 LLM 调用 |
| `wrap_tool_call` | **不生成节点**，内联在 tools (ToolNode) 内部 | 每次工具调用，包裹执行 |

## DeerFlow 完整 Middleware 列表与钩子映射

`_build_middlewares()` 函数（`agent.py`）构建完整的 middleware 链。以下是所有 middleware 的实际钩子和图中表现：

| # | Middleware | 钩子 | 图中节点 | 条件 |
|---|-----------|------|---------|------|
| 1 | ThreadDataMiddleware | `before_agent` | `ThreadDataMiddleware.before_agent` | 始终 |
| 2 | UploadsMiddleware | `before_agent` | `UploadsMiddleware.before_agent` | 始终 |
| 3 | SandboxMiddleware | `before_agent`, `after_agent` | `SandboxMiddleware.before_agent`, `SandboxMiddleware.after_agent` | 始终 |
| 4 | DanglingToolCallMiddleware | `wrap_model_call` | 无（内联在 model_node） | 始终 |
| 5 | LLMErrorHandlingMiddleware | `wrap_model_call` | 无（内联在 model_node） | 始终 |
| 6 | SandboxAuditMiddleware | `wrap_tool_call` | 无（内联在 ToolNode） | 始终 |
| 7 | ToolErrorHandlingMiddleware | `wrap_tool_call` | 无（内联在 ToolNode） | 始终 |
| 8 | SummarizationMiddleware | `before_model` | `SummarizationMiddleware.before_model` | 配置启用时 |
| 9 | TodoMiddleware | `before_model`, `after_model`, `wrap_model_call` | `TodoMiddleware.before_model`, `TodoMiddleware.after_model` | plan_mode 启用时 |
| 10 | TokenUsageMiddleware | `after_model` | `TokenUsageMiddleware.after_model` | token_usage 启用时 |
| 11 | TitleMiddleware | `after_model` | `TitleMiddleware.after_model` | 始终 |
| 12 | MemoryMiddleware | `after_agent` | `MemoryMiddleware.after_agent` | 始终 |
| 13 | ViewImageMiddleware | `before_model` | `ViewImageMiddleware.before_model` | 模型支持视觉时 |
| 14 | DeferredToolFilterMiddleware | `wrap_model_call` | 无（内联在 model_node） | tool_search 启用时 |
| 15 | SubagentLimitMiddleware | `after_model` | `SubagentLimitMiddleware.after_model` | subagent 启用时 |
| 16 | LoopDetectionMiddleware | `after_model` | `LoopDetectionMiddleware.after_model` | 始终 |
| 17 | ClarificationMiddleware | `wrap_tool_call` | 无（内联在 ToolNode） | 始终 |

## 完整的图节点列表

以最完整配置（所有条件都启用）为例，图中实际存在的节点：

```
=== before_agent 节点（入口，运行一次）===
1. ThreadDataMiddleware.before_agent     — 创建线程数据目录
2. UploadsMiddleware.before_agent        — 处理用户上传文件
3. SandboxMiddleware.before_agent        — 初始化沙箱环境

=== before_model 节点（每轮循环在 model 前）===
4. SummarizationMiddleware.before_model  — 压缩过长对话历史（条件）
5. TodoMiddleware.before_model           — 注入 TODO 上下文提醒（条件）
6. ViewImageMiddleware.before_model      — 注入图片详情消息（条件）

=== 核心节点 ===
7. model                                 — LLM 调用（内含 wrap_model_call 链）
8. tools (ToolNode)                      — 工具执行（内含 wrap_tool_call 链）

=== after_model 节点（每轮循环在 model 后）===
9. TodoMiddleware.after_model            — TODO 状态跟踪（条件）
10. TokenUsageMiddleware.after_model     — 记录 token 使用量（条件）
11. TitleMiddleware.after_model          — 首次交互后生成标题
12. SubagentLimitMiddleware.after_model  — 限制并发子代理数（条件）
13. LoopDetectionMiddleware.after_model  — 检测重复工具调用循环

=== after_agent 节点（出口，运行一次）===
14. SandboxMiddleware.after_agent        — 清理沙箱
15. MemoryMiddleware.after_agent         — 排队更新记忆
```

## 完整的边连接

### START → before_agent 链（入口路径，运行一次）

```
START
  → ThreadDataMiddleware.before_agent
  → UploadsMiddleware.before_agent
  → SandboxMiddleware.before_agent
  → [loop_entry_node]    ← 进入循环
```

`create_agent` 中对应的代码逻辑：

```python
entry_node = f"{middleware_w_before_agent[0].name}.before_agent"
graph.add_edge(START, entry_node)

for m1, m2 in itertools.pairwise(middleware_w_before_agent):
    graph.add_edge(f"{m1.name}.before_agent", f"{m2.name}.before_agent")

graph.add_edge(f"{last_before_agent.name}.before_agent", loop_entry_node)
```

### before_model → model 链（循环入口）

```
[loop_entry_node]
  = SummarizationMiddleware.before_model    ← 第一个 before_model
  → TodoMiddleware.before_model
  → ViewImageMiddleware.before_model
  → model                                   ← LLM 调用
```

`loop_entry_node` 是第一个 before_model middleware 的节点。before_model 节点之间通过普通边连接，最后一个连接到 `model`。

### model 内部（wrap_model_call 链）

model_node 内部执行时，不是直接调用 `model.ainvoke()`，而是经过 `wrap_model_call` 中间件链：

```
amodel_node(state, runtime)
  │
  └→ awrap_model_call_handler(request, _execute_model_async)
       │
       ├→ DanglingToolCallMiddleware.awrap_model_call
       │     修补缺失的 ToolMessage，然后调用 ↓
       ├→ LLMErrorHandlingMiddleware.awrap_model_call
       │     捕获 LLM 异常并重试，然后调用 ↓
       ├→ TodoMiddleware.awrap_model_call
       │     注入 write_todos 工具，然后调用 ↓
       ├→ DeferredToolFilterMiddleware.awrap_model_call
       │     过滤延迟加载的工具，然后调用 ↓
       └→ _execute_model_async(request)
              │
              ├→ model.bind_tools(tools)     绑定工具 schema
              ├→ model.ainvoke(messages)      调用 LLM API
              └→ 返回 AIMessage              可能含 tool_calls
```

组合方式是 **洋葱模型**（Onion Model）：

```python
wrap_model_call_handler = _chain_model_call_handlers([
    dangling.wrap_model_call,      # 最外层
    llm_error.wrap_model_call,
    todo.wrap_model_call,
    deferred.wrap_model_call,      # 最内层
])
# 调用顺序：dangling → llm_error → todo → deferred → base_handler
# 返回顺序：base_handler → deferred → todo → llm_error → dangling
```

### model → after_model → 条件边（循环体）

```
model
  → TitleMiddleware.after_model             ← 反序链接！先注册的在最后执行
  → TokenUsageMiddleware.after_model
  → TodoMiddleware.after_model
  → SubagentLimitMiddleware.after_model
  → LoopDetectionMiddleware.after_model     ← loop_exit_node
  → (条件边) → tools / after_agent
```

**注意 after_model 的链接顺序**：`create_agent` 中 after_model 是**反序**链接的：

```python
# create_agent 代码
graph.add_edge("model", f"{middleware_w_after_model[-1].name}.after_model")
# 即 model → 最后一个 after_model middleware

for idx in range(len(middleware_w_after_model) - 1, 0, -1):
    m1 = middleware_w_after_model[idx]
    m2 = middleware_w_after_model[idx - 1]
    graph.add_edge(f"{m1.name}.after_model", f"{m2.name}.after_model")
```

所以实际执行顺序是 after_model 列表的**倒序**。`loop_exit_node` 是列表中**第一个** after_model middleware。

### tools 内部（wrap_tool_call 链）

ToolNode 执行每个 tool_call 时经过 `wrap_tool_call` 中间件链：

```
ToolNode.execute(tool_call)
  │
  └→ awrap_tool_call_wrapper(request, base_execute)
       │
       ├→ SandboxAuditMiddleware.awrap_tool_call
       │     审计 bash 命令安全性，然后调用 ↓
       ├→ ToolErrorHandlingMiddleware.awrap_tool_call
       │     捕获工具执行异常转为 ToolMessage，然后调用 ↓
       ├→ ClarificationMiddleware.awrap_tool_call
       │     拦截 clarification 工具调用，然后调用 ↓
       └→ base_execute(request)
              │
              └→ tool.ainvoke(args)          实际执行工具
```

### 条件边：loop_exit_node → tools / after_agent

```python
# loop_exit_node = 第一个 after_model middleware 的节点
# 条件边判断：
def model_to_tools(state):
    if state.get("jump_to"):           # middleware 跳转指令
        return resolve_jump(...)
    if no_tool_calls:                   # LLM 没调工具 → 结束
        return exit_node               # → after_agent 链
    if pending_tool_calls:              # 有工具需要执行
        return [Send("tools", tc)]     # → 并行执行工具
    if structured_response:             # 有结构化输出 → 结束
        return exit_node
    return model_destination            # 其他 → 回到循环
```

### 条件边：tools → loop_entry_node / after_agent

```python
def tools_to_model(state):
    if all_return_direct:               # 工具设了直接返回
        return exit_node                # → after_agent 链
    if structured_output_executed:      # 执行了结构化输出工具
        return exit_node
    return model_destination            # 默认回到循环入口
```

### after_agent 链（出口路径，运行一次）

```
exit_node
  = MemoryMiddleware.after_agent          ← after_agent 也是反序链接
  → SandboxMiddleware.after_agent
  → END
```

同 after_model 一样，after_agent 在 `create_agent` 中也是反序链接的：

```python
exit_node = f"{middleware_w_after_agent[-1].name}.after_agent"
# 即 exit_node = 最后一个 after_agent middleware

for idx in range(len(middleware_w_after_agent) - 1, 0, -1):
    m1 = middleware_w_after_agent[idx]
    m2 = middleware_w_after_agent[idx - 1]
    graph.add_edge(f"{m1.name}.after_agent", f"{m2.name}.after_agent")

graph.add_edge(f"{first_after_agent.name}.after_agent", END)
```

## 完整图的 ASCII 表示

```
                              ┌──────── 一次性入口 ────────┐
                              │                            │
START → ThreadData.ba → Uploads.ba → Sandbox.ba → [循环入口]
                                                      │
                    ┌─────────────────────────────────┘
                    │
                    ↓
        ┌── 每轮循环 ─────────────────────────────────────┐
        │                                                 │
        │  Summarize.bm → Todo.bm → ViewImage.bm → model │
        │                                            │    │
        │                                     (条件边)    │
        │                                    ↙       ↘    │
        │                              有工具     无工具   │
        │                                ↓          ↓     │
        │  LoopDetect.am ← SubLimit.am   │    exit_node   │
        │      ↑                         │         ↓      │
        │  Todo.am ← TokenUsage.am       │   [出口路径]   │
        │      ↑                         │                │
        │  Title.am ← model             tools             │
        │                                │                │
        │                          (条件边)                │
        │                           ↙    ↘                │
        │                      回循环   直接返回            │
        │                        ↓        ↓               │
        └─────── [循环入口] ←──┘    exit_node             │
                                           │               │
                                           └───────────────┘
                              ┌──────── 一次性出口 ────────┐
                              │                            │
                exit_node → Memory.aa → Sandbox.aa → END
```

节点缩写说明：
- `.ba` = `.before_agent`
- `.bm` = `.before_model`
- `.am` = `.after_model`
- `.aa` = `.after_agent`

## 不生成节点的 Middleware（内联模式）

以下 middleware 通过 `wrap_model_call` 或 `wrap_tool_call` 钩子内联在核心节点中，**不在图中生成独立节点**：

| Middleware | 内联位置 | 钩子 | 作用 |
|-----------|---------|------|------|
| DanglingToolCallMiddleware | model_node 内部 | `wrap_model_call` | 调用 LLM 前修补缺失的 ToolMessage |
| LLMErrorHandlingMiddleware | model_node 内部 | `wrap_model_call` | 捕获 LLM 异常并重试/降级 |
| TodoMiddleware | model_node 内部 | `wrap_model_call` | 动态注入 write_todos 工具 |
| DeferredToolFilterMiddleware | model_node 内部 | `wrap_model_call` | 过滤掉延迟加载的工具 |
| SandboxAuditMiddleware | ToolNode 内部 | `wrap_tool_call` | 审计 bash 命令安全性 |
| ToolErrorHandlingMiddleware | ToolNode 内部 | `wrap_tool_call` | 捕获工具执行异常转为 ToolMessage |
| ClarificationMiddleware | ToolNode 内部 | `wrap_tool_call` | 拦截 clarification 工具调用并中断 |

## 配置变化对图结构的影响

图结构不是固定的，会根据请求配置和应用配置动态变化：

| 配置 | 影响 |
|------|------|
| `is_plan_mode=true` | 增加 `TodoMiddleware.before_model` 和 `TodoMiddleware.after_model` 节点 |
| `subagent_enabled=true` | 增加 `SubagentLimitMiddleware.after_model` 节点 |
| `supports_vision=true` | 增加 `ViewImageMiddleware.before_model` 节点 |
| `tool_search.enabled=true` | 增加 `DeferredToolFilterMiddleware` 到 `wrap_model_call` 链 |
| `token_usage.enabled=true` | 增加 `TokenUsageMiddleware.after_model` 节点 |
| `summarization.enabled=true` | 增加 `SummarizationMiddleware.before_model` 节点 |
| 无工具 | 不创建 `tools` 节点，model 直接连到 exit_node |

## 最小图（无任何可选 middleware）

```
START → ThreadData.ba → Uploads.ba → Sandbox.ba
  → model → TitleMiddleware.am → LoopDetectionMiddleware.am
  → (条件边) → tools → (条件边) → [回循环 / exit]
  → MemoryMiddleware.aa → SandboxMiddleware.aa → END
```

## 关键设计洞察

1. **Middleware 的两种图表现形式**：生成节点（有独立执行步骤和 state 更新）vs 内联（在核心节点内部包裹调用链）
2. **before_agent / after_agent 是一次性的**：只在入口/出口执行，不参与循环
3. **before_model / after_model 是循环的**：每轮 ReAct 迭代都会执行
4. **after_model 的反序链接**：最后注册的 middleware 最先执行（栈式），这是 `create_agent` 的设计选择
5. **条件边是 ReAct 的"决策点"**：决定继续循环还是结束，支持 middleware 通过 `jump_to` 强制跳转

## 一句话总结

**DeerFlow 代码只负责"组装 Agent"（make_lead_agent 构建 StateGraph），之后整个 ReAct 循环完全交给 LangGraph 框架运行** — 框架驱动 model → tools → model → ... 的循环，包括工具调用、状态流转、条件判断、流式输出，直到 LLM 不再调用工具为止。这是典型的**工厂模式 + 框架运行时**分离架构。
