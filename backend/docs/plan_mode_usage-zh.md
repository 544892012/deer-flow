# 计划模式与 TodoList 中间件

本文说明如何在 DeerFlow 2.0 中启用并使用带 TodoList 中间件的计划模式（Plan Mode）。

## 概述

计划模式会为 agent 增加 TodoList 中间件，提供 `write_todos` 工具，帮助 agent：
- 将复杂任务拆成更小、可执行的步骤
- 在工作推进过程中跟踪进度
- 让用户清楚当前在做什么

TodoList 中间件基于 LangChain 的 `TodoListMiddleware` 构建。

## 配置

### 启用计划模式

计划模式通过 **`RunnableConfig` 的 `configurable` 段**中的运行时参数 `is_plan_mode` 控制，可按请求动态开启或关闭。

```python
from langchain_core.runnables import RunnableConfig
from deerflow.agents.lead_agent.agent import make_lead_agent

# Enable plan mode via runtime configuration
config = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # Enable plan mode
    }
)

# Create agent with plan mode enabled
agent = make_lead_agent(config)
```

### 配置项说明

- **is_plan_mode**（bool）：是否启用带 TodoList 中间件的计划模式。默认：`False`
  - 通过 `config.get("configurable", {}).get("is_plan_mode", False)` 读取
  - 可在每次调用 agent 时动态设置
  - 不需要全局配置

## 默认行为

在默认设置下启用计划模式后，agent 可使用 `write_todos` 工具，行为如下：

### 何时使用 TodoList

agent 会在以下情况使用待办列表：
1. 复杂多步任务（3 个及以上明确步骤）
2. 需要仔细规划的非平凡任务
3. 用户明确要求待办列表
4. 用户一次提出多个任务

### 何时不使用 TodoList

agent 会跳过待办列表的情况：
1. 单一、直接的任务
2. 简单任务（少于 3 步）
3. 纯对话或信息类请求

### 任务状态

- **pending**：尚未开始
- **in_progress**：正在进行（可并行多个任务）
- **completed**：已成功完成

## 使用示例

### 基本用法

```python
from langchain_core.runnables import RunnableConfig
from deerflow.agents.lead_agent.agent import make_lead_agent

# Create agent with plan mode ENABLED
config_with_plan_mode = RunnableConfig(
    configurable={
        "thread_id": "example-thread",
        "thinking_enabled": True,
        "is_plan_mode": True,  # TodoList middleware will be added
    }
)
agent_with_todos = make_lead_agent(config_with_plan_mode)

# Create agent with plan mode DISABLED (default)
config_without_plan_mode = RunnableConfig(
    configurable={
        "thread_id": "another-thread",
        "thinking_enabled": True,
        "is_plan_mode": False,  # No TodoList middleware
    }
)
agent_without_todos = make_lead_agent(config_without_plan_mode)
```

### 按请求动态开关计划模式

可根据不同会话或任务动态启用/禁用计划模式：

```python
from langchain_core.runnables import RunnableConfig
from deerflow.agents.lead_agent.agent import make_lead_agent

def create_agent_for_task(task_complexity: str):
    """Create agent with plan mode based on task complexity."""
    is_complex = task_complexity in ["high", "very_high"]

    config = RunnableConfig(
        configurable={
            "thread_id": f"task-{task_complexity}",
            "thinking_enabled": True,
            "is_plan_mode": is_complex,  # Enable only for complex tasks
        }
    )

    return make_lead_agent(config)

# Simple task - no TodoList needed
simple_agent = create_agent_for_task("low")

# Complex task - TodoList enabled for better tracking
complex_agent = create_agent_for_task("high")
```

## 工作原理

1. 调用 `make_lead_agent(config)` 时，从 `config.configurable` 读取 `is_plan_mode`
2. 该 config 传入 `_build_middlewares(config)`
3. `_build_middlewares()` 读取 `is_plan_mode` 并调用 `_create_todo_list_middleware(is_plan_mode)`
4. 若 `is_plan_mode=True`，则创建 `TodoListMiddleware` 实例并加入中间件链
5. 中间件自动将 `write_todos` 工具加入 agent 的工具集
6. agent 可在执行过程中用该工具管理任务
7. 中间件维护待办状态并提供给 agent

## 架构

```
make_lead_agent(config)
  │
  ├─> Extracts: is_plan_mode = config.configurable.get("is_plan_mode", False)
  │
  └─> _build_middlewares(config)
        │
        ├─> ThreadDataMiddleware
        ├─> SandboxMiddleware
        ├─> SummarizationMiddleware (if enabled via global config)
        ├─> TodoListMiddleware (if is_plan_mode=True) ← NEW
        ├─> TitleMiddleware
        └─> ClarificationMiddleware
```

## 实现细节

### Agent 模块
- **位置**：`packages/harness/deerflow/agents/lead_agent/agent.py`
- **函数**：`_create_todo_list_middleware(is_plan_mode: bool)` — 在启用计划模式时创建 TodoListMiddleware
- **函数**：`_build_middlewares(config: RunnableConfig)` — 根据运行时配置构建中间件链
- **函数**：`make_lead_agent(config: RunnableConfig)` — 创建带相应中间件的 agent

### 运行时配置
计划模式由 `RunnableConfig.configurable` 中的 `is_plan_mode` 控制：
```python
config = RunnableConfig(
    configurable={
        "is_plan_mode": True,  # Enable plan mode
        # ... other configurable options
    }
)
```

## 主要收益

1. **动态控制**：按请求开关计划模式，无需全局状态
2. **灵活**：不同会话可使用不同计划模式设置
3. **简单**：无需单独的全局配置管理
4. **贴合场景**：可根据任务复杂度、用户偏好等决定是否启用计划模式

## 自定义提示词

DeerFlow 为 TodoListMiddleware 使用与整体 DeerFlow 提示风格一致的自定义 `system_prompt` 和 `tool_description`：

### 系统提示特点
- 使用 XML 标签（`<todo_list_system>`）与 DeerFlow 主提示结构保持一致
- 强调关键规则与最佳实践
- 明确「何时使用」与「何时不使用」的指引
- 侧重实时更新与及时完成任务

### 工具描述特点
- 带示例的详细使用场景
- 强调不要用于简单任务
- 清晰的任务状态定义（pending、in_progress、completed）
- 完整的最佳实践说明
- 任务完成要求，避免过早标记完成

自定义提示词定义在 `packages/harness/deerflow/agents/lead_agent/agent.py` 的 `_create_todo_list_middleware()` 中（约第 57 行起）。

## 说明

- TodoList 中间件使用 LangChain 内置的 `TodoListMiddleware`，并配有 **DeerFlow 风格自定义提示词**
- 计划模式 **默认关闭**（`is_plan_mode=False`），以保持向后兼容
- 中间件位于 `ClarificationMiddleware` 之前，以便在澄清流程中仍可管理待办
- 自定义提示与 DeerFlow 主系统提示的原则一致（清晰、可执行、关键规则明确）
