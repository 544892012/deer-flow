# Subagent 调用机制：主 Agent 如何委托子代理

---

## 一句话总结

**主 Agent 通过 `task` 工具（一个普通的 LangChain Tool）把任务委托给子代理。子代理在后台线程池中运行独立的 `create_agent` 子图，主 Agent 侧通过轮询获取结果。**

## 完整调用链路

```
用户请求 → 主 Agent ReAct 循环
│
├→ LLM 决定调用 task 工具
│     AIMessage.tool_calls = [{name: "task", args: {
│       description: "探索代码库结构",
│       prompt: "分析 src/ 目录下的文件...",
│       subagent_type: "general-purpose"
│     }}]
│
├→ ToolNode 执行 task_tool (async)
│     │
│     ├→ 1. get_subagent_config("general-purpose")    获取子代理配置
│     ├→ 2. get_available_tools(subagent_enabled=False) 获取工具（排除 task 工具）
│     ├→ 3. SubagentExecutor(config, tools, parent_model, sandbox, thread_data)
│     ├→ 4. executor.execute_async(prompt, task_id=tool_call_id)
│     │       │
│     │       ├→ 创建 SubagentResult(status=PENDING) 写入全局字典
│     │       └→ _scheduler_pool.submit(run_task)    提交到调度线程池
│     │              │
│     │              ├→ status = RUNNING
│     │              ├→ _execution_pool.submit(self.execute, task)  提交到执行线程池
│     │              │       │
│     │              │       ├→ asyncio.run(self._aexecute(task))   在子线程跑异步
│     │              │       │       │
│     │              │       │       ├→ agent = self._create_agent()
│     │              │       │       │     └→ create_agent(model, tools, middleware, ...)
│     │              │       │       │         → 构建子代理的 StateGraph → compile → CompiledStateGraph
│     │              │       │       │
│     │              │       │       ├→ state = {messages: [HumanMessage(task)],
│     │              │       │       │           sandbox: parent_sandbox,
│     │              │       │       │           thread_data: parent_thread_data}
│     │              │       │       │
│     │              │       │       └→ agent.astream(state, config, stream_mode="values")
│     │              │       │           │
│     │              │       │           └→ 子代理 ReAct 循环（独立的 model ↔ tools 循环）
│     │              │       │               每产生一个 AIMessage → 追加到 result.ai_messages
│     │              │       │               → 最终取最后一条 AIMessage.content 作为 result
│     │              │       │
│     │              │       └→ return SubagentResult(status=COMPLETED, result="...")
│     │              │
│     │              └→ execution_future.result(timeout=config.timeout_seconds)
│     │                  如果超时 → status = TIMED_OUT
│     │
│     └→ 5. 轮询循环 (while True + asyncio.sleep(5))
│           │
│           ├→ get_background_task_result(task_id)
│           ├→ 新增 AI 消息时 → writer(task_running event)   → SSE 推送给前端
│           ├→ COMPLETED → writer(task_completed) → return "Task Succeeded. Result: ..."
│           ├→ FAILED → writer(task_failed) → return "Task failed. Error: ..."
│           └→ TIMED_OUT → writer(task_timed_out) → return "Task timed out. Error: ..."
│
├→ ToolMessage(content="Task Succeeded. Result: 分析结果...")
│     追加到主 Agent 的 messages
│
└→ 主 Agent 继续 ReAct 循环（LLM 基于 ToolMessage 继续推理）
```

## 子代理的 Agent 构建

子代理通过 `SubagentExecutor._create_agent()` 构建，同样使用 `create_agent()`，但配置不同：

| 对比项 | 主 Agent (Lead) | 子 Agent (Subagent) |
|--------|----------------|---------------------|
| 工厂函数 | `make_lead_agent(config)` | `SubagentExecutor._create_agent()` |
| Model | 支持 thinking | **固定 `thinking_enabled=False`** |
| Tools | 全量工具 + task | 全量工具 **- task**（禁止嵌套） |
| System Prompt | 主 Agent SOUL.md | 子代理 config 中的 `system_prompt` |
| Middleware | 完整链（14+ 个） | **精简链**（仅运行时基础 middleware） |
| Checkpointer | 有（持久化对话） | **无**（一次性执行） |
| 状态 | 用户对话历史 | **仅一条 HumanMessage(task)** |

## 子代理的精简 Middleware 链

`build_subagent_runtime_middlewares()` 构建的 middleware 列表：

```
1. ThreadDataMiddleware        — before_agent: 创建线程数据目录
2. SandboxMiddleware           — before_agent/after_agent: 初始化/释放沙箱
3. DanglingToolCallMiddleware  — wrap_model_call: 修补缺失 ToolMessage
4. LLMErrorHandlingMiddleware  — wrap_model_call: LLM 异常重试
5. (GuardrailMiddleware)       — (条件) 安全护栏
6. SandboxAuditMiddleware      — wrap_tool_call: bash 命令安全审计
7. ToolErrorHandlingMiddleware — wrap_tool_call: 工具执行异常处理
```

**不包含的 middleware**（与主 Agent 的区别）：
- Summarization — 子代理执行时间短，不需要压缩历史
- Todo — 不需要 TODO 管理
- Title — 不需要生成标题
- Memory — 不需要更新记忆
- ViewImage — 不需要图片注入
- DeferredToolFilter — 不需要延迟工具
- SubagentLimit — 子代理不能再创建子代理
- LoopDetection — 依赖 max_turns 限制
- Clarification — 子代理不能向用户提问

