# DeerFlow 后端

DeerFlow 是一个基于 LangGraph 的 AI 超级代理，具有沙箱执行、持久化内存和可扩展工具集成功能。后端使 AI 代理能够在隔离的、每个线程的环境中执行代码、浏览网页、管理文件、委托任务给子代理，并在对话之间保留上下文。

---

## 架构

```
                        ┌──────────────────────────────────────┐
                        │          Nginx (端口 2026)           │
                        │      统一反向代理                    │
                        └───────┬──────────────────┬───────────┘
                                │                  │
              /api/langgraph/*  │                  │  /api/* (其他)
                                ▼                  ▼
               ┌────────────────────┐  ┌────────────────────────┐
               │ LangGraph 服务器   │  │   Gateway API (8001)   │
               │    (端口 2024)     │  │   FastAPI REST         │
               │                    │  │                        │
               │ ┌────────────────┐ │  │ 模型、MCP、技能、       │
               │ │  主代理        │ │  │ 内存、上传、           │
               │ │  ┌──────────┐  │ │  │ 产物                  │
               │ │  │中间件链   │  │ │  └────────────────────────┘
               │ │  │          │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │  工具    │  │ │
               │ │  └──────────┘  │ │
               │ │  ┌──────────┐  │ │
               │ │  │ 子代理   │  │ │
               │ │  └──────────┘  │ │
               │ └────────────────┘ │
               └────────────────────┘
```

**请求路由** (通过 Nginx):
- `/api/langgraph/*` → LangGraph 服务器 - 代理交互、线程、流式传输
- `/api/*` (其他) → Gateway API - 模型、MCP、技能、内存、产物、上传、线程本地清理
- `/` (非 API) → 前端 - Next.js Web 界面

---

## 核心组件

### 主代理 (Lead Agent)

单一的 LangGraph 代理 (`lead_agent`) 是运行时入口点，通过 `make_lead_agent(config)` 创建。它结合了：

- **动态模型选择**，支持思考和视觉功能
- **中间件链**，处理横切关注点 (9 个中间件)
- **工具系统**，包含沙箱、MCP、社区和内置工具
- **子代理委托**，用于并行任务执行
- **系统提示**，包含技能注入、内存上下文和工作目录指导

### 中间件链

中间件按严格顺序执行，每个处理特定的关注点：

| # | 中间件 | 目的 |
|---|--------|------|
| 1 | **ThreadDataMiddleware** | 创建每个线程的隔离目录 (工作区、上传、输出) |
| 2 | **UploadsMiddleware** | 将新上传的文件注入对话上下文 |
| 3 | **SandboxMiddleware** | 获取代码执行的沙箱环境 |
| 4 | **SummarizationMiddleware** | 在接近令牌限制时减少上下文 (可选) |
| 5 | **TodoListMiddleware** | 在计划模式下跟踪多步骤任务 (可选) |
| 6 | **TitleMiddleware** | 在第一次交换后自动生成对话标题 |
| 7 | **MemoryMiddleware** | 将对话排队进行异步内存提取 |
| 8 | **ViewImageMiddleware** | 为支持视觉的模型注入图像数据 (有条件) |
| 9 | **ClarificationMiddleware** | 拦截澄清请求并中断执行 (必须在最后) |

### 沙箱系统

每个线程的隔离执行，具有虚拟路径转换：

- **抽象接口**: `execute_command`, `read_file`, `write_file`, `list_dir`
- **提供者**: `LocalSandboxProvider` (文件系统) 和 `AioSandboxProvider` (Docker, 在 community/ 中)
- **虚拟路径**: `/mnt/user-data/{workspace,uploads,outputs}` → 线程特定的物理目录
- **技能路径**: `/mnt/skills` → `deer-flow/skills/` 目录
- **技能加载**: 递归发现 `skills/{public,custom}` 下的嵌套 `SKILL.md` 文件，并保留嵌套容器路径
- **文件写入安全**: `str_replace` 按 `(sandbox.id, path)` 序列化读-修改-写操作，因此即使虚拟路径匹配，隔离的沙箱也能保持并发性
- **工具**: `bash`, `ls`, `read_file`, `write_file`, `str_replace` (使用 `LocalSandboxProvider` 时默认禁用 `bash`；使用 `AioSandboxProvider` 进行隔离的 shell 访问)

### 子代理系统

异步任务委托与并发执行：

- **内置代理**: `general-purpose` (完整工具集) 和 `bash` (命令专家，仅在 shell 访问可用时暴露)
- **并发性**: 每轮最多 3 个子代理，15 分钟超时
- **执行**: 具有状态跟踪和 SSE 事件的背景线程池
- **流程**: 代理调用 `task()` 工具 → 执行器在后台运行子代理 → 轮询完成状态 → 返回结果

### 内存系统

LLM 驱动的跨对话持久化上下文保留：

- **自动提取**: 分析对话以获取用户上下文、事实和偏好
- **结构化存储**: 用户上下文 (工作、个人、当前关注)、历史记录和置信度评分的事实
- **防抖更新**: 批量更新以最小化 LLM 调用 (可配置等待时间)
- **系统提示注入**: 将顶级事实 + 上下文注入代理提示
- **存储**: JSON 文件，基于修改时间的缓存失效

