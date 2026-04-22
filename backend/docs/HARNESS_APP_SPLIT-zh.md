# DeerFlow 后端拆分设计文档：Harness + App

> 状态：草稿  
> 作者：DeerFlow 团队  
> 日期：2026-03-13

## 1. 背景与动机

DeerFlow 后端当前是一个单一 Python 包（`src.*`），从底层 agent 编排到上层用户产品代码都在其中。随着项目发展，这种结构带来若干问题：

- **复用困难**：其他产品（CLI、Slack 机器人、第三方集成）若要使用 agent 能力，必须依赖整个后端，包括 FastAPI、IM SDK 等并不需要的部分  
- **职责模糊**：agent 编排与用户产品逻辑混在同一 `src/` 下，边界不清  
- **依赖膨胀**：LangGraph Server 运行时不需要 FastAPI/uvicorn/Slack SDK，但当前必须安装全部依赖  

本文档提议将后端拆为两部分：**deerflow-harness**（可发布的 agent 框架包）与 **app**（不单独打包的用户产品代码）。

## 2. 核心概念

### 2.1 Harness（框架层）

Harness 是构建与编排 agent 的框架，回答 **「如何构建并运行 agent」**：

- Agent 工厂与生命周期  
- 中间件流水线（middleware pipeline）  
- 工具系统（内置 + MCP + 社区工具）  
- 沙箱执行环境  
- 子 agent 委派  
- 记忆系统  
- 技能加载与注入  
- 模型工厂  
- 配置系统  

**Harness 是可发布的 Python 包**（`deerflow-harness`），可独立安装使用。

**设计原则**：对上层应用零感知。不区分调用方是 Web、CLI、Slack 机器人还是单元测试。

### 2.2 App（应用层）

App 是面向用户的产品代码，回答 **「如何把 agent 交付给用户」**：

- Gateway API（FastAPI REST）  
- IM Channels（飞书、Slack、Telegram）  
- Custom Agent 的 CRUD  
- 文件上传/下载的 HTTP 接口  

**App 不打包、不发布**，作为 DeerFlow 仓库内的应用代码直接运行。

**App 依赖 Harness；Harness 不依赖 App。**

### 2.3 边界划分

| 模块 | 归属 | 说明 |
|------|------|------|
| `config/` | Harness | 配置系统属于基础设施 |
| `reflection/` | Harness | 动态模块加载 |
| `utils/` | Harness | 通用工具 |
| `agents/` | Harness | Agent 工厂、中间件、状态、记忆 |
| `subagents/` | Harness | 子 agent 委派 |
| `sandbox/` | Harness | 沙箱执行 |
| `tools/` | Harness | 工具注册与发现 |
| `mcp/` | Harness | MCP 协议集成 |
| `skills/` | Harness | 技能加载、解析、schema |
| `models/` | Harness | LLM 模型工厂 |
| `community/` | Harness | 社区工具（tavily、jina 等） |
| `client.py` | Harness | 嵌入式 Python 客户端 |
| `gateway/` | App | FastAPI REST API |
| `channels/` | App | IM 平台集成 |

**关于 Custom Agents**：agent 定义格式（`config.yaml` + `SOUL.md` schema）由 Harness 层 `config/agents_config.py` 定义；文件的存储、CRUD、发现由 App 层 `gateway/routers/agents.py` 负责。

## 3. 目标架构

### 3.1 目录结构

```
backend/
├── packages/
│   └── harness/
│       ├── pyproject.toml          # deerflow-harness 包定义
│       └── deerflow/               # Python 包根（import 前缀: deerflow.*）
│           ├── __init__.py
│           ├── config/
│           ├── reflection/
│           ├── utils/
│           ├── agents/
│           │   ├── lead_agent/
│           │   ├── middlewares/
│           │   ├── memory/
│           │   ├── checkpointer/
│           │   └── thread_state.py
│           ├── subagents/
│           ├── sandbox/
│           ├── tools/
│           ├── mcp/
│           ├── skills/
│           ├── models/
│           ├── community/
│           └── client.py
├── app/                            # 不打包（import 前缀: app.*）
│   ├── __init__.py
│   ├── gateway/
│   │   ├── __init__.py
│   │   ├── app.py
│   │   ├── config.py
│   │   ├── path_utils.py
│   │   └── routers/
│   └── channels/
│       ├── __init__.py
│       ├── base.py
│       ├── manager.py
│       ├── service.py
│       ├── store.py
│       ├── message_bus.py
│       ├── feishu.py
│       ├── slack.py
│       └── telegram.py
├── pyproject.toml                  # uv workspace root
├── langgraph.json
├── tests/
├── docs/
└── Makefile
```