## 后台执行的线程模型

```
主 Agent 的 asyncio 事件循环（LangGraph 协程）
│
├→ task_tool 协程
│     │
│     ├→ execute_async() → 提交任务
│     │
│     └→ while True: asyncio.sleep(5)  ← 非阻塞轮询（让出事件循环）
│
│   ┌────── 后台线程池 ──────┐
│   │                        │
│   │  _scheduler_pool       │  ThreadPoolExecutor(max_workers=3)
│   │  ├→ run_task()         │  调度任务
│   │  │                     │
│   │  │  _execution_pool    │  ThreadPoolExecutor(max_workers=3)
│   │  │  ├→ execute()       │  实际执行
│   │  │  │  └→ asyncio.run( │  在子线程创建新事件循环
│   │  │  │       _aexecute()│
│   │  │  │       agent.astream()  ← 子代理 ReAct 循环
│   │  │  │     )            │
│   │  │  │                  │
│   │  │  └→ timeout 监控    │  Future.result(timeout=...)
│   │  │                     │
│   └──┘─────────────────────┘
│
│  全局共享内存：
│  _background_tasks: dict[task_id → SubagentResult]
│  _background_tasks_lock: threading.Lock
```

## 数据流和状态共享

### 从主 Agent 到子 Agent（传入）
- **sandbox_state** — 从 `runtime.state["sandbox"]` 取出，传给子代理初始状态（共享同一沙箱环境）
- **thread_data** — 从 `runtime.state["thread_data"]` 取出（共享线程数据目录）
- **thread_id** — 从 `runtime.context["thread_id"]` 取出
- **parent_model** — 从 `runtime.config["metadata"]["model_name"]` 取出，子代理默认继承

### 从子 Agent 到主 Agent（返回）
- **结果字符串** — 子代理最后一条 AIMessage 的 content，作为 task_tool 的返回值
- **中间过程** — 通过 `get_stream_writer()` 发送 SSE 事件（`task_started`、`task_running`、`task_completed`），前端可以实时展示

### 子代理看不到的
- 主 Agent 的对话历史（子代理只收到一条 HumanMessage）
- 主 Agent 的 Checkpointer / Store（子代理是一次性执行，无持久化）

## 并行控制：SubagentLimitMiddleware

主 Agent 的 `SubagentLimitMiddleware`（`after_model` 钩子）负责**在 LLM 层面**限制并行 task 调用数：

```python
# SubagentLimitMiddleware.after_model
def _truncate_task_calls(self, state):
    last_msg = state["messages"][-1]  # 最新的 AIMessage
    task_calls = [tc for tc in last_msg.tool_calls if tc["name"] == "task"]

    if len(task_calls) > self.max_concurrent:
        # 只保留前 N 个 task 调用，其余删除
        keep = task_calls[:self.max_concurrent]
        # 从 AIMessage.tool_calls 中移除多余的
        ...
```

并行控制的三层限制：

| 层 | 机制 | 限制值 |
|----|------|--------|
| LLM 层 | SubagentLimitMiddleware 截断 tool_calls | 默认 3，范围 [2, 4] |
| 调度层 | `_scheduler_pool` ThreadPoolExecutor | max_workers=3 |
| 执行层 | `_execution_pool` ThreadPoolExecutor | max_workers=3 |

## 配置驱动

### subagent_enabled 的传播路径

```
用户请求 body.context.subagent_enabled=true
  → services.py: merge 到 config["configurable"]["subagent_enabled"]
  → make_lead_agent: 读取 cfg["subagent_enabled"]
  → get_available_tools(subagent_enabled=True): 注册 task 工具
  → _build_middlewares: 添加 SubagentLimitMiddleware
  → apply_prompt_template: 注入 <subagent_system> 提示词
```

### 内置子代理类型

子代理配置在 `subagents/builtins/` 目录下：

| 类型 | 说明 | 默认 disallowed_tools |
|------|------|---------------------|
| `general-purpose` | 通用多步任务代理 | `["task"]`（禁止嵌套） |
| `bash` | 命令执行专家 | `["task"]` |

## 防止递归嵌套

系统通过两个机制防止子代理无限嵌套：

1. **工具层**：`task_tool` 内部调用 `get_available_tools(subagent_enabled=False)`，子代理的工具列表**不包含 task 工具**
2. **配置层**：SubagentConfig 的 `disallowed_tools` 默认包含 `"task"`，即使用 `_filter_tools` 也会过滤掉

## 关键文件索引

| 环节 | 路径 |
|------|------|
| `task` 工具定义 | `packages/harness/deerflow/tools/builtins/task_tool.py` |
| 工具注册开关 | `packages/harness/deerflow/tools/tools.py` |
| Subagent 执行器 | `packages/harness/deerflow/subagents/executor.py` |
| Subagent 配置模型 | `packages/harness/deerflow/subagents/config.py` |
| Subagent 注册表 | `packages/harness/deerflow/subagents/registry.py` |
| 内置子代理定义 | `packages/harness/deerflow/subagents/builtins/` |
| 子代理 middleware | `agents/middlewares/tool_error_handling_middleware.py` → `build_subagent_runtime_middlewares` |
| 并行限制 middleware | `agents/middlewares/subagent_limit_middleware.py` |
| 主 Agent 提示词注入 | `agents/lead_agent/prompt.py` |
| 网关配置注入 | `app/gateway/services.py` |
