# System Prompt 设计分析

本文分析 DeerFlow Lead Agent 的 system prompt 架构，总结设计思路、优缺点和可借鉴的 prompt 工程技巧。

---

## 1. 整体架构：模块化条件拼装

`apply_prompt_template()` 根据运行时配置动态拼装 system prompt：

```
SYSTEM_PROMPT_TEMPLATE
├── <role>                 角色定义（固定）
├── {soul}                 个性设定（从 SOUL.md 加载，可选）
├── {memory_context}       用户记忆注入（跨会话个性化，可选）
├── <thinking_style>       思维方式指导 + {subagent_thinking}（条件注入）
├── <clarification_system> 澄清机制（固定，~70 行）
├── {skills_section}       技能列表（有可用 skills 时注入）
├── {deferred_tools_section} deferred 工具名列表（tool_search 启用时注入）
├── {subagent_section}     subagent 完整指南（subagent 启用时注入，~160 行）
├── <working_directory>    文件系统约定（固定）+ {acp_section}（条件注入）
├── <response_style>       回复风格（固定）
├── <citations>            引用规范（固定，~60 行）
└── <critical_reminders>   关键提醒 + {subagent_reminder}（条件注入）
```

### 条件注入的变量

| 变量 | 条件 | 注入内容 |
|------|------|---------|
| `{soul}` | `SOUL.md` 存在 | agent 个性设定 |
| `{memory_context}` | `memory.enabled=true` | 用户历史记忆 facts |
| `{subagent_thinking}` | `subagent_enabled=true` | 1 行思维引导 |
| `{subagent_section}` | `subagent_enabled=true` | ~160 行完整 subagent 指南 |
| `{subagent_reminder}` | `subagent_enabled=true` | 1 行关键提醒 |
| `{skills_section}` | 有可用 skills | skill 列表和加载方式 |
| `{deferred_tools_section}` | `tool_search.enabled=true` + 有 MCP 工具 | 工具名列表 |
| `{acp_section}` | 有配置 ACP agents | ACP 工作区说明 |

不启用的功能对应的变量为空字符串，不占 token。

---

## 2. 设计优点（值得借鉴）

### 2.1 条件组装，避免 token 浪费

```python
subagent_section = _build_subagent_section(n) if subagent_enabled else ""
```

只注入启用功能的指令，不给 LLM 看不相关的规则。对比：很多项目用一个巨大的固定 prompt，不管什么配置都全量发送。

**收益**：关闭 subagent 时省 ~160 行 / ~2000 token；关闭 skills 时省 ~500 token。

### 2.2 XML 标签结构化

```xml
<thinking_style>
  ...rules...
</thinking_style>

<clarification_system>
  ...rules...
</clarification_system>
```

LLM（尤其 Claude）对 XML 标签的遵循度很高。每个标签明确标识一个独立的指令块，避免指令间互相干扰。

### 2.3 关键规则多点强化

subagent 并发限制在三处重复强调：

| 位置 | 内容 | 作用 |
|------|------|------|
| `<thinking_style>` | "DECOMPOSITION CHECK: ... NEVER launch more than N" | 让 LLM 在思考阶段就意识到 |
| `<subagent_system>` | 完整示例 + 计数逻辑 | 提供具体操作指南 |
| `<critical_reminders>` | "HARD LIMIT: max N task calls" | 最后再次强化 |

这种"重要规则多点重复"策略对 LLM 遵循度提升明显，尤其对于容易被忽略的约束。

### 2.4 正反例对比

citations 部分用 ❌/✅ 明确标注错误和正确的格式：