### 3.2 Import 规则

两层使用不同 import 前缀，职责一目了然：

```python
# ---------------------------------------------------------------
# Harness 内部互相引用（deerflow.* 前缀）
# ---------------------------------------------------------------
from deerflow.agents import make_lead_agent
from deerflow.models import create_chat_model
from deerflow.config import get_app_config
from deerflow.tools import get_available_tools

# ---------------------------------------------------------------
# App 内部互相引用（app.* 前缀）
# ---------------------------------------------------------------
from app.gateway.app import app
from app.gateway.routers.uploads import upload_files
from app.channels.service import start_channel_service

# ---------------------------------------------------------------
# App 调用 Harness（单向依赖，Harness 永远不 import app）
# ---------------------------------------------------------------
from deerflow.agents import make_lead_agent
from deerflow.models import create_chat_model
from deerflow.skills import load_skills
from deerflow.config.extensions_config import get_extensions_config
```

**App 调用 Harness 示例 — Gateway 中启动 agent**：

```python
# app/gateway/routers/chat.py
from deerflow.agents.lead_agent.agent import make_lead_agent
from deerflow.models import create_chat_model
from deerflow.config import get_app_config

async def create_chat_session(thread_id: str, model_name: str):
    config = get_app_config()
    model = create_chat_model(name=model_name)
    agent = make_lead_agent(config=...)
    # ... 使用 agent 处理用户消息
```

**App 调用 Harness 示例 — Channel 中查询 skills**：

```python
# app/channels/manager.py
from deerflow.skills import load_skills
from deerflow.agents.memory.updater import get_memory_data

def handle_status_command():
    skills = load_skills(enabled_only=True)
    memory = get_memory_data()
    return f"Skills: {len(skills)}, Memory facts: {len(memory.get('facts', []))}"
```

**禁止方向**：Harness 代码中不得出现 `from app.` 或 `import app.`。

### 3.3 为何 App 不打包

| 方面 | 打包（置于 packages/） | 不打包（置于 backend/app/） |
|------|------------------------|--------------------------|
| 命名空间 | 需 pkgutil `extend_path` 或独立前缀 | 天然分离：`app.*` 与 `deerflow.*` |
| 发布需求 | 无 — App 为仓库内代码 | 无需独立 pyproject |
| 复杂度 | 双包构建、版本、依赖 | 直接运行，额外配置少 |
| 运行方式 | `pip install deerflow-app` | `PYTHONPATH=. uvicorn app.gateway.app:app` |

App 的唯一消费者是 DeerFlow 项目本身，无独立发布需求。放在 `backend/app/`，通过 `PYTHONPATH` 或可编辑安装即可被 Python 找到。

### 3.4 依赖关系

```
┌─────────────────────────────────────┐
│  app/  (不打包，直接运行)             │
│  ├── fastapi, uvicorn               │
│  ├── slack-sdk, lark-oapi, ...      │
│  └── import deerflow.*              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  deerflow-harness  (可发布的包)       │
│  ├── langgraph, langchain           │
│  ├── markitdown, pydantic, ...      │
│  └── 零 app 依赖                     │
└─────────────────────────────────────┘
```

**依赖分类**：

| 分类 | 依赖包 |
|------|--------|
| 仅 Harness | agent-sandbox、langchain*、langgraph*、markdownify、markitdown、pydantic、pyyaml、readabilipy、tavily-python、firecrawl-py、tiktoken、ddgs、duckdb、httpx、kubernetes、dotenv |
| 仅 App | fastapi、uvicorn、sse-starlette、python-multipart、lark-oapi、slack-sdk、python-telegram-bot、markdown-to-mrkdwn |
| 共用 | langgraph-sdk（channels 的 HTTP 客户端）、pydantic、httpx |

### 3.5 Workspace 配置

`backend/pyproject.toml`（workspace 根）：

```toml
[project]
name = "deer-flow"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = ["deerflow-harness"]

[dependency-groups]
dev = ["pytest>=8.0.0", "ruff>=0.14.11"]
# App 的额外依赖（fastapi 等）也声明在 workspace root，因为 app 不打包
app = ["fastapi", "uvicorn", "sse-starlette", "python-multipart"]
channels = ["lark-oapi", "slack-sdk", "python-telegram-bot"]

[tool.uv.workspace]
members = ["packages/harness"]

[tool.uv.sources]
deerflow-harness = { workspace = true }
```

