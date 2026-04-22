# LLM 返回后如何决定调用 Tool/Subagent

---

## 核心结论

**"要不要调用工具"这个决策完全由 LLM 自己做出，框架代码不参与决策。** 框架只负责两件事：

1. **调用前**：通过 `model.bind_tools(tools)` 把所有可用工具的 schema 告诉 LLM
2. **调用后**：检查 LLM 返回的 `AIMessage.tool_calls` 字段，决定图的跳转方向

## 决策链路全景

```
                            ┌─────────────────────────────────┐
                            │     调用前：告诉 LLM 有什么工具    │
                            └─────────────────────────────────┘
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  _get_bound_model(request)                                       │
│                                                                  │
│  1. final_tools = request.tools   ← 所有可用工具列表              │
│     （包括 web_search, bash, read_file, task 等）                │
│                                                                  │
│  2. model.bind_tools(final_tools)                                │
│     → 将工具 schema 序列化为 JSON，附加到 LLM API 请求中         │
│     → 例如 OpenAI 的 tools 参数 / Anthropic 的 tools 参数       │
│                                                                  │
│  返回：绑定了工具 schema 的 model（Runnable）                    │
└──────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  _execute_model_async(request)                                    │
│                                                                  │
│  messages = [system_message] + state["messages"]                 │
│  output = await model.ainvoke(messages)                          │
│                                                                  │
│  → LLM 根据对话历史 + 系统提示 + 工具 schema，自主决定：         │
│    a) 直接给出文本回复（不调用工具）                              │
│    b) 返回 tool_calls（调用一个或多个工具）                       │
│                                                                  │
│  返回：AIMessage                                                 │
│    - content: str（文本回复）                                     │
│    - tool_calls: list[dict]（可能为空）                           │
│      例如: [{"name": "task", "id": "call_xxx",                   │
│              "args": {"prompt": "...", "subagent_type": "..."}}] │
└──────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  条件边：model_to_tools(state)    ← 框架决定图的跳转方向          │
│  文件：langchain/agents/factory.py → _make_model_to_tools_edge   │
│                                                                  │
│  last_ai_message = state["messages"][-1]  ← model_node 刚写入的  │
│                                                                  │
│  if len(last_ai_message.tool_calls) == 0:                        │
│      return end_destination          ← 无 tool_calls → 结束循环  │
│      # LLM 选择了直接回复，不调用任何工具                         │
│                                                                  │
│  pending_tool_calls = [                                          │
│      tc for tc in last_ai_message.tool_calls                     │
│      if tc["id"] not in already_executed                         │
│  ]                                                               │
│                                                                  │
│  if pending_tool_calls:                                          │
│      return [Send("tools", tc) for tc in pending_tool_calls]     │
│      # LLM 选择了调用工具 → 并行分发到 ToolNode                  │
│      # ToolNode 根据 tc["name"] 查找对应工具并执行                │
│                                                                  │
│  return end_destination                                          │
└──────────────────────────────────────────────────────────────────┘
```

## 代码位置索引

| 环节 | 文件 | 函数/位置 |
|------|------|----------|
| 工具列表构建 | `deerflow/tools/tools.py` | `get_available_tools()` |
| task 工具是否注册 | `deerflow/tools/tools.py` | `if subagent_enabled: builtin_tools.extend(SUBAGENT_TOOLS)` |
| 工具绑定到 LLM | `langchain/agents/factory.py` | `_get_bound_model()` → `model.bind_tools(final_tools)` |
| LLM 调用 | `langchain/agents/factory.py` | `_execute_model_async()` → `model.ainvoke(messages)` |
| 检查 tool_calls | `langchain/agents/factory.py` | `_make_model_to_tools_edge()` → `model_to_tools()` |
| 工具执行 | `langchain/agents/factory.py` | `ToolNode` → `tool.ainvoke(args)` |
| task 工具实现 | `deerflow/tools/builtins/task_tool.py` | `task_tool()` |

## LLM 如何知道可以调用 task (subagent)

task 只是一个普通的 LangChain Tool，和 `web_search`、`bash` 没有本质区别。LLM 通过以下信息决定是否调用它：

**1. 工具 schema（自动传递）**

`model.bind_tools([..., task_tool, ...])` 会把 task 工具的 schema 序列化后附加到 API 请求中：

```json
{
  "name": "task",
  "description": "Delegate a task to a specialized subagent that runs in its own context...",
  "parameters": {
    "type": "object",
    "properties": {
      "description": {"type": "string", "description": "A short (3-5 word) description..."},
      "prompt": {"type": "string", "description": "The task description for the subagent..."},
      "subagent_type": {"type": "string", "description": "The type of subagent to use..."}
    },
    "required": ["description", "prompt", "subagent_type"]
  }
}
```

**2. 系统提示词（显式引导）**

`apply_prompt_template(subagent_enabled=True)` 在系统提示词中注入 `<subagent_system>` 段落，告诉 LLM 什么时候应该使用 task 工具：

```
<subagent_system>
You can delegate complex tasks to specialized subagents using the `task` tool...
Available subagent types: general-purpose, bash
When to use: complex multi-step tasks, parallel research...
When NOT to use: simple operations, tasks requiring user interaction...
</subagent_system>
```

**3. LLM 自主决策**

LLM 综合以下信息做出决策：
- 用户的请求内容
- 对话历史
- 系统提示词中的引导
- 可用工具列表和描述

如果 LLM 决定调用 task 工具，它会在 AIMessage 中返回：

```python
AIMessage(
    content="",
    tool_calls=[{
        "name": "task",
        "id": "call_abc123",
        "args": {
            "description": "探索项目结构",
            "prompt": "分析 src/ 目录下的文件结构...",
            "subagent_type": "general-purpose"
        }
    }]
)
```

## 关键认知

1. **DeerFlow 代码不包含 `if should_call_tool` 这样的判断** — 是否调用工具完全是 LLM 的推理结果
2. **`tool_calls` 字段是 LLM API 的标准协议** — OpenAI、Anthropic、Google 等 LLM 提供商都支持 function calling / tool use
3. **`model.bind_tools()` 只是把工具 schema 附加到 API 请求** — 不改变 LLM 的行为，只是告诉 LLM 有哪些工具可选
4. **task 工具 = subagent 的触发器** — 从 LLM 角度看，调用 `task` 和调用 `web_search` 没有区别；subagent 的复杂性（后台线程池、独立 Agent 图等）完全隐藏在 `task_tool` 的实现内部
5. **框架只做路由** — 条件边 `model_to_tools()` 只检查 `tool_calls` 是否为空，不判断调用是否合理