### 工具生态系统

| 类别 | 工具 |
|------|------|
| **沙箱** | `bash`, `ls`, `read_file`, `write_file`, `str_replace` |
| **内置** | `present_files`, `ask_clarification`, `view_image`, `task` (子代理) |
| **社区** | Tavily (网络搜索), Jina AI (网页获取), Firecrawl (爬虫), DuckDuckGo (图片搜索) |
| **MCP** | 任何模型上下文协议服务器 (stdio, SSE, HTTP 传输) |
| **技能** | 通过系统提示注入的领域特定工作流 |

### Gateway API

提供 REST 端点用于前端集成的 FastAPI 应用程序：

| 路由 | 目的 |
|------|------|
| `GET /api/models` | 列出可用的 LLM 模型 |
| `GET/PUT /api/mcp/config` | 管理 MCP 服务器配置 |
| `GET/PUT /api/skills` | 列出和管理技能 |
| `POST /api/skills/install` | 从 `.skill` 存档安装技能 |
| `GET /api/memory` | 检索内存数据 |
| `POST /api/memory/reload` | 强制重新加载内存 |
| `GET /api/memory/config` | 内存配置 |
| `GET /api/memory/status` | 配置 + 数据的组合 |
| `POST /api/threads/{id}/uploads` | 上传文件 (自动将 PDF/PPT/Excel/Word 转换为 Markdown，拒绝目录路径) |
| `GET /api/threads/{id}/uploads/list` | 列出上传的文件 |
| `DELETE /api/threads/{id}` | 在 LangGraph 线程删除后删除 DeerFlow 管理的本地线程数据；意外失败会在服务器端记录并返回通用的 500 详细信息 |
| `GET /api/threads/{id}/artifacts/{path}` | 提供生成的产物 |

### IM 渠道

IM 桥接支持飞书、Slack 和 Telegram。Slack 和 Telegram 仍使用最终的 `runs.wait()` 响应路径，而飞书现在通过 `runs.stream(["messages-tuple", "values"])` 进行流式传输，并在原地更新单个线程内卡片。

对于飞书卡片更新，DeerFlow 为每个入站消息存储正在运行的卡片的 `message_id`，并在运行完成前修补同一张卡片，保留现有的 `OK` / `DONE` 反应流程。

---

## 快速开始

### 先决条件

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) 包管理器
- 您选择的 LLM 提供商的 API 密钥

### 安装

```bash
cd deer-flow

# 复制配置文件
cp config.example.yaml config.yaml

# 安装后端依赖
cd backend
make install
```

### 配置

编辑项目根目录中的 `config.yaml`：

```yaml
models:
  - name: gpt-4o
    display_name: GPT-4o
    use: langchain_openai:ChatOpenAI
    model: gpt-4o
    api_key: $OPENAI_API_KEY
    supports_thinking: false
    supports_vision: true

  - name: gpt-5-responses
    display_name: GPT-5 (Responses API)
    use: langchain_openai:ChatOpenAI
    model: gpt-5
    api_key: $OPENAI_API_KEY
    use_responses_api: true
    output_version: responses/v1
    supports_vision: true
```

设置您的 API 密钥：

```bash
export OPENAI_API_KEY="your-api-key-here"
```

### 运行

**完整应用程序** (从项目根目录)：

```bash
make dev  # 启动 LangGraph + Gateway + 前端 + Nginx
```

访问地址：http://localhost:2026

**仅后端** (从 backend 目录)：

```bash
# 终端 1: LangGraph 服务器
make dev

# 终端 2: Gateway API
make gateway
```

直接访问：LangGraph 在 http://localhost:2024，Gateway 在 http://localhost:8001

---

## 项目结构

```
backend/
├── src/
│   ├── agents/                  # 代理系统
│   │   ├── lead_agent/         # 主代理 (工厂、提示词)
│   │   ├── middlewares/        # 9 个中间件组件
│   │   ├── memory/             # 内存提取和存储
│   │   └── thread_state.py    # ThreadState 模式
│   ├── gateway/                # FastAPI Gateway API
│   │   ├── app.py             # 应用程序设置
│   │   └── routers/           # 6 个路由模块
│   ├── sandbox/                # 沙箱执行
│   │   ├── local/             # 本地文件系统提供者
│   │   ├── sandbox.py         # 抽象接口
│   │   ├── tools.py           # bash, ls, read/write/str_replace
│   │   └── middleware.py      # 沙箱生命周期
│   ├── subagents/              # 子代理委托
│   │   ├── builtins/          # 通用、bash 代理
│   │   ├── executor.py        # 后台执行引擎
│   │   └── registry.py        # 代理注册表
│   ├── tools/builtins/         # 内置工具
│   ├── mcp/                    # MCP 协议集成
│   ├── models/                 # 模型工厂
│   ├── skills/                 # 技能发现和加载
│   ├── config/                 # 配置系统
│   ├── community/              # 社区工具和提供者
│   ├── reflection/             # 动态模块加载
│   └── utils/                  # 实用工具
├── docs/                       # 文档
├── tests/                      # 测试套件
├── langgraph.json              # LangGraph 服务器配置
├── pyproject.toml              # Python 依赖
├── Makefile                    # 开发命令
└── Dockerfile                  # 容器构建
```