## 4. 拆分前须解决的跨层依赖

拆分前需消除 `client.py` 中两处从 harness 指向 app 的反向依赖。

### 4.1 `_validate_skill_frontmatter`

```python
# client.py — harness 导入了 app 层代码
from src.gateway.routers.skills import _validate_skill_frontmatter
```

**处理**：将该函数抽到 `deerflow/skills/validation.py`。纯逻辑（解析 YAML frontmatter、校验字段），与 FastAPI 无关。

### 4.2 `CONVERTIBLE_EXTENSIONS` + `convert_file_to_markdown`

```python
# client.py — harness 导入了 app 层代码
from src.gateway.routers.uploads import CONVERTIBLE_EXTENSIONS, convert_file_to_markdown
```

**处理**：抽到 `deerflow/utils/file_conversion.py`。仅依赖 `markitdown` 与 `pathlib`，属通用工具。

## 5. 基础设施变更

### 5.1 LangGraph Server

LangGraph Server 仅需 harness 包。`langgraph.json` 更新示例：

```json
{
  "dependencies": ["./packages/harness"],
  "graphs": {
    "lead_agent": "deerflow.agents:make_lead_agent"
  },
  "checkpointer": {
    "path": "./packages/harness/deerflow/agents/checkpointer/async_provider.py:make_checkpointer"
  }
}
```

### 5.2 Gateway API

```bash
# serve.sh / Makefile
# PYTHONPATH 包含 backend/ 根目录，使 app.* 与 deerflow.* 均可被解析
PYTHONPATH=. uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001
```

### 5.3 Nginx

无需变更（仅 URL 路由，不涉及 Python 模块路径）。

### 5.4 Docker

Dockerfile 中模块引用由 `src.` 改为 `deerflow.` / `app.`，`COPY` 需覆盖 `packages/` 与 `app/`。

## 6. 实施计划

分 3 个 PR 递进：

### PR 1：提取共享工具（低风险）

1. 创建 `src/skills/validation.py`，从 `gateway/routers/skills.py` 抽出 `_validate_skill_frontmatter`  
2. 创建 `src/utils/file_conversion.py`，从 `gateway/routers/uploads.py` 抽出文件转换逻辑  
3. 更新 `client.py`、`gateway/routers/skills.py`、`gateway/routers/uploads.py` 的 import  
4. 跑全量测试确认无回归  

### PR 2：重命名 + 物理拆分（高风险，建议原子提交）

1. 创建 `packages/harness/` 与 `pyproject.toml`  
2. `git mv` 将 harness 相关模块从 `src/` 迁入 `packages/harness/deerflow/`  
3. `git mv` 将 app 相关模块从 `src/` 迁入 `app/`  
4. 全局替换 import：  
   - harness：`src.*` → `deerflow.*`（所有 `.py`、`langgraph.json`、测试、文档）  
   - app：`src.gateway.*` → `app.gateway.*`，`src.channels.*` → `app.channels.*`  
5. 更新 workspace 根 `pyproject.toml`  
6. 更新 `langgraph.json`、`Makefile`、`Dockerfile`  
7. `uv sync` + 全量测试 + 手动验证服务启动  

### PR 3：边界检查 + 文档（低风险）

1. 增加 lint/测试：禁止 harness import app  
2. 更新 `CLAUDE.md`、`README.md`  

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 全局 rename 误替换 | 字符串中的 `src` 被错误改写 | 用正则精确匹配 `\bsrc\.`，仔细 review diff |
| LangGraph 找不到模块 | 服务无法启动 | `langgraph.json` 的 `dependencies` 指向正确 harness 路径 |
| App 缺少 `PYTHONPATH` | Gateway/Channel import 失败 | Makefile/Docker 统一 `PYTHONPATH=.` |
| `config.yaml` 中 `use` 仍为旧路径 | 运行时解析失败 | 同步改为 `deerflow.*` |
| 测试中 `sys.path` 混乱 | 测试失败 | 使用 editable install（`uv sync`），必要时在 `conftest.py` 中加入 `app/` |

## 8. 后续演进

- **独立发布**：harness 可发布到内部 PyPI，其他项目 `pip install deerflow-harness`  
- **插件化 App**：不同 app（web、CLI、bot）可独立存在，共用同一 harness  
- **更细拆分**：若 harness 继续膨胀，可再拆（如 `deerflow-sandbox`、`deerflow-mcp`）  
