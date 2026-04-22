# Guardrails：工具调用前授权

> **背景：** [Issue #1213](https://github.com/bytedance/deer-flow/issues/1213) — DeerFlow 具备 Docker 沙箱隔离与通过 `ask_clarification` 的人工审批，但缺少面向工具调用的、确定性的、策略驱动的授权层。运行自主多步任务的智能体可以调用任意已加载工具并传入任意参数。Guardrails 增加一层中间件，在**执行前**根据策略评估每一次工具调用。

## 为何需要 Guardrails

```
无 guardrails:                      有 guardrails:

  Agent                                    Agent
    │                                        │
    ▼                                        ▼
  ┌──────────┐                             ┌──────────┐
  │ bash     │──▶ 立即执行                  │ bash     │──▶ GuardrailMiddleware
  │ rm -rf / │                             │ rm -rf / │        │
  └──────────┘                             └──────────┘        ▼
                                                         ┌──────────────┐
                                                         │  Provider    │
                                                         │  按策略      │
                                                         │  评估        │
                                                         └──────┬───────┘
                                                                │
                                                          ┌─────┴─────┐
                                                          │           │
                                                        允许        拒绝
                                                          │           │
                                                          ▼           ▼
                                                      工具照常执行   Agent 看到:
                                                                   "Guardrail denied:
                                                                   rm -rf blocked"
```

- **沙箱**提供进程隔离，但不提供语义层面的授权。沙箱内的 `bash` 仍可能 `curl` 把数据外传。
- **人工审批**（`ask_clarification`）要求每一步都有人参与，不适合自主工作流。
- **Guardrails**提供无需人工介入的、确定性的、策略驱动的授权。

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Middleware 链                                │
│                                                                      │
│  1. ThreadDataMiddleware     ─── 每线程目录                          │
│  2. UploadsMiddleware        ─── 上传文件跟踪                       │
│  3. SandboxMiddleware        ─── 获取沙箱                            │
│  4. DanglingToolCallMiddleware ── 修复未完成的 tool 调用           │
│  5. GuardrailMiddleware ◄──── 评估每一次工具调用                    │
│  6. ToolErrorHandlingMiddleware ── 将异常转为消息                   │
│  7-12.（Summarization、Title、Memory、Vision、Subagent、Clarify）   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
           ┌──────────────────────────┐
           │    GuardrailProvider     │  ◄── 可插拔：任意带 evaluate/aevaluate 的类
           │   （在 YAML 中配置）      │
           └────────────┬─────────────┘
                        │
              ┌─────────┼──────────────┐
              │         │              │
              ▼         ▼              ▼
         内置        OAP Passport    自定义
         允许列表    Provider        Provider
         （零依赖） （开放标准）     （你的代码）
                        │
                  任意实现
                  （例如 APort，或
                   你自己的评估器）
```

`GuardrailMiddleware` 实现 `wrap_tool_call` / `awrap_tool_call`（与 `ToolErrorHandlingMiddleware` 相同的 `AgentMiddleware` 模式）。它会：

1. 构建包含工具名、参数与 passport 引用的 `GuardrailRequest`
2. 调用已配置 provider 的 `provider.evaluate(request)`
3. 若**拒绝**：返回带原因的 `ToolMessage(status="error")` —— Agent 看到拒绝并自行调整
4. 若**允许**：透传到真实工具处理函数
5. 若 **provider 出错** 且 `fail_closed=true`（默认）：拦截该次调用
6. `GraphBubbleUp` 异常（LangGraph 控制流信号）始终向上传播，不会被捕获

## 三种 Provider 选项

### 选项 1：内置 AllowlistProvider（零依赖）

最简单。随 DeerFlow 提供。按工具名拦截或放行。无外部包、无 passport、无网络。

**config.yaml：**
```yaml
guardrails:
  enabled: true
  provider:
    use: deerflow.guardrails.builtin:AllowlistProvider
    config:
      denied_tools: ["bash", "write_file"]
```

对所有请求拦截 `bash` 与 `write_file`，其余工具放行。

也可使用允许列表（仅允许下列工具）：
```yaml
guardrails:
  enabled: true
  provider:
    use: deerflow.guardrails.builtin:AllowlistProvider
    config:
      allowed_tools: ["web_search", "read_file", "ls"]
```

**试用：**
1. 将上述配置加入 `config.yaml`
2. 启动 DeerFlow：`make dev`
3. 让 Agent 执行：「Use bash to run echo hello」
4. Agent 会看到：`Guardrail denied: tool 'bash' was blocked (oap.tool_not_allowed)`

### 选项 2：OAP Passport Provider（基于策略）

基于 [Open Agent Passport (OAP)](https://github.com/aporthq/aport-spec) 开放标准的策略执行。OAP passport 是一份 JSON，声明智能体身份、能力与运行边界。任何读取 OAP passport 并返回符合 OAP 的决策的 provider 都可与 DeerFlow 配合。

```
┌─────────────────────────────────────────────────────────────┐
│                    OAP Passport (JSON)                        │
│                   （开放标准，任意 provider）                  │
│  {                                                           │
│    "spec_version": "oap/1.0",                                │
│    "status": "active",                                       │
│    "capabilities": [                                         │
│      {"id": "system.command.execute"},                       │
│      {"id": "data.file.read"},                               │
│      {"id": "data.file.write"},                              │
│      {"id": "web.fetch"},                                    │
│      {"id": "mcp.tool.execute"}                              │
│    ],                                                        │
│    "limits": {                                               │
│      "system.command.execute": {                             │
│        "allowed_commands": ["git", "npm", "node", "ls"],     │
│        "blocked_patterns": ["rm -rf", "sudo", "chmod 777"]   │
│      }                                                       │
│    }                                                         │
│  }                                                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
               任意符合 OAP 的 provider
          ┌────────────────┼────────────────┐
          │                │                │
     自建            APort（参考        其他后续
     评估器          实现）             实现
```

**手工创建 passport：**

OAP passport 就是 JSON 文件。可按 [OAP 规范](https://github.com/aporthq/aport-spec/blob/main/oap/oap-spec.md) 手写，并用 [JSON schema](https://github.com/aporthq/aport-spec/blob/main/oap/passport-schema.json) 校验。模板见 [examples](https://github.com/aporthq/aport-spec/tree/main/oap/examples) 目录。

**使用 APort 作为参考实现：**

[APort Agent Guardrails](https://github.com/aporthq/aport-agent-guardrails) 是 OAP provider 的开源（Apache 2.0）实现之一，覆盖 passport 创建、本地评估与可选的托管 API 评估。

```bash
pip install aport-agent-guardrails
aport setup --framework deerflow
```

会生成：
- `~/.aport/deerflow/config.yaml` —— 评估器配置（本地或 API 模式）
- `~/.aport/deerflow/aport/passport.json` —— 含能力与限制的 OAP passport

**config.yaml（以 APort 为 provider）：**
```yaml
guardrails:
  enabled: true
  provider:
    use: aport_guardrails.providers.generic:OAPGuardrailProvider
```

**config.yaml（使用你自己的 OAP provider）：**
```yaml
guardrails:
  enabled: true
  provider:
    use: my_oap_provider:MyOAPProvider
    config:
      passport_path: ./my-passport.json
```

任何接受 `framework` 关键字参数并实现 `evaluate`/`aevaluate` 的 provider 均可工作。OAP 标准定义 passport 格式与决策码；DeerFlow 不关心由谁读取它们。

**passport 控制的内容：**

| Passport 字段 | 作用 | 示例 |
|---|---|---|
| `capabilities[].id` | Agent 可使用哪些工具类别 | `system.command.execute`、`data.file.write` |
| `limits.*.allowed_commands` | 允许的命令 | `["git", "npm", "node"]` 或 `["*"]` 表示全部 |
| `limits.*.blocked_patterns` | 始终拒绝的模式 | `["rm -rf", "sudo", "chmod 777"]` |
| `status` | 总开关 | `active`、`suspended`、`revoked` |

**评估模式（取决于 provider）：**

OAP provider 可能支持不同评估模式。例如 APort 参考实现支持：

| 模式 | 工作方式 | 网络 | 延迟 |
|---|---|---|---|
| **Local** | 在本地评估 passport（bash 脚本）。 | 无 | ~300ms |
| **API** | 将 passport + 上下文发到托管评估器。签名决策。 | 有 | ~65ms |

自定义 OAP provider 可实现任意评估策略 —— DeerFlow 中间件不关心 provider 如何得出决策。

**试用：**
1. 按上文安装并配置
2. 启动 DeerFlow 并提问：「Create a file called test.txt with content hello」
3. 再问：「Now delete it using bash rm -rf」
4. Guardrail 拦截：`oap.blocked_pattern: Command contains blocked pattern: rm -rf`

### 选项 3：自定义 Provider（自带实现）

任意带有 `evaluate(request)` 与 `aevaluate(request)` 的 Python 类即可。无需基类或继承 —— 属于结构化协议。

```python
# my_guardrail.py

class MyGuardrailProvider:
    name = "my-company"

    def evaluate(self, request):
        from deerflow.guardrails.provider import GuardrailDecision, GuardrailReason

        # 示例：拦截包含 "delete" 的 bash 命令
        if request.tool_name == "bash" and "delete" in str(request.tool_input):
            return GuardrailDecision(
                allow=False,
                reasons=[GuardrailReason(code="custom.blocked", message="delete not allowed")],
                policy_id="custom.v1",
            )
        return GuardrailDecision(allow=True, reasons=[GuardrailReason(code="oap.allowed")])

    async def aevaluate(self, request):
        return self.evaluate(request)
```

**config.yaml：**
```yaml
guardrails:
  enabled: true
  provider:
    use: my_guardrail:MyGuardrailProvider
```

确保 `my_guardrail.py` 在 Python 路径上（例如在 backend 目录或作为包安装）。

**试用：**
1. 在 backend 目录创建 `my_guardrail.py`
2. 添加上述配置
3. 启动 DeerFlow 并提问：「Use bash to delete test.txt」
4. 你的 provider 会拦截该请求

## 实现 Provider

### 必需接口

```
┌──────────────────────────────────────────────────┐
│              GuardrailProvider Protocol            │
│                                                   │
│  name: str                                        │
│                                                   │
│  evaluate(request: GuardrailRequest)              │
│      -> GuardrailDecision                         │
│                                                   │
│  aevaluate(request: GuardrailRequest)   (async)   │
│      -> GuardrailDecision                         │
└──────────────────────────────────────────────────┘

┌──────────────────────────┐    ┌──────────────────────────┐
│     GuardrailRequest      │    │    GuardrailDecision      │
│                           │    │                           │
│  tool_name: str           │    │  allow: bool              │
│  tool_input: dict         │    │  reasons: [GuardrailReason]│
│  agent_id: str | None     │    │  policy_id: str | None    │
│  thread_id: str | None    │    │  metadata: dict           │
│  is_subagent: bool        │    │                           │
│  timestamp: str           │    │  GuardrailReason:         │
│                           │    │    code: str              │
└──────────────────────────┘    │    message: str           │
                                └──────────────────────────┘
```

### DeerFlow 工具名

Provider 在 `request.tool_name` 中会看到下列工具名：

| 工具 | 作用 |
|---|---|
| `bash` | 执行 shell 命令 |
| `write_file` | 创建/覆盖文件 |
| `str_replace` | 编辑文件（查找替换） |
| `read_file` | 读取文件内容 |
| `ls` | 列出目录 |
| `web_search` | 网页搜索 |
| `web_fetch` | 抓取 URL 内容 |
| `image_search` | 图片搜索 |
| `present_file` | 向用户展示文件 |
| `view_image` | 显示图片 |
| `ask_clarification` | 向用户提问 |
| `task` | 委托给子 Agent |
| `mcp__*` | MCP 工具（动态） |

### OAP 原因码

[OAP 规范](https://github.com/aporthq/aport-spec) 中使用的标准码：

| Code | 含义 |
|---|---|
| `oap.allowed` | 工具调用已授权 |
| `oap.tool_not_allowed` | 工具不在允许列表中 |
| `oap.command_not_allowed` | 命令不在 allowed_commands 中 |
| `oap.blocked_pattern` | 命令匹配被拦截模式 |
| `oap.limit_exceeded` | 操作超出限制 |
| `oap.passport_suspended` | Passport 状态为 suspended/revoked |
| `oap.evaluator_error` | Provider 崩溃（fail-closed） |

### Provider 加载

DeerFlow 通过 `resolve_variable()` 加载 provider —— 与模型、工具、沙箱 provider 相同机制。`use:` 字段为 Python 类路径：`package.module:ClassName`。

若设置了 `config:`，会用 `**config` 关键字参数实例化 provider，并始终注入 `framework="deerflow"`。建议接受 `**kwargs` 以保持向前兼容：

```python
class YourProvider:
    def __init__(self, framework: str = "generic", **kwargs):
        # framework="deerflow" 表示应使用的配置目录
        ...
```

## 配置参考

```yaml
guardrails:
  # Enable/disable guardrail middleware (default: false)
  enabled: true

  # Block tool calls if provider raises an exception (default: true)
  fail_closed: true

  # Passport reference -- passed as request.agent_id to the provider.
  # File path, hosted agent ID, or null (provider resolves from its config).
  passport: null

  # Provider: loaded by class path via resolve_variable
  provider:
    use: deerflow.guardrails.builtin:AllowlistProvider
    config:  # optional kwargs passed to provider.__init__
      denied_tools: ["bash"]
```

## 测试

```bash
cd backend
uv run python -m pytest tests/test_guardrail_middleware.py -v
```

共 25 个用例，覆盖：
- AllowlistProvider：允许、拒绝、同时配置允许+拒绝列表、异步
- GuardrailMiddleware：允许透传、带 OAP 码的拒绝、fail-closed、fail-open、passport 转发、空 reasons 回退、空工具名、协议 isinstance 检查
- 异步路径：`awrap_tool_call` 的允许、拒绝、fail-closed、fail-open
- GraphBubbleUp：LangGraph 控制信号穿透（不被捕获）
- 配置：默认值、from_dict、单例 load/reset

## 相关文件

```
packages/harness/deerflow/guardrails/
    __init__.py              # 对外导出
    provider.py              # GuardrailProvider 协议、GuardrailRequest、GuardrailDecision
    middleware.py             # GuardrailMiddleware（AgentMiddleware 子类）
    builtin.py               # AllowlistProvider（零依赖）

packages/harness/deerflow/config/
    guardrails_config.py     # GuardrailsConfig Pydantic 模型 + 单例

packages/harness/deerflow/agents/middlewares/
    tool_error_handling_middleware.py  # 在链中注册 GuardrailMiddleware

config.example.yaml          # 文档化的三种 provider 选项
tests/test_guardrail_middleware.py  # 25 个测试
docs/GUARDRAILS.md           # 英文原文档
```
