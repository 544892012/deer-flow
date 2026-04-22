# 03 - Sub-Agents 多代理协作

## 整体架构

```
用户消息
  ↓
Lead Agent（主 Agent）
  │
  ├── 简单问题 → 直接回答
  │
  └── 复杂任务 → LLM 决定调用 task() 工具
       ↓
  ┌─────────────────────────────────────────────────────────┐
  │                    task_tool.py                          │
  │  1. 查找 SubagentConfig（general-purpose / bash）       │
  │  2. 从 runtime 提取父级上下文（sandbox, thread_data）   │
  │  3. 加载工具集（排除 task 防止嵌套）                    │
  │  4. 创建 SubagentExecutor                               │
  │  5. 调用 execute_async() 启动后台执行                   │
  │  6. 进入轮询循环                                        │
  └─────────────────────────────────────────────────────────┘
       ↓
  ┌─────────────────────────────────────────────────────────┐
  │                  SubagentExecutor                        │
  │  双线程池：                                              │
  │  • _scheduler_pool (3 workers) → 调度任务               │
  │  • _execution_pool (3 workers) → 执行任务               │
  │                                                         │
  │  execute_async():                                       │
  │    1. 创建 SubagentResult（状态 PENDING）                │
  │    2. 提交到 scheduler_pool                             │
  │    3. scheduler 内提交到 execution_pool                 │
  │    4. execution_pool 内运行 execute() → asyncio.run()   │
  │    5. _aexecute(): create_agent → astream → 收集结果    │
  └─────────────────────────────────────────────────────────┘
       ↓
  ┌─────────────────────────────────────────────────────────┐
  │              轮询 + SSE 事件推送                         │
  │  task_tool 主协程每 5 秒轮询一次:                       │
  │                                                         │
  │  while True:                                            │
  │    result = get_background_task_result(task_id)          │
  │    if 有新 AI 消息 → writer(task_running 事件)          │
  │    if COMPLETED → writer(task_completed) → return       │
  │    if FAILED → writer(task_failed) → return             │
  │    if TIMED_OUT → writer(task_timed_out) → return       │
  │    await asyncio.sleep(5)                               │
  └─────────────────────────────────────────────────────────┘
```

## 完整调用时序图

```
Lead Agent                task_tool              SubagentExecutor        子 Agent
    │                         │                        │                    │
    │ ── tool_call: task ──→  │                        │                    │
    │                         │ ── get_subagent_config  │                    │
    │                         │ ── get_available_tools   │                    │
    │                         │    (subagent_enabled=    │                    │
    │                         │     False, 排除 task)    │                    │
    │                         │                        │                    │
    │                         │ ── new SubagentExecutor │                    │
    │                         │ ── execute_async() ──→  │                    │
    │                         │                        │ ── scheduler_pool  │
    │                         │                        │    submit(run_task) │
    │                         │                        │                    │
    │                         │ ← task_id ──────────── │                    │
    │                         │                        │                    │
    │                         │ ── writer(task_started) │                    │
    │                         │                        │ ── execution_pool  │
    │                         │                        │    submit(execute)  │
    │                         │                        │                    │
    │                         │                        │ ── _aexecute() ──→ │
    │                         │                        │    create_agent()   │
    │                         │                        │    astream()        │
    │                         │                        │                    │── LLM 推理
    │                         │                        │                    │── 工具调用
    │                         │                        │                    │── 收集 AI 消息
    │                         │                        │                    │
    │                         │ ── poll (5s) ────────→ │                    │
    │                         │ ← 新 AI 消息 ──────── │                    │
    │                         │ ── writer(task_running) │                    │
    │                         │                        │                    │
    │                         │ ── poll (5s) ────────→ │                    │
    │                         │ ← COMPLETED ────────── │ ← 最终结果 ─────── │
    │                         │ ── writer(task_completed)                    │
    │                         │ ── cleanup_background_task                   │
    │ ← "Task Succeeded..." ─ │                                             │
    │                         │                                             │
```

## 子 Agent 构建细节

### SubagentExecutor._create_agent()

```python
def _create_agent(self):
    model = create_chat_model(name=model_name, thinking_enabled=False)
    middlewares = build_subagent_runtime_middlewares(lazy_init=True)
    return create_agent(
        model=model,
        tools=self.tools,           # 已过滤，排除 task
        middleware=middlewares,      # 精简版中间件链
        system_prompt=self.config.system_prompt,
        state_schema=ThreadState,
    )
```

