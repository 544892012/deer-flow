# 配置指南

本指南说明如何为当前环境配置 DeerFlow。

## 配置版本（config_version）

`config.example.yaml` 中的 `config_version` 字段用于跟踪配置结构变更。当示例中的版本高于本地 `config.yaml` 时，应用启动会发出警告：

```
WARNING - Your config.yaml (version 0) is outdated — the latest version is 1.
Run `make config-upgrade` to merge new fields into your config.
```

- 本地配置**缺少 `config_version`** 时视为版本 0。
- 执行 `make config-upgrade` 可自动合并缺失字段（保留已有取值，并生成 `.bak` 备份）。
- 修改配置结构时，请在 `config.example.yaml` 中提高 `config_version`。

## 配置章节

### 模型（Models）

配置 agent 可用的大语言模型：

```yaml
models:
  - name: gpt-4                    # Internal identifier
    display_name: GPT-4            # Human-readable name
    use: langchain_openai:ChatOpenAI  # LangChain class path
    model: gpt-4                   # Model identifier for API
    api_key: $OPENAI_API_KEY       # API key (use env var)
    max_tokens: 4096               # Max tokens per request
    temperature: 0.7               # Sampling temperature
```

**支持的提供商**：
- OpenAI（`langchain_openai:ChatOpenAI`）
- Anthropic（`langchain_anthropic:ChatAnthropic`）
- DeepSeek（`langchain_deepseek:ChatDeepSeek`）
- Claude Code OAuth（`deerflow.models.claude_provider:ClaudeChatModel`）
- Codex CLI（`deerflow.models.openai_codex_provider:CodexChatModel`）
- 任意兼容 LangChain 的提供商

基于 CLI 的提供商示例：

```yaml
models:
  - name: gpt-5.4
    display_name: GPT-5.4 (Codex CLI)
    use: deerflow.models.openai_codex_provider:CodexChatModel
    model: gpt-5.4
    supports_thinking: true
    supports_reasoning_effort: true

  - name: claude-sonnet-4.6
    display_name: Claude Sonnet 4.6 (Claude Code OAuth)
    use: deerflow.models.claude_provider:ClaudeChatModel
    model: claude-sonnet-4-6
    max_tokens: 4096
    supports_thinking: true
```

**CLI 提供商的认证行为**：
- `CodexChatModel` 从 `~/.codex/auth.json` 读取 Codex CLI 认证
- Codex Responses 接口当前不接受 `max_tokens` 与 `max_output_tokens`，因此 `CodexChatModel` 不在请求层暴露 token 上限
- `ClaudeChatModel` 支持 `CLAUDE_CODE_OAUTH_TOKEN`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`、`CLAUDE_CODE_CREDENTIALS_PATH`，或明文 `~/.claude/.credentials.json`
- 在 macOS 上，DeerFlow 不会自动探测钥匙串。需要时可使用 `scripts/export_claude_code_oauth.py` 显式导出 Claude Code 认证

若要在 LangChain 中使用 OpenAI 的 `/v1/responses` 接口，可继续使用 `langchain_openai:ChatOpenAI` 并设置：

```yaml
models:
  - name: gpt-5-responses
    display_name: GPT-5 (Responses API)
    use: langchain_openai:ChatOpenAI
    model: gpt-5
    api_key: $OPENAI_API_KEY
    use_responses_api: true
    output_version: responses/v1
```

对于 OpenAI 兼容网关（例如 Novita 或 OpenRouter），仍使用 `langchain_openai:ChatOpenAI` 并设置 `base_url`：

```yaml
models:
  - name: novita-deepseek-v3.2
    display_name: Novita DeepSeek V3.2
    use: langchain_openai:ChatOpenAI
    model: deepseek/deepseek-v3.2
    api_key: $NOVITA_API_KEY
    base_url: https://api.novita.ai/openai
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled

  - name: minimax-m2.5
    display_name: MiniMax M2.5
    use: langchain_openai:ChatOpenAI
    model: MiniMax-M2.5
    api_key: $MINIMAX_API_KEY
    base_url: https://api.minimax.io/v1
    max_tokens: 4096
    temperature: 1.0  # MiniMax requires temperature in (0.0, 1.0]
    supports_vision: true

  - name: minimax-m2.5-highspeed
    display_name: MiniMax M2.5 Highspeed
    use: langchain_openai:ChatOpenAI
    model: MiniMax-M2.5-highspeed
    api_key: $MINIMAX_API_KEY
    base_url: https://api.minimax.io/v1
    max_tokens: 4096
    temperature: 1.0  # MiniMax requires temperature in (0.0, 1.0]
    supports_vision: true
  - name: openrouter-gemini-2.5-flash
    display_name: Gemini 2.5 Flash (OpenRouter)
    use: langchain_openai:ChatOpenAI
    model: google/gemini-2.5-flash-preview
    api_key: $OPENAI_API_KEY
    base_url: https://openrouter.ai/api/v1
```

若 OpenRouter 密钥放在其他环境变量名中，请将 `api_key` 显式指向该变量（例如 `api_key: $OPENROUTER_API_KEY`）。

**思考（Thinking）模型**：
部分模型支持用于复杂推理的「思考」模式：

```yaml
models:
  - name: deepseek-v3
    supports_thinking: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

**通过 OpenAI 兼容网关启用 Gemini 思考模式**：

当通过 OpenAI 兼容代理（Vertex AI OpenAI 兼容端点、AI Studio 或第三方网关）路由 Gemini 并启用思考时，API 会在响应中为每个工具调用对象附加 `thought_signature`。后续请求若重放这些助手消息，**必须**在工具调用条目中回传这些签名，否则 API 会返回：

```
HTTP 400 INVALID_ARGUMENT: function call `<tool>` in the N. content block is
missing a `thought_signature`.
```

标准 `langchain_openai:ChatOpenAI` 在序列化消息时会丢弃 `thought_signature`。请改用 `deerflow.models.patched_openai:PatchedChatOpenAI` — 它会将工具调用签名（来自 `AIMessage.additional_kwargs["tool_calls"]`）重新注入每个出站载荷：

```yaml
models:
  - name: gemini-2.5-pro-thinking
    display_name: Gemini 2.5 Pro (Thinking)
    use: deerflow.models.patched_openai:PatchedChatOpenAI
    model: google/gemini-2.5-pro-preview   # model name as expected by your gateway
    api_key: $GEMINI_API_KEY
    base_url: https://<your-openai-compat-gateway>/v1
    max_tokens: 16384
    supports_thinking: true
    supports_vision: true
    when_thinking_enabled:
      extra_body:
        thinking:
          type: enabled
```

若访问 Gemini 时**未**启用思考（例如通过 OpenRouter 且未激活思考），使用普通 `langchain_openai:ChatOpenAI` 且 `supports_thinking: false` 即可，无需补丁。

### 工具组（Tool Groups）

将工具划分为逻辑分组：

```yaml
tool_groups:
  - name: web          # Web browsing and search
  - name: file:read    # Read-only file operations
  - name: file:write   # Write file operations
  - name: bash         # Shell command execution
```

### 工具（Tools）

配置 agent 可用的具体工具：

```yaml
tools:
  - name: web_search
    group: web
    use: deerflow.community.tavily.tools:web_search_tool
    max_results: 5
    # api_key: $TAVILY_API_KEY  # Optional
```

**内置工具**：
- `web_search` — 网页搜索（Tavily）
- `web_fetch` — 抓取网页（Jina AI）
- `ls` — 列出目录内容
- `read_file` — 读取文件内容
- `write_file` — 写入文件内容
- `str_replace` — 文件中字符串替换
- `bash` — 执行 bash 命令

### 沙箱（Sandbox）

DeerFlow 支持多种沙箱执行模式。在 `config.yaml` 中选择所需模式：

**本地执行**（在宿主机上直接执行沙箱代码）：
```yaml
sandbox:
   use: deerflow.sandbox.local:LocalSandboxProvider # Local execution
   allow_host_bash: false # default; host bash is disabled unless explicitly re-enabled
```

**Docker 执行**（在隔离的 Docker 容器中执行）：
```yaml
sandbox:
   use: deerflow.community.aio_sandbox:AioSandboxProvider # Docker-based sandbox
```

**Docker + Kubernetes 执行**（通过 provisioner 服务在 Kubernetes Pod 中执行）：

该模式下每个沙箱运行在**本机集群**中隔离的 Pod 内。需要 Docker Desktop K8s、OrbStack 或类似的本地 K8s 环境。

```yaml
sandbox:
   use: deerflow.community.aio_sandbox:AioSandboxProvider
   provisioner_url: http://provisioner:8002
```

使用 Docker 开发（`make docker-start`）时，仅当配置了上述 provisioner 模式时才会启动 `provisioner` 服务；本地或纯 Docker 沙箱模式下不会启动 `provisioner`。

详细配置、前置条件与排错见 [Provisioner 安装指南](../../docker/provisioner/README.md)。

在本地执行与基于 Docker 的隔离之间选择：

**选项 1：本地沙箱**（默认，配置更简单）：
```yaml
sandbox:
  use: deerflow.sandbox.local:LocalSandboxProvider
  allow_host_bash: false
```

`allow_host_bash` 默认为 `false` 是有意为之。DeerFlow 的本地沙箱是宿主机侧的便利模式，并非安全的 shell 隔离边界。若需要 `bash`，优先使用 `AioSandboxProvider`。仅在完全可信的单用户本地场景下才设置 `allow_host_bash: true`。

**选项 2：Docker 沙箱**（隔离性更好，更安全）：
```yaml
sandbox:
  use: deerflow.community.aio_sandbox:AioSandboxProvider
  port: 8080
  auto_start: true
  container_prefix: deer-flow-sandbox

  # Optional: Additional mounts
  mounts:
    - host_path: /path/on/host
      container_path: /path/in/container
      read_only: false
```

### 技能（Skills）

配置技能目录以支持专项工作流：

```yaml
skills:
  # Host path (optional, default: ../skills)
  path: /custom/path/to/skills

  # Container mount path (default: /mnt/skills)
  container_path: /mnt/skills
```

**技能如何工作**：
- 技能存放在 `deer-flow/skills/{public,custom}/`
- 每个技能包含带元数据的 `SKILL.md`
- 技能会被自动发现并加载
- 通过路径映射，在本地与 Docker 沙箱中均可使用

### 标题生成

自动生成会话标题：

```yaml
title:
  enabled: true
  max_words: 6
  max_chars: 60
  model_name: null  # Use first model in list
```

### GitHub API 令牌（GitHub 深度研究技能可选）

默认 GitHub API 速率限制较严。若频繁做项目调研，建议配置只读权限的个人访问令牌（PAT）。

**配置步骤**：
1. 在 `.env` 中取消注释 `GITHUB_TOKEN` 行并填入个人访问令牌
2. 重启 DeerFlow 服务使配置生效

## 环境变量

DeerFlow 支持以 `$` 前缀做环境变量替换：

```yaml
models:
  - api_key: $OPENAI_API_KEY  # Reads from environment
```

**常用环境变量**：
- `OPENAI_API_KEY` — OpenAI API 密钥
- `ANTHROPIC_API_KEY` — Anthropic API 密钥
- `DEEPSEEK_API_KEY` — DeepSeek API 密钥
- `NOVITA_API_KEY` — Novita API 密钥（OpenAI 兼容端点）
- `TAVILY_API_KEY` — Tavily 搜索 API 密钥
- `DEER_FLOW_CONFIG_PATH` — 自定义配置文件路径

## 配置文件位置

配置文件应放在**项目根目录**（`deer-flow/config.yaml`），不要放在 `backend/` 目录下。

## 配置查找优先级

DeerFlow 按以下顺序查找配置：

1. 代码中通过 `config_path` 参数指定的路径
2. 环境变量 `DEER_FLOW_CONFIG_PATH`
3. 当前工作目录下的 `config.yaml`（从 `backend/` 运行时通常指此处）
4. 上一级目录下的 `config.yaml`（项目根：`deer-flow/`）

## 最佳实践

1. **将 `config.yaml` 放在项目根目录** — 不要放在 `backend/` 下
2. **不要将 `config.yaml` 提交到版本库** — 已在 `.gitignore` 中忽略
3. **密钥使用环境变量** — 不要在配置中硬编码 API 密钥
4. **保持 `config.example.yaml` 更新** — 新选项都要在示例中说明
5. **部署前在本地验证配置变更**
6. **生产环境优先使用 Docker 沙箱** — 隔离性与安全性更好

## 故障排查

### 「找不到配置文件」
- 确认 `config.yaml` 存在于**项目根目录**（`deer-flow/config.yaml`）
- 后端默认会查找父目录，根目录位置优先
- 或设置环境变量 `DEER_FLOW_CONFIG_PATH` 指向自定义路径

### 「API 密钥无效」
- 确认环境变量已正确设置
- 确认环境变量引用使用了 `$` 前缀

### 「技能未加载」
- 确认 `deer-flow/skills/` 目录存在
- 确认技能包含有效的 `SKILL.md`
- 若使用自定义路径，检查 `skills.path` 配置

### 「Docker 沙箱无法启动」
- 确认 Docker 已运行
- 确认 8080 端口（或配置的端口）未被占用
- 确认可访问所需 Docker 镜像

## 示例

完整配置示例见 `config.example.yaml`。
