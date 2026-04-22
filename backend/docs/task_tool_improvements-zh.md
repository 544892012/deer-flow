# Task 工具改进

## 概述

已对 task 工具进行改进，以消除浪费性的 LLM 轮询。此前在使用后台任务时，LLM 必须反复调用 `task_status` 来轮询完成状态，从而产生不必要的 API 请求。

## 已做变更

### 1. 移除 `run_in_background` 参数

已从 `task` 工具中移除 `run_in_background` 参数。所有子代理（subagent）任务现在默认异步执行，但工具会自动处理完成逻辑。

**之前：**
```python
# LLM 需要自行管理轮询
task_id = task(
    subagent_type="bash",
    prompt="Run tests",
    description="Run tests",
    run_in_background=True
)
# 然后 LLM 需要反复轮询：
while True:
    status = task_status(task_id)
    if completed:
        break
```

**之后：**
```python
# 工具会阻塞直至完成，轮询在后台进行
result = task(
    subagent_type="bash",
    prompt="Run tests",
    description="Run tests"
)
# 调用返回后即可拿到结果
```

### 2. 后端轮询

`task_tool` 现在会：
- 异步启动子代理任务
- 在后端轮询完成状态（每 2 秒一次）
- 在工具调用层面阻塞直至完成
- 直接返回最终结果

这意味着：
- ✅ LLM 只需发起**一次**工具调用
- ✅ 不再有浪费性的 LLM 轮询请求
- ✅ 所有状态检查由后端处理
- ✅ 具备超时保护（最长 5 分钟）

### 3. 从 LLM 工具中移除 `task_status`

`task_status_tool` 不再暴露给 LLM。代码库中仍保留，供可能的内部/调试使用，但 LLM 无法调用它。

### 4. 文档更新

- 更新 `prompt.py` 中的 `SUBAGENT_SECTION`，移除所有后台任务与轮询相关描述
- 简化使用示例
- 明确说明工具会自动等待完成

## 实现细节

### 轮询逻辑

位于 `packages/harness/deerflow/tools/builtins/task_tool.py`：

```python
# Start background execution
task_id = executor.execute_async(prompt)

# Poll for task completion in backend
while True:
    result = get_background_task_result(task_id)

    # Check if task completed or failed
    if result.status == SubagentStatus.COMPLETED:
        return f"[Subagent: {subagent_type}]\n\n{result.result}"
    elif result.status == SubagentStatus.FAILED:
        return f"[Subagent: {subagent_type}] Task failed: {result.error}"

    # Wait before next poll
    time.sleep(2)

    # Timeout protection (5 minutes)
    if poll_count > 150:
        return "Task timed out after 5 minutes"
```

### 执行超时

除轮询超时外，子代理执行现在还内置超时机制：

**配置**（`packages/harness/deerflow/subagents/config.py`）：
```python
@dataclass
class SubagentConfig:
    # ...
    timeout_seconds: int = 300  # 5 minutes default
```

**线程池架构**：

为避免嵌套线程池与资源浪费，使用两个专用线程池：

1. **调度池**（`_scheduler_pool`）：
   - 最大 worker 数：4
   - 用途：编排后台任务执行
   - 运行管理任务生命周期的 `run_task()` 函数

2. **执行池**（`_execution_pool`）：
   - 最大 worker 数：8（更大，以减少阻塞）
   - 用途：实际执行子代理并支持超时
   - 运行调用 agent 的 `execute()` 方法

**工作方式**：
```python
# In execute_async():
_scheduler_pool.submit(run_task)  # Submit orchestration task

# In run_task():
future = _execution_pool.submit(self.execute, task)  # Submit execution
exec_result = future.result(timeout=timeout_seconds)  # Wait with timeout
```

**收益**：
- ✅ 职责清晰分离（调度 vs 执行）
- ✅ 无嵌套线程池
- ✅ 在合适层级强制执行超时
- ✅ 资源利用更好

**两级超时保护**：
1. **执行超时**：子代理执行本身有 5 分钟超时（可在 SubagentConfig 中配置）
2. **轮询超时**：工具轮询有 5 分钟超时（30 次轮询 × 10 秒）

这样即使子代理执行挂起，系统也不会无限期等待。

### 收益

1. **降低 API 成本**：不再为轮询产生重复的 LLM 请求
2. **更简单的使用体验**：LLM 无需管理轮询逻辑
3. **更高可靠性**：后端统一处理状态检查
4. **超时保护**：两级超时避免无限等待（执行 + 轮询）

## 测试

验证变更是否正常工作：

1. 启动一个需要数秒的子代理任务
2. 确认工具调用会阻塞直至完成
3. 确认结果直接返回
4. 确认没有发起 `task_status` 调用

示例测试场景：
```python
# 应阻塞约 10 秒后返回结果
result = task(
    subagent_type="bash",
    prompt="sleep 10 && echo 'Done'",
    description="Test task"
)
# result 中应包含 "Done"
```

## 迁移说明

对于此前使用 `run_in_background=True` 的用户/代码：
- 直接移除该参数
- 移除任何轮询逻辑
- 工具会自动等待完成

无需其他改动——API 向后兼容（仅移除上述参数）。