**关键差异**：
- 子 Agent 使用 `build_subagent_runtime_middlewares`（精简版），没有 Uploads、DanglingToolCall
- 子 Agent 的 `thinking_enabled=False`，不用推理模式
- 子 Agent 禁止调用 `task` 工具（`disallowed_tools=["task"]`），防止递归嵌套

### 初始状态构建

```python
def _build_initial_state(self, task: str) -> dict:
    state = {"messages": [HumanMessage(content=task)]}
    if self.sandbox_state is not None:
        state["sandbox"] = self.sandbox_state       # 共享父级沙箱
    if self.thread_data is not None:
        state["thread_data"] = self.thread_data     # 共享父级线程目录
    return state
```

子 Agent **共享父级的沙箱和线程目录**，可以访问相同的文件系统。

## 内置子代理类型

| 名称 | 工具 | 系统提示 | 用途 |
|------|------|----------|------|
| `general-purpose` | 除 task/ask_clarification/present_files 外的所有工具 | 通用完成任务 | 复杂多步任务 |
| `bash` | 仅 bash 相关 | 命令执行专家 | Git/构建/部署 |

### SubagentConfig 数据结构

```python
@dataclass
class SubagentConfig:
    name: str                              # 唯一标识
    description: str                       # 使用场景描述
    system_prompt: str                     # 系统提示词
    tools: list[str] | None = None         # 工具白名单（None=继承全部）
    disallowed_tools: list[str] = ["task"] # 工具黑名单
    model: str = "inherit"                 # "inherit"=使用父级模型
    max_turns: int = 50                    # 最大执行轮次
    timeout_seconds: int = 900             # 15 分钟超时
```

## 并发控制机制

### SubagentLimitMiddleware

在 `after_model` 中检查模型单次产出的 `task` 调用数量：

```python
class SubagentLimitMiddleware(AgentMiddleware):
    def __init__(self, max_concurrent=3):
        self.max_concurrent = clamp(max_concurrent, 2, 4)

    def after_model(self, state, runtime):
        # 找出所有 task 工具调用
        task_indices = [i for i, tc in enumerate(tool_calls) if tc["name"] == "task"]
        # 超过限制则截断
        if len(task_indices) > self.max_concurrent:
            indices_to_drop = set(task_indices[self.max_concurrent:])
            truncated = [tc for i, tc in enumerate(tool_calls) if i not in indices_to_drop]
            return {"messages": [updated_msg_with_truncated_calls]}
```

### 双线程池模型

```
_scheduler_pool (3 workers)     _execution_pool (3 workers)
         │                              │
         │── run_task() ──────────────→ │── execute() ──→ asyncio.run(_aexecute())
         │                              │                      │
         │                              │                      ├── create_agent()
         │                              │                      ├── astream()
         │                              │                      └── 收集结果
         │                              │
         │── 超时检测 (timeout_seconds)  │
         │── 状态更新                    │
```

为什么要双线程池？
- **scheduler_pool**：负责调度和超时管理，不被执行任务阻塞
- **execution_pool**：实际运行子 Agent，支持 `Future.result(timeout=)` 超时控制

## SSE 事件类型

| 事件 | 时机 | 数据 |
|------|------|------|
| `task_started` | 任务提交成功 | `{task_id, description}` |
| `task_running` | 子 Agent 产生新 AI 消息 | `{task_id, message, message_index}` |
| `task_completed` | 任务成功完成 | `{task_id, result}` |
| `task_failed` | 任务执行失败 | `{task_id, error}` |
| `task_timed_out` | 超过 15 分钟超时 | `{task_id, error}` |

通过 `get_stream_writer()` 发送，前端可以实时展示子任务进度。

## 后台任务生命周期管理

```python
_background_tasks: dict[str, SubagentResult] = {}  # 全局字典

# 清理规则：
# 1. 只在终态（COMPLETED/FAILED/TIMED_OUT）时清理
# 2. task_tool 轮询完成后调用 cleanup_background_task()
# 3. 如果 task_tool 被取消（CancelledError），启动异步清理协程
```

## 关键源码文件

| 文件 | 核心内容 |
|------|---------|
| `tools/builtins/task_tool.py` | `task_tool` — 子代理委托入口 |
| `subagents/executor.py` | `SubagentExecutor` — 执行引擎 |
| `subagents/config.py` | `SubagentConfig` — 配置数据类 |
| `subagents/registry.py` | 子代理注册表与发现 |
| `subagents/builtins/` | 内置子代理配置 |
| `agents/middlewares/subagent_limit_middleware.py` | 并发限制中间件 |
| `agents/lead_agent/prompt.py` | 子代理相关提示词 |