---

## 配置

### 主配置 (`config.yaml`)

放置在项目根目录。以 `$` 开头的配置值解析为环境变量。

关键部分：
- `models` - LLM 配置，包含类路径、API 密钥、思考/视觉标志
- `tools` - 工具定义，包含模块路径和分组
- `tool_groups` - 逻辑工具分组
- `sandbox` - 执行环境提供者
- `skills` - 技能目录路径
- `title` - 自动标题生成设置
- `summarization` - 上下文摘要设置
- `subagents` - 子代理系统 (启用/禁用)
- `memory` - 内存系统设置 (启用、存储、防抖、事实限制)

提供者说明：
- `models[*].use` 通过模块路径引用提供者类 (例如 `langchain_openai:ChatOpenAI`)。
- 如果缺少提供者模块，DeerFlow 现在会返回可操作的错误并提供安装指导 (例如 `uv add langchain-google-genai`)。

### 扩展配置 (`extensions_config.json`)

MCP 服务器和技能状态的单个文件：

```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}
    },
    "secure-http": {
      "enabled": true,
      "type": "http",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "enabled": true,
        "token_url": "https://auth.example.com/oauth/token",
        "grant_type": "client_credentials",
        "client_id": "$MCP_OAUTH_CLIENT_ID",
        "client_secret": "$MCP_OAUTH_CLIENT_SECRET"
      }
    }
  },
  "skills": {
    "pdf-processing": {"enabled": true}
  }
}
```

### 环境变量

- `DEER_FLOW_CONFIG_PATH` - 覆盖 config.yaml 位置
- `DEER_FLOW_EXTENSIONS_CONFIG_PATH` - 覆盖 extensions_config.json 位置
- 模型 API 密钥: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY` 等
- 工具 API 密钥: `TAVILY_API_KEY`, `GITHUB_TOKEN` 等

### LangSmith 追踪

DeerFlow 内置了 [LangSmith](https://smith.langchain.com) 集成，用于可观察性。启用后，所有 LLM 调用、代理运行、工具执行和中间件处理都会被追踪，并可在 LangSmith 仪表板中查看。

**设置：**

1. 在 [smith.langchain.com](https://smith.langchain.com) 注册并创建项目。
2. 将以下内容添加到项目根目录的 `.env` 文件中：

```bash
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=lsv2_pt_xxxxxxxxxxxxxxxx
LANGSMITH_PROJECT=xxx
```

**遗留变量：** `LANGCHAIN_TRACING_V2`、`LANGCHAIN_API_KEY`、`LANGCHAIN_PROJECT` 和 `LANGCHAIN_ENDPOINT` 变量也支持向后兼容。当两者都设置时，`LANGSMITH_*` 变量优先。

### Langfuse 追踪

DeerFlow 还支持 [Langfuse](https://langfuse.com) 可观察性，用于 LangChain 兼容的运行。

将以下内容添加到您的 `.env` 文件中：

```bash
LANGFUSE_TRACING=true
LANGFUSE_PUBLIC_KEY=pk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_SECRET_KEY=sk-lf-xxxxxxxxxxxxxxxx
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

如果您使用自托管的 Langfuse 部署，请将 `LANGFUSE_BASE_URL` 设置为您的 Langfuse 主机。

### 双提供者行为

如果同时启用了 LangSmith 和 Langfuse，DeerFlow 会初始化和附加两个回调，以便相同的运行数据报告给两个系统。

如果明确启用了提供者但缺少必需的凭据，或者无法初始化提供者回调，DeerFlow 会在模型创建期间初始化追踪时引发错误，而不是静默禁用追踪。

**Docker：** 在 `docker-compose.yaml` 中，默认禁用追踪 (`LANGSMITH_TRACING=false`)。在您的 `.env` 中设置 `LANGSMITH_TRACING=true` 和/或 `LANGFUSE_TRACING=true`，以及必需的凭据，以在容器化部署中启用追踪。

---

## 开发

### 命令

```bash
make install    # 安装依赖
make dev        # 运行 LangGraph 服务器 (端口 2024)
make gateway    # 运行 Gateway API (端口 8001)
make lint       # 运行代码检查 (ruff)
make format     # 格式化代码 (ruff)
```

### 代码风格

- **代码检查器/格式化器**: `ruff`
- **行长度**: 240 个字符
- **Python**: 3.12+ 带类型提示
- **引号**: 双引号
- **缩进**: 4 个空格

### 测试

```bash
uv run pytest
```

---

## 技术栈

- **LangGraph** (1.0.6+) - 代理框架和多代理编排
- **LangChain** (1.2.3+) - LLM 抽象和工具系统
- **FastAPI** (0.115.0+) - Gateway REST API
- **langchain-mcp-adapters** - 模型上下文协议支持
- **agent-sandbox** -