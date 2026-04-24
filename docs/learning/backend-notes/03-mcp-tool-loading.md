# MCP 工具加载机制

MCP（Model Context Protocol）是 DeerFlow 扩展 Agent 能力的核心机制。通过 `extensions_config.json` 可接入任意兼容 MCP 协议的外部工具服务器。

---

## 1. 工具加载全景

`get_available_tools()` 是工具的编排中心，汇集 4 类工具返回给 Agent：

| 类型 | 来源 | 加载方式 | 示例 |
|------|------|---------|------|
| **Config 工具** | `config.yaml` 的 `tools` 字段 | `resolve_variable()` 反射加载 | `web_search`, `bash_tool` |
| **内置工具** | 硬编码 `BUILTIN_TOOLS` | 直接引用 | `present_file`, `ask_clarification` |
| **MCP 工具** | `extensions_config.json` | MCP 协议发现 | `yfinance_get_stock_info` |
| **ACP 工具** | `acp_config.json` | 动态构建 | 外部 Agent 调用 |

### 调用链

```
make_lead_agent(config)
  └→ get_available_tools(include_mcp=True)       # tools/tools.py
       ├→ 1. 加载 Config 工具 ─ config.yaml → 过滤 host bash → 反射加载
       ├→ 2. 组装内置工具 ─ present_file + ask_clarification + view_image + task
       ├→ 3. 加载 MCP 工具 ─ 缓存层 → MCP 协议发现 → 同步调用补丁
       │     └→ 可选：tool_search 延迟加载（工具多时节省 token）
       ├→ 4. 加载 ACP 工具
       └→ 5. 合并返回 all_tools
```

---

## 2. Config 工具的反射加载

`config.yaml` 中每个工具通过 `use` 字段指定 Python 模块路径，运行时动态导入：

```
config.yaml                        resolvers.py
──────────                        ────────────
tools:                            ① rsplit(":", 1) 拆分字符串
  - name: web_search              ② import_module() 动态导入模块
    use: deerflow....:web_search  ③ getattr() 取模块级变量
                                  ④ isinstance() 类型校验（BaseTool）
```

**示例**：`use: deerflow.community.ddg_search.tools:web_search_tool`

```python
module_path, variable_name = "deerflow...tools:web_search_tool".rsplit(":", 1)
module = import_module("deerflow.community.ddg_search.tools")
variable = getattr(module, "web_search_tool")       # 必须是模块级已实例化的 BaseTool
assert isinstance(variable, BaseTool)                # 否则抛 ValueError
```

### config.yaml 中的 8 个 Config 工具

| 工具 | 模块 | 备注 |
|------|------|------|
| `web_search` | `deerflow.community.ddg_search.tools` | |
| `web_fetch` | `deerflow.community.jina_ai.tools` | |
| `image_search` | `deerflow.community.image_search.tools` | |
| `ls` / `read_file` / `write_file` / `str_replace` | `deerflow.sandbox.tools` | |
| `bash` | `deerflow.sandbox.tools` | 受安全过滤，需 `allow_host_bash: true` |

**设计要点**：

- **插件式**：接入新工具只需在 config.yaml 加一行 `use: xxx:yyy`，零代码改动
- **类型安全**：加载后必须是 `BaseTool` 实例
- **缺依赖友好**：缺少包时提示 `uv add langchain-xxx`

---

## 3. MCP 缓存层（mcp/cache.py）

核心设计：**懒加载单例缓存 + mtime 热更新**。

### 模块级状态

```python
_mcp_tools_cache: list[BaseTool] | None = None   # 缓存的工具列表
_cache_initialized = False                         # 是否已初始化
_initialization_lock = asyncio.Lock()              # 防并发
_config_mtime: float | None = None                 # 配置文件修改时间
```

### get_cached_mcp_tools() 流程

```
1. _is_cache_stale()? → 配置文件 mtime 变了 → 清空缓存
2. 未初始化? → 懒加载 initialize_mcp_tools()
   ├→ 事件循环已运行（FastAPI）→ 线程池 + 新事件循环
   ├→ 事件循环未运行（CLI）→ 直接用当前循环
   └→ 无事件循环（Python 3.10+）→ asyncio.run() 创建
3. 返回缓存
```

### 三种异步环境适配

| 环境 | 事件循环状态 | 处理策略 |
|------|-------------|---------|
| Web 服务器（FastAPI） | 已运行 | 线程池 + 新事件循环 |
| 命令行脚本 | 未运行 | 直接使用当前循环 |
| Python 3.10+ | 可能不存在 | `asyncio.run()` 创建 |

---

## 4. MCP 工具发现（mcp/tools.py）

`get_mcp_tools()` 执行 MCP 协议通信，加载远程工具：

```python
async def get_mcp_tools() -> list[BaseTool]:
    extensions_config = ExtensionsConfig.from_file()           # 1. 读配置
    servers_config = build_servers_config(extensions_config)

    initial_oauth_headers = await get_initial_oauth_headers()  # 2. OAuth 令牌
    tool_interceptors = [build_oauth_tool_interceptor()]       # 3. 拦截器

    client = MultiServerMCPClient(                             # 4. 创建客户端
        servers_config,
        tool_interceptors=tool_interceptors,
        tool_name_prefix=True,              # 工具名加服务器前缀
    )

    tools = await client.get_tools()                           # 5. 协议发现
    for tool in tools:                                         # 6. 同步调用补丁
        if tool.func is None and tool.coroutine is not None:
            tool.func = _make_sync_tool_wrapper(tool.coroutine, tool.name)

    return tools
```

### 同步调用补丁

MCP 工具通过 `langchain-mcp-adapters` 加载，只有异步方法（`coroutine`）。但 LangGraph 的 `ToolNode` 可能在同步上下文中调用 `tool.func`。通过全局线程池（10 workers）在新线程中创建独立事件循环来解决。

### 通信模式

| 模式 | 配置示例 | 工作原理 |
|------|---------|---------|
| **stdio** | `"command": "/path/to/server"` | 启动子进程，stdin/stdout JSON-RPC |
| **sse** | `"url": "https://..."` | Server-Sent Events 长连接 |
| **http** | `"url": "https://..."` | 标准 HTTP 请求-响应 |

---

## 5. 配置文件解析（extensions_config.py）

### 数据模型

```python
class McpServerConfig(BaseModel):
    enabled: bool = True
    type: str = "stdio"             # stdio / sse / http
    command: str | None = None      # stdio 的可执行文件
    args: list[str] = []
    env: dict[str, str] = {}        # 支持 $VAR 语法引用系统环境变量
    url: str | None = None          # sse/http 的 URL
    oauth: McpOAuthConfig | None    # OAuth 配置
```

### 配置文件查找顺序

| 优先级 | 路径 |
|--------|------|
| 1 | 函数参数 `config_path` |
| 2 | 环境变量 `DEER_FLOW_EXTENSIONS_CONFIG_PATH` |
| 3 | `{cwd}/extensions_config.json` |
| 4 | `{cwd}/../extensions_config.json` |
| 5-6 | `mcp_config.json`（向后兼容旧文件名） |
| 7 | 返回 `None`（扩展是可选的） |

---

## 6. OAuth 令牌管理（mcp/oauth.py）

对 HTTP/SSE 传输的 MCP Server，支持 OAuth 自动令牌管理：

```
首次连接（get_initial_oauth_headers）
  ├→ 遍历启用 OAuth 的服务器
  ├→ POST token_url 获取 access_token
  └→ 缓存 token，注入到 headers

工具调用时（oauth_interceptor）
  ├→ 检查 token 是否即将过期（提前 60s 刷新）
  ├→ 需刷新 → asyncio.Lock 保护下重新获取
  └→ 注入 Authorization header
```

支持 `client_credentials`（M2M）和 `refresh_token` 两种 grant_type。每个服务器有独立锁，避免并发刷新。

---

## 7. tool_search 延迟加载（可选）

工具数量多（>20）时，全部绑定给 LLM 会增加 token 消耗和降低选择准确率。通过 `tool_search.enabled: true` 开启延迟加载。

### 7.1 核心问题

| 问题 | 答案 |
|------|------|
| 为什么需要延迟加载？ | 每个工具 schema 约占 200 token，20 个工具就是 4000 token，每轮都发给 LLM |
| 怎么节省的？ | 只给 LLM 看工具**名称**列表（几十 token），需要时再按需加载完整 schema |
| 会不会影响工具调用？ | 不会。ToolNode 持有所有工具实例，Middleware 只控制 LLM 的**可见性** |

### 7.2 三个协作组件

| 组件 | 文件 | 职责 |
|------|------|------|
| **System Prompt** | `prompt.py` → `get_deferred_tools_prompt_section()` | 在 `<available-deferred-tools>` 中列出工具名（不含 schema） |
| **tool_search 工具** | `tool_search.py` → `tool_search()` | LLM 调用后返回完整 schema，将工具从 deferred 提升为 active |
| **DeferredToolFilterMiddleware** | `deferred_tool_filter_middleware.py` | 每次 LLM 调用前，从 `request.tools` 中过滤掉 deferred 工具的 schema |

### 7.3 完整执行链路（带日志）

下面用一个实际场景演示：用户问 "AAPL 股价多少"，LLM 需要调用 `yfinance_get_stock_info` 工具。

#### 阶段 1：初始化 — 工具注册为 deferred

```
┌─ get_available_tools() ─────────────────────────────────────────────────────────┐
│                                                                                  │
│  ① 加载 MCP 工具                                                                │
│  LOG: "Using 5 cached MCP tool(s)"                                              │
│                                                                                  │
│  ② 检测 tool_search.enabled = true → 注册到 DeferredToolRegistry               │
│     registry = DeferredToolRegistry()                                            │
│     for t in mcp_tools:                                                          │
│         registry.register(t)    # 存入 entries 列表                              │
│     set_deferred_registry(registry)   # 写入 ContextVar                         │
│     builtin_tools.append(tool_search_tool)                                       │
│  LOG: "Tool search active: 5 tools deferred"                                    │
│                                                                                  │
│  ③ 合并返回（MCP 工具仍在 all_tools 中，供 ToolNode 执行用）                      │
│  LOG: "[FLOW] 🧰 Tools loaded: total=15 — [web_search, bash, ...,               │
│         yfinance_get_stock_info, ..., tool_search]"                              │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**关键**：`all_tools` 包含所有工具（含 MCP），因为 `ToolNode(tools=all_tools)` 需要持有它们来执行。但 LLM 暂时**看不到**它们的 schema。

#### 阶段 2：System Prompt 注入工具名称

```
┌─ apply_prompt_template() ───────────────────────────────────────────────────────┐
│                                                                                  │
│  deferred_tools_section = get_deferred_tools_prompt_section()                   │
│                                                                                  │
│  → 从 ContextVar 获取 registry                                                  │
│  → 生成工具名列表（只有名字，没有参数 schema）                                    │
│                                                                                  │
│  LLM System Prompt 中包含：                                                      │
│  ┌──────────────────────────────────────────────┐                                │
│  │ <available-deferred-tools>                   │                                │
│  │ yfinance_get_stock_info                      │  ← 只有名字                    │
│  │ yfinance_get_fast_info                       │  ← 没有参数                    │
│  │ yfinance_get_analyst_recommendations         │  ← 没有 schema                │
│  │ github_create_issue                          │  ← LLM 知道存在               │
│  │ github_list_repos                            │  ← 但不知道怎么调用            │
│  │ </available-deferred-tools>                  │                                │
│  └──────────────────────────────────────────────┘                                │
│                                                                                  │
│  Token 节省：5 个工具 × ~200 token/schema ≈ 节省 ~1000 token/轮                  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### 阶段 3：第 1 轮 LLM 调用 — Middleware 过滤 deferred 工具