```
❌ WRONG: `GitHub 仓库 - 官方源代码和文档` (no URL!)
❌ WRONG in Sources: citation prefix is for inline only, for example `[citation:GitHub Repository](...)`
✅ RIGHT in Sources: `[GitHub Repository](https://...) - 官方源代码和文档`
```

LLM 只看正面示例时容易模糊边界，反面示例能精确界定"什么不能做"。

### 2.5 专用工具约束行为

用 `ask_clarification` 工具替代自然语言提问：

```python
ask_clarification(
    question="Which environment should I deploy to?",
    clarification_type="approach_choice",
    options=["development", "staging", "production"]
)
```

工具调用比自然语言更可控：有固定的参数结构，后端可以拦截处理（`ClarificationMiddleware`），确保工作流中断等待用户回复。

### 2.6 动态 token 优化（tool_search）

```xml
<available-deferred-tools>
yfinance_get_stock_info
yfinance_get_fast_info
</available-deferred-tools>
```

只给 LLM 看工具名（~50 token），而非完整 schema（~1000 token）。配合 `DeferredToolFilterMiddleware` 在运行时过滤，按需加载。

### 2.7 Memory 实现跨会话个性化

```xml
<memory>
- User prefers Chinese responses
- User works on DeerFlow backend project
- User's name is Wenchao
</memory>
```

将用户历史事实注入 system prompt，实现"记住用户"的效果，无需每次手动提供上下文。

---

## 3. 设计缺点与改进建议

### 3.1 Prompt 过长

| 部分 | 估算 token |
|------|-----------|
| 固定部分（thinking + clarification + citations + reminders + working_dir） | ~4000 |
| subagent_section（启用时） | ~2000 |
| skills_section（有 skills 时） | ~500 |
| 总计（全功能） | ~6500-8000 |

每轮对话都发送，20 轮对话仅 system prompt 就消耗 ~160K token。

**改进方向**：
- 将 citations、clarification 等较长的固定规则移到工具描述中（参考 Cursor 的做法）
- 或使用 SummarizationMiddleware 在多轮对话时压缩

### 3.2 重复强调导致冗余

subagent 规则在 3 处重复，clarification 在 2 处重复。虽然提高遵循度，但增加了 ~500 额外 token。

**改进方向**：主规则放在一处，其他位置用简短引用（"遵守上述 subagent 规则"），在遵循度和 token 消耗间找平衡。

### 3.3 硬编码在 Python 代码中

```python
SYSTEM_PROMPT_TEMPLATE = """
<role>
You are {agent_name}, ...
...
"""
```

修改 prompt 需要改代码、重启服务。无法做 A/B 测试或热更新。

**改进方向**：
- 抽取为独立的模板文件（YAML/Jinja2）
- 通过配置文件选择不同版本的 prompt
- 支持热加载（类似 MCP config 的 mtime 检测）

### 3.4 固定路径耦合

```
/mnt/user-data/uploads
/mnt/user-data/workspace
/mnt/user-data/outputs
```

这些路径硬编码在 prompt 中。虽然 sandbox 配置可以自定义 mount，但 prompt 中的路径是固定的。

**改进方向**：路径也作为模板变量从配置中注入。

### 3.5 缺少 prompt 版本管理

无法追踪 prompt 变更对效果的影响。难以回滚到之前的版本。

**改进方向**：
- prompt 内容存入版本化的模板文件
- 配合 LangSmith 等工具做 prompt 实验和对比

---

## 4. 调用顺序注意事项

### Bug 修复记录

`apply_prompt_template()` 中的 `get_deferred_tools_prompt_section()` 依赖 `DeferredToolRegistry`，后者由 `get_available_tools()` 中的 `set_deferred_registry()` 设置。

**原始代码**（有 bug）：

```python
# agent.py — apply_prompt_template 在 get_available_tools 之前调用
return create_agent(
    model=create_chat_model(...),
    tools=get_available_tools(...),           # ← 这里才设置 registry
    system_prompt=apply_prompt_template(...), # ← 但这里已经读取了 registry（为 None）
)
```

Python 函数参数按关键字参数声明顺序（或 dict literal 键值对顺序）求值，但 `create_agent()` 的参数定义顺序可能不是 `tools` 在 `system_prompt` 之前。

**修复后**（显式保证顺序）：

```python
model = create_chat_model(...)              # 1. 创建 model
tools = get_available_tools(...)            # 2. 加载工具（设置 registry）
system_prompt = apply_prompt_template(...)  # 3. 生成 prompt（读取 registry）
middlewares = _build_middlewares(...)        # 4. 构建中间件
create_agent(model, tools, middleware, prompt)  # 5. 组装
```

**教训**：当多个组件之间存在隐式依赖（如 ContextVar），必须显式控制调用顺序，而非依赖语言的求值顺序。

---

## 5. 核心技巧总结

| 技巧 | 描述 | 适用场景 |
|------|------|---------|
| **条件组装** | 只注入启用功能的指令 | 多功能/多配置的 agent |
| **XML 标签** | 结构化分隔不同指令块 | Claude 系列模型 |
| **多点强化** | 关键规则在多处重复 | 容易被忽略的约束 |
| **正反例** | ❌/✅ 对比明确边界 | 格式规范、行为约束 |
| **专用工具** | 用工具调用替代自然语言 | 需要可控流程的场景 |
| **延迟加载** | 只展示工具名，按需获取 schema | 工具数量多（>20）|
| **Memory 注入** | 将历史事实注入 prompt | 跨会话个性化 |
| **显式排序** | 有依赖关系的组件显式控制调用顺序 | 存在隐式依赖（ContextVar 等）|

---

## 关键文件索引

| 文件 | 内容 |
|------|------|
| `agents/lead_agent/prompt.py` | System prompt 模板和拼装逻辑 |
| `agents/lead_agent/agent.py` | Agent 构建，调用 prompt 模板 |
| `config/tool_search_config.py` | tool_search 配置 |
| `tools/builtins/tool_search.py` | DeferredToolRegistry + tool_search 工具 |
| `agents/middlewares/deferred_tool_filter_middleware.py` | 运行时过滤 deferred 工具 schema |
| `agents/middlewares/clarification_middleware.py` | 拦截 ask_clarification 工具调用 |
| `agents/memory/` | Memory 加载和注入 |
| `skills/` | Skills 扫描和加载 |