```
┌─ DeferredToolFilterMiddleware._filter_tools() ──────────────────────────────────┐
│                                                                                  │
│  LOG: "[DEFERRED] 🔄 awrap_model_call (async) — filtering deferred tools        │
│        before LLM binding"                                                       │
│                                                                                  │
│  ① 获取 deferred 名称集合                                                        │
│  LOG: "[DEFERRED] Registry contains 5 deferred tool(s):                         │
│        ['github_create_issue', 'github_list_repos',                             │
│         'yfinance_get_analyst_recommendations',                                  │
│         'yfinance_get_fast_info', 'yfinance_get_stock_info']"                   │
│                                                                                  │
│  ② 记录原始工具列表                                                               │
│  LOG: "[DEFERRED] Original tools (15): ['web_search', 'bash', ...,              │
│        'yfinance_get_stock_info', ..., 'tool_search']"                          │
│                                                                                  │
│  ③ 逐个检查，分为 active / deferred                                              │
│  LOG: "[DEFERRED] 🔍 Filtered out 5 deferred tool(s):                           │
│        ['yfinance_get_stock_info', ...]"                                         │
│  LOG: "[DEFERRED] ✅ Kept 10 active tool(s):                                    │
│        ['web_search', 'bash', ..., 'tool_search']"                              │
│  LOG: "[DEFERRED] 📊 Token savings: ~1000 tokens                                │
│        (estimated 200 tokens per tool schema)"                                   │
│                                                                                  │
│  ④ 返回过滤后的 request                                                          │
│  LOG: "[DEFERRED] 📤 Passing filtered request to async handler"                 │
│                                                                                  │
│  → model.bind_tools() 只收到 10 个工具的 schema                                  │
│  → LLM 看不到 yfinance_get_stock_info 的参数定义                                 │
│  → 但 LLM 看到 system prompt 中的 <available-deferred-tools> 列表               │
│  → LLM 看到 tool_search 的描述，理解需要先搜索才能使用                             │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**LLM 决策**：我需要查股价 → 看到 `yfinance_get_stock_info` 在 deferred 列表 → 先调用 `tool_search` 获取 schema。

#### 阶段 4：ToolNode 执行 tool_search — 发现工具并提升

```
┌─ tool_search("select:yfinance_get_stock_info") ─────────────────────────────────┐
│                                                                                  │
│  ① 从 ContextVar 获取 registry                                                  │
│     registry = get_deferred_registry()                                           │
│                                                                                  │
│  ② 解析查询：以 "select:" 开头 → 精确名称匹配                                    │
│     names = {"yfinance_get_stock_info"}                                          │
│     matched_tools = [e.tool for e in entries if e.name in names]                 │
│     → 匹配到 1 个工具                                                            │
│                                                                                  │
│  ③ 生成完整 OpenAI Function schema                                               │
│     tool_defs = [convert_to_openai_function(tool)]                               │
│     → 输出：                                                                     │
│     [                                                                            │
│       {                                                                          │
│         "name": "yfinance_get_stock_info",                                       │
│         "description": "Get stock information for a given symbol",               │
│         "parameters": {                                                          │
│           "type": "object",                                                      │
│           "properties": {                                                        │
│             "symbol": {"type": "string", "description": "Stock ticker symbol"}   │
│           },                                                                     │
│           "required": ["symbol"]                                                 │
│         }                                                                        │
│       }                                                                          │
│     ]                                                                            │
│                                                                                  │
│  ④ 提升工具：从 deferred 列表移除                                                 │
│     registry.promote({"yfinance_get_stock_info"})                                │
│     → entries 从 5 个变为 4 个                                                   │
│  LOG: "Promoted 1 tool(s) from deferred to active:                              │
│        {'yfinance_get_stock_info'}"                                              │
│                                                                                  │
│  ⑤ 返回 JSON schema 给 LLM                                                      │
│     → LLM 现在知道这个工具的参数定义了                                             │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

#### 阶段 5：第 2 轮 LLM 调用 — 工具可见、正常调用

```
┌─ DeferredToolFilterMiddleware._filter_tools()（第 2 次） ────────────────────────┐
│                                                                                  │
│  LOG: "[DEFERRED] 🔄 awrap_model_call (async) — filtering deferred tools        │
│        before LLM binding"                                                       │
│                                                                                  │
│  deferred_names = 4 个（yfinance_get_stock_info 已被 promote 移除）              │
│  LOG: "[DEFERRED] Registry contains 4 deferred tool(s): [...]"                  │
│  LOG: "[DEFERRED] 🔍 Filtered out 4 deferred tool(s): [...]"                   │
│  LOG: "[DEFERRED] ✅ Kept 11 active tool(s):                                    │
│        ['web_search', ..., 'yfinance_get_stock_info', 'tool_search']"           │
│                     ← yfinance_get_stock_info 现在在 active 列表中了！           │
│                                                                                  │
│  → model.bind_tools() 收到 11 个工具的 schema                                   │
│  → LLM 看到 yfinance_get_stock_info 的完整参数定义                               │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ LLM 调用 yfinance_get_stock_info({"symbol": "AAPL"}) ─────────────────────────┐
│                                                                                  │
│  → ToolNode 在 tools_by_name 中查找 "yfinance_get_stock_info"                   │
│  → 找到（因为 all_tools 从初始化时就包含了它）                                    │
│  → 执行 MCP 调用 → 返回股价数据                                                  │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 Token 优化原理

```
                          不使用 tool_search           使用 tool_search
                         ──────────────────          ──────────────────

每轮发送给 LLM 的       所有工具的完整 schema         仅 active 工具的 schema
工具定义 token 数        15 × ~200 = ~3000           10 × ~200 = ~2000
                                                     + deferred 名称列表 ~50

首轮额外开销             无                           tool_search 调用 1 次
                                                     + 返回 schema ~200 token

5 轮对话总 token          ~3000 × 5 = ~15000          ~2000 × 5 + 250 = ~10250
（假设只用 1 个 MCP 工具）                              节省 ~32%

20 轮对话总 token         ~3000 × 20 = ~60000         ~2000 × 20 + 250 = ~40250
                                                      节省 ~33%
```

**核心洞察**：token 节省来自**每轮**都不发送未使用工具的 schema，轮次越多收益越大。

### 7.5 为什么 mcp_tools 必须在 all_tools 中？

```
create_agent(tools=all_tools, ...)
     │
     ├→ ToolNode(tools=all_tools)       ← 持有所有工具实例，用于执行
     │    tools_by_name = {              │
     │      "web_search": ...,           │
     │      "yfinance_get_stock_info": . │ ← 如果不在这里，promote 后也无法执行
     │      "tool_search": ...,          │
     │    }                              │
     │                                   │
     └→ default_tools = all_tools        ← ModelRequest 的初始工具列表
          │
          └→ DeferredToolFilterMiddleware ← 运行时动态过滤，控制 LLM 可见性
```

如果在 `tools.py` 层面排除 MCP 工具：LLM 通过 `tool_search` 发现后调用 → ToolNode 的 `tools_by_name` 中找不到 → `"unknown tool"` 错误。

### 7.6 tool_search 查询语法

| 语法 | 示例 | 行为 | 适用场景 |
|------|------|------|---------|
| `select:name1,name2` | `select:yfinance_get_stock_info` | 精确名称匹配 | LLM 从 deferred 列表中确切知道工具名 |
| `+keyword rest` | `+yfinance stock` | 名称必须含 keyword，按 rest 排序 | 知道服务器前缀，模糊搜索功能 |
| `keyword query` | `stock price info` | 正则匹配名称+描述，名称匹配权重 ×2 | 不确定工具名，按语义搜索 |

每次最多返回 `MAX_RESULTS = 5` 个工具。

### 7.7 ContextVar 请求隔离

```python
_registry_var: ContextVar[DeferredToolRegistry | None] = ContextVar(
    "deferred_tool_registry", default=None
)
```

| 并发场景 | 隔离方式 |
|---------|---------|
| 多个 asyncio 请求 | 每个请求的 async context 独立，ContextVar 自动隔离 |
| 同步工具执行（`run_in_executor`） | Python 自动复制当前 context 到 worker 线程 |
| 不同用户同时查询 | 各自独立的 registry，promote 互不影响 |

### 7.8 使用建议

| 场景 | 建议 | 原因 |
|------|------|------|
| 工具少（<10），使用频繁 | `enabled: false` | 额外的 tool_search 调用反而增加延迟 |
| 工具多（>20），使用分散 | `enabled: true` | 每轮省 ~2000+ token，LLM 工具选择更准确 |
| 工具多但每轮都用 | `enabled: true` | 首轮多一次调用，后续每轮持续节省 |

---

## 8. 实际接入

### stdio 模式（本地）

```json
{
  "mcpServers": {
    "yfinance": {
      "enabled": true,
      "type": "stdio",
      "command": "/path/to/.venv/bin/yfinance-mcp-server",
      "args": [],
      "env": {}
    }
  }
}
```

### OAuth 保护的远程服务器

```json
{
  "mcpServers": {
    "enterprise-tools": {
      "enabled": true,
      "type": "sse",
      "url": "https://mcp.internal.company.com/sse",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.company.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$ENTERPRISE_CLIENT_ID",
        "client_secret": "$ENTERPRISE_CLIENT_SECRET",
        "scope": "mcp:read mcp:write"
      }
    }
  }
}
```

### 注意事项

- `command` 用绝对路径，避免 pyenv shim 找不到
- `extensions_config.json` 在 `.gitignore` 中，参考 `extensions_config.example.json`
- 配置中 `$VAR` 语法会自动替换为系统环境变量
- OAuth 令牌自动管理和刷新
- `tool_name_prefix=True`：工具名加服务器前缀（如 `yfinance_get_stock_info`）

---

## 关键文件索引

| 环节 | 路径 |
|------|------|
| 工具编排中心 | `packages/harness/deerflow/tools/tools.py` |
| MCP 缓存层 | `packages/harness/deerflow/mcp/cache.py` |
| MCP 工具发现 | `packages/harness/deerflow/mcp/tools.py` |
| MCP 客户端构建 | `packages/harness/deerflow/mcp/client.py` |
| OAuth 令牌管理 | `packages/harness/deerflow/mcp/oauth.py` |
| 配置数据模型 | `packages/harness/deerflow/config/extensions_config.py` |
| 反射加载器 | `packages/harness/deerflow/reflection/resolvers.py` |
| tool_search | `packages/harness/deerflow/tools/builtins/tool_search.py` |
| DeferredToolFilterMiddleware | `packages/harness/deerflow/agents/middlewares/deferred_tool_filter_middleware.py` |
| System Prompt | `packages/harness/deerflow/agents/lead_agent/prompt.py` |
| host bash 安全 | `packages/harness/deerflow/sandbox/security.py` |
