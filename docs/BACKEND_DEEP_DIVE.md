# DeerFlow 后端深度解析文档

> 本文档从架构设计、实现逻辑、重难点技术等多个维度，系统性地解读 DeerFlow 2.0 后端实现。
> 适合团队成员快速上手代码、基于此项目进行二次开发。

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构图](#2-整体架构图)
3. [技术栈一览](#3-技术栈一览)
4. [后端目录结构详解](#4-后端目录结构详解)
5. [核心架构：Harness / App 双层分离](#5-核心架构harness--app-双层分离)
6. [Agent 系统深度解析](#6-agent-系统深度解析)
7. [中间件链详解](#7-中间件链详解)
8. [工具系统](#8-工具系统)
9. [多 Agent 协作机制](#9-多-agent-协作机制)
10. [沙箱系统](#10-沙箱系统)
11. [记忆系统](#11-记忆系统)
12. [配置管理](#12-配置管理)
13. [Gateway API](#13-gateway-api)
14. [IM 频道集成](#14-im-频道集成)
15. [重难点技术分析](#15-重难点技术分析)
16. [二次开发指南](#16-二次开发指南)
17. [关键文件速查表](#17-关键文件速查表)

---

## 1. 项目概览

DeerFlow 2.0 是一个基于 **LangGraph + LangChain** 的 **AI Super Agent** 系统，提供：

- **沙箱执行**：安全隔离的代码/命令执行环境
- **持久记忆**：LLM 驱动的长期记忆提取与注入
- **子代理委托**：多 Agent 并发协作
- **可扩展工具**：配置驱动 + MCP + ACP + 社区工具
- **技能系统**：SKILL.md 格式的可插拔 Agent 技能
- **多端接入**：Web UI + 飞书 + Slack + Telegram

---

## 2. 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Nginx (Port 2026)                               │
│                        统一入口 / 反向代理                               │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │  /api/langgraph/*  →  LangGraph Server (2024)                 │    │
│  │  /api/*            →  Gateway API (8001)                      │    │
│  │  /*                →  Frontend (3000)                         │    │
│  └────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
         │                        │                       │
         ▼                        ▼                       ▼
┌──────────────────┐  ┌────────────────────┐  ┌──────────────────┐
│  LangGraph       │  │  Gateway API       │  │  Frontend        │
│  Server          │  │  (FastAPI)         │  │  (Next.js 16)    │
│                  │  │                    │  │                  │
│  • Agent 运行时  │  │  • 模型管理        │  │  • Web UI        │
│  • 线程管理      │  │  • MCP/Skills      │  │  • LangGraph SDK │
│  • 流式执行      │  │  • 记忆管理        │  │  • SSE 实时更新   │
│  • 检查点持久化  │  │  • 文件上传/产物   │  │                  │
│                  │  │  • IM 频道桥接     │  │                  │
└──────────────────┘  └────────────────────┘  └──────────────────┘
         │                        │
         ▼                        ▼
┌──────────────────────────────────────────────────────────┐
│                   deerflow-harness                        │
│              (可发布的 Agent 框架包)                       │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Agents   │ │ Sandbox  │ │ Tools    │ │ Models   │   │
│  │ 主Agent  │ │ 沙箱执行 │ │ 工具系统 │ │ 模型工厂 │   │
│  │ 子Agent  │ │ 虚拟路径 │ │ MCP/ACP  │ │ 多厂商   │   │
│  │ 中间件   │ │ 安全策略 │ │ Skills   │ │ 适配     │   │
│  │ 记忆     │ │          │ │          │ │          │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
└──────────────────────────────────────────────────────────┘
```

### 服务端口与职责

| 服务 | 端口 | 职责 |
|------|------|------|
| **Nginx** | 2026 | 统一入口，反向代理，CORS 处理 |
| **LangGraph Server** | 2024 | Agent 运行时，对话/线程/流式执行/检查点 |
| **Gateway API** | 8001 | 管理面 REST API（模型/MCP/技能/记忆/上传/产物等） |
| **Frontend** | 3000 | Web UI，通过 LangGraph SDK 与后端通信 |
| **Provisioner** | 8002 | （可选）K8s 沙箱 Pod 编排 |

---

## 3. 技术栈一览

### 后端

| 分类 | 技术 |
|------|------|
| **语言** | Python ≥ 3.12 |
| **包管理** | uv（工作区模式） |
| **Agent 框架** | LangGraph + LangChain |
| **HTTP 框架** | FastAPI + Uvicorn |
| **流式传输** | SSE (sse-starlette) |
| **LLM 集成** | langchain-openai, langchain-anthropic, 等 |
| **MCP 集成** | langchain-mcp-adapters |
| **文档转换** | markitdown |
| **搜索工具** | tavily-python, firecrawl-py, duckdb |
| **沙箱** | agent-sandbox, kubernetes (可选) |
| **代码质量** | ruff (lint + format) |
| **测试** | pytest |

### 前端

| 分类 | 技术 |
|------|------|
| **框架** | Next.js 16, React 19 |
| **语言** | TypeScript 5.8 |
| **样式** | Tailwind CSS 4 |
| **包管理** | pnpm |
| **状态** | TanStack Query |
| **UI 组件** | Radix UI |

---

## 4. 后端目录结构详解

```
backend/
├── Makefile                           # 后端专用命令
├── langgraph.json                     # LangGraph Server 配置（图注册、检查点）
├── pyproject.toml                     # 应用层依赖（FastAPI, channel SDK 等）
├── uv.lock                           # 依赖锁文件
├── ruff.toml                         # 代码风格配置
│
├── packages/harness/                  # deerflow-harness 可发布包
│   ├── pyproject.toml                # harness 包依赖
│   └── deerflow/                     # import 前缀: deerflow.*
│       ├── agents/                   # Agent 系统
│       │   ├── lead_agent/           # 主 Agent（工厂 + 提示词）
│       │   │   ├── agent.py          # ★ make_lead_agent 入口
│       │   │   └── prompt.py         # ★ 系统提示词模板
│       │   ├── middlewares/          # 12 个中间件组件
│       │   ├── memory/              # 记忆提取/队列/存储/提示
│       │   ├── checkpointer/        # 检查点持久化（memory/sqlite/postgres）
│       │   ├── thread_state.py      # ★ ThreadState 状态模式
│       │   └── factory.py           # SDK 级 Agent 工厂
│       │
│       ├── sandbox/                  # 沙箱执行系统
│       │   ├── sandbox.py           # 抽象 Sandbox 接口
│       │   ├── sandbox_provider.py  # Provider 模式（acquire/get/release）
│       │   ├── local/               # 本地文件系统 Provider
│       │   ├── tools.py             # bash/ls/read/write/str_replace 工具
│       │   ├── middleware.py        # 沙箱生命周期中间件
│       │   └── security.py          # 安全策略
│       │
│       ├── subagents/               # 子代理系统
│       │   ├── executor.py          # 后台执行引擎（双线程池）
│       │   ├── registry.py          # Agent 注册表
│       │   ├── config.py            # 子代理配置
│       │   └── builtins/            # 内置子代理（general-purpose, bash）
│       │
│       ├── tools/                   # 工具系统
│       │   ├── tools.py             # ★ get_available_tools 汇总入口
│       │   └── builtins/            # 内置工具
│       │       ├── present_file.py  # 文件展示
│       │       ├── clarification.py # 澄清询问
│       │       ├── task_tool.py     # ★ 子代理委托工具
│       │       ├── view_image.py    # 图像查看
│       │       ├── tool_search.py   # 工具搜索（延迟注册）
│       │       └── invoke_acp_agent_tool.py  # ACP Agent 调用
│       │
│       ├── mcp/                     # MCP 协议集成
│       │   ├── client.py            # 多服务器 MCP 客户端
│       │   ├── cache.py             # 工具缓存（mtime 失效）
│       │   ├── oauth.py             # OAuth 令牌管理
│       │   └── tools.py             # MCP 工具加载
│       │
│       ├── models/                  # 模型工厂
│       │   ├── factory.py           # ★ create_chat_model
│       │   ├── credential_loader.py # 凭证加载
│       │   ├── patched_openai.py    # OpenAI 适配补丁
│       │   ├── patched_deepseek.py  # DeepSeek 适配补丁
│       │   └── patched_minimax.py   # MiniMax 适配补丁
│       │
│       ├── skills/                  # 技能系统
│       │   ├── loader.py            # 技能发现与加载
│       │   ├── parser.py            # SKILL.md 解析
│       │   ├── installer.py         # .skill 包安装
│       │   └── validation.py        # 技能校验
│       │
│       ├── config/                  # 配置系统
│       │   ├── app_config.py        # ★ AppConfig 主配置（带热重载）
│       │   ├── extensions_config.py # MCP/Skills 扩展配置
│       │   ├── model_config.py      # 模型配置
│       │   ├── sandbox_config.py    # 沙箱配置
│       │   └── ...                  # 更多子配置
│       │
│       ├── runtime/                 # 运行时基础设施
│       │   ├── stream_bridge/       # 流式事件桥接
│       │   ├── store/               # 线程/状态存储
│       │   ├── runs/                # 运行管理
│       │   └── serialization.py     # 序列化
│       │
│       ├── community/              # 社区工具
│       │   ├── tavily/             # 网页搜索/抓取
│       │   ├── jina_ai/            # Jina Reader
│       │   ├── firecrawl/          # Firecrawl 爬取
│       │   ├── image_search/       # 图片搜索
│       │   └── aio_sandbox/        # Docker 沙箱
│       │
│       ├── reflection/             # 反射/动态加载
│       ├── uploads/                # 上传管理
│       ├── guardrails/             # 安全护栏
│       ├── utils/                  # 工具函数
│       └── client.py               # ★ DeerFlowClient 嵌入式客户端
│
├── app/                            # 应用层（import 前缀: app.*）
│   ├── gateway/                    # FastAPI 网关
│   │   ├── app.py                  # ★ FastAPI 应用入口
│   │   ├── deps.py                 # 依赖注入（运行时单例）
│   │   ├── config.py               # 网关配置
│   │   ├── services.py             # 业务服务层
│   │   ├── path_utils.py           # 路径工具
│   │   └── routers/                # 路由模块
│   │       ├── models.py           # /api/models
│   │       ├── mcp.py              # /api/mcp
│   │       ├── memory.py           # /api/memory
│   │       ├── skills.py           # /api/skills
│   │       ├── uploads.py          # /api/threads/{id}/uploads
│   │       ├── threads.py          # /api/threads
│   │       ├── artifacts.py        # /api/threads/{id}/artifacts
│   │       ├── suggestions.py      # /api/threads/{id}/suggestions
│   │       ├── agents.py           # /api/agents (自定义 Agent CRUD)
│   │       ├── channels.py         # /api/channels
│   │       ├── runs.py             # /api/runs
│   │       └── thread_runs.py      # /api/threads/{id}/runs
│   │
│   └── channels/                   # IM 平台桥接
│       ├── base.py                 # Channel 抽象基类
│       ├── message_bus.py          # 异步消息总线
│       ├── manager.py              # 核心调度器
│       ├── store.py                # chat→thread 映射持久化
│       ├── service.py              # 生命周期管理
│       ├── feishu.py               # 飞书
│       ├── slack.py                # Slack
│       └── telegram.py             # Telegram
│
├── tests/                          # 测试套件（~90+ test files）
│   ├── conftest.py                 # 测试 fixtures
│   ├── test_harness_boundary.py    # ★ harness→app 导入防火墙
│   ├── test_client.py              # 嵌入式客户端 77 个单元测试
│   └── ...
│
└── docs/                           # 文档
    ├── ARCHITECTURE.md
    ├── API.md
    ├── CONFIGURATION.md
    └── ...
```

---

## 5. 核心架构：Harness / App 双层分离

这是理解后端最重要的架构决策。

### 设计意图

```
┌──────────────────────────────────────┐
│            App 层 (app.*)            │
│  FastAPI Gateway + IM Channels       │
│  ← 不可发布，应用特定逻辑            │
│  ← 可以 import deerflow.*           │
└──────────────┬───────────────────────┘
               │ 单向依赖 ↓
┌──────────────┴───────────────────────┐
│        Harness 层 (deerflow.*)       │
│  Agent 编排 + 工具 + 沙箱 + 模型     │
│  ← 可独立发布为 deerflow-harness     │
│  ← 禁止 import app.*                │
└──────────────────────────────────────┘
```

### 为什么这样设计？

1. **可发布性**：`deerflow-harness` 可以作为独立 Python 包发布到 PyPI，其他项目可以 `pip install deerflow-harness` 直接使用
2. **关注点分离**：Agent 核心逻辑与 HTTP/IM 传输层解耦
3. **嵌入式使用**：通过 `DeerFlowClient` 可以不启动任何 HTTP 服务，直接在 Python 进程中使用全部能力
4. **强制边界**：`test_harness_boundary.py` 在 CI 中自动检测违反依赖方向的 import

### 正确的导入方式

```python
# ✅ App → Harness（允许）
from deerflow.config import get_app_config
from deerflow.agents import make_lead_agent
from deerflow.models import create_chat_model

# ✅ Harness 内部互引
from deerflow.tools import get_available_tools

# ❌ Harness → App（CI 会拦截）
# from app.gateway.routers.uploads import ...  ← 禁止！
```

---

## 6. Agent 系统深度解析

### 6.1 编排模型

DeerFlow **没有手写 LangGraph 多节点 DAG 图**。编排模型为：

```
单主 ReAct Agent + 有序中间件链 + 可选子 Agent 委托
```

这意味着流程控制编码在三个层面：
1. **`create_agent`**：LangChain 提供的 ReAct Agent 构造器，产生 LangGraph `CompiledStateGraph`
2. **中间件链**：12 个有序 `AgentMiddleware`，拦截/增强 Agent 的输入输出
3. **工具行为**：如 `task` 工具触发子 Agent，`ask_clarification` 工具中断对话

### 6.2 Lead Agent 构建流程

```python
# backend/packages/harness/deerflow/agents/lead_agent/agent.py

def make_lead_agent(config: RunnableConfig):
    # 1. 解析运行时参数
    thinking_enabled = cfg.get("thinking_enabled", True)
    model_name = cfg.get("model_name")
    subagent_enabled = cfg.get("subagent_enabled", False)
    ...

    # 2. 解析模型（支持 per-agent 配置覆盖）
    model_name = requested_model_name or agent_model_name

    # 3. 构建中间件链
    middlewares = _build_middlewares(config, model_name, agent_name)

    # 4. 加载工具集
    tools = get_available_tools(model_name=model_name, ...)

    # 5. 生成系统提示词
    system_prompt = apply_prompt_template(
        subagent_enabled=subagent_enabled,
        agent_name=agent_name,
        ...
    )

    # 6. 创建 Agent（返回 CompiledStateGraph）
    return create_agent(
        model=create_chat_model(name=model_name, thinking_enabled=thinking_enabled),
        tools=tools,
        middleware=middlewares,
        system_prompt=system_prompt,
        state_schema=ThreadState,
    )
```

### 6.3 LangGraph 注册

```json
// backend/langgraph.json
{
  "graphs": {
    "lead_agent": "deerflow.agents:make_lead_agent"
  },
  "checkpointer": {
    "path": "./packages/harness/deerflow/agents/checkpointer/async_provider.py:make_checkpointer"
  }
}
```

LangGraph Server 启动时调用 `make_lead_agent` 工厂函数创建图，每次对话请求通过此图执行。

### 6.4 ThreadState（线程状态）

```python
# backend/packages/harness/deerflow/agents/thread_state.py

class ThreadState(AgentState):
    sandbox: NotRequired[SandboxState | None]
    thread_data: NotRequired[ThreadDataState | None]
    title: NotRequired[str | None]
    artifacts: Annotated[list[str], merge_artifacts]       # 去重合并
    todos: NotRequired[list | None]
    uploaded_files: NotRequired[list[dict] | None]
    viewed_images: Annotated[dict[str, ViewedImageData], merge_viewed_images]
```

自定义 reducer：
- `merge_artifacts`：合并并去重 artifact 路径
- `merge_viewed_images`：合并图像数据，空 dict 表示清空

---

## 7. 中间件链详解

中间件是 DeerFlow 后端最核心的设计模式。它们以严格顺序执行，每个中间件可以拦截 Agent 的输入（`before_model`）和输出（`after_model`）。

### 执行顺序（从上到下）

```
请求进入
    ↓
[1] ThreadDataMiddleware     ── 创建线程隔离目录
    ↓
[2] UploadsMiddleware        ── 注入新上传文件信息
    ↓
[3] SandboxMiddleware        ── 获取沙箱实例
    ↓
[4] DanglingToolCallMiddleware ── 修复中断产生的悬空工具调用
    ↓
[5] GuardrailMiddleware      ── 工具调用授权检查（可选）
    ↓
[6] SummarizationMiddleware  ── 上下文压缩（可选）
    ↓
[7] TodoListMiddleware       ── 任务追踪（Plan 模式，可选）
    ↓
[8] TokenUsageMiddleware     ── Token 用量追踪（可选）
    ↓
[9] TitleMiddleware          ── 自动生成线程标题
    ↓
[10] MemoryMiddleware        ── 异步记忆更新排队
    ↓
[11] ViewImageMiddleware     ── 注入 base64 图像（Vision 模型）
    ↓
[12] DeferredToolFilterMiddleware ── 隐藏延迟注册的工具（可选）
    ↓
[13] SubagentLimitMiddleware ── 截断过多子代理调用（可选）
    ↓
[14] LoopDetectionMiddleware ── 检测并打断重复工具调用循环
    ↓
[15] ClarificationMiddleware ── 拦截澄清请求，中断对话（必须最后）
    ↓
LLM 模型调用
```

### 中间件详细说明

| # | 中间件 | 触发时机 | 核心逻辑 |
|---|--------|----------|----------|
| 1 | **ThreadData** | 每次请求 | 在 `backend/.deer-flow/threads/{thread_id}/` 下创建 `user-data/{workspace,uploads,outputs}` 目录 |
| 2 | **Uploads** | 有新文件上传时 | 扫描 uploads 目录，将新增文件以 HumanMessage 注入对话 |
| 3 | **Sandbox** | 每次请求 | 通过 `SandboxProvider.acquire()` 获取沙箱实例，将 `sandbox_id` 写入状态 |
| 4 | **DanglingToolCall** | 历史消息存在无响应的 tool_call | 插入占位 ToolMessage 避免模型困惑 |
| 5 | **Guardrail** | 工具调用前 | 根据配置的 `GuardrailProvider` 决定是否允许工具调用，被拒绝则返回错误 ToolMessage |
| 6 | **Summarization** | Token 超限时 | 保留最近消息，将旧消息用 LLM 压缩为摘要 |
| 7 | **TodoList** | Plan 模式 | 注入 `write_todos` 工具和系统提示，实现任务追踪 |
| 8 | **TokenUsage** | 配置启用时 | 追踪 Token 使用情况 |
| 9 | **Title** | 首次完整对话后 | 用 LLM 自动生成 ≤5 词的线程标题 |
| 10 | **Memory** | 每次对话 | 过滤用户消息 + 最终 AI 回复，排入防抖队列异步更新记忆 |
| 11 | **ViewImage** | Vision 模型 | 将状态中的图像引用转为 base64 注入消息 |
| 12 | **DeferredToolFilter** | tool_search 启用时 | 对模型隐藏未被主动搜索到的延迟注册工具 |
| 13 | **SubagentLimit** | 子代理启用时 | 在 `after_model` 中截断超过 `MAX_CONCURRENT_SUBAGENTS` (默认 3) 的 `task` 调用 |
| 14 | **LoopDetection** | 每次模型输出后 | 检测重复的工具调用模式并打断循环 |
| 15 | **Clarification** | 模型调用 `ask_clarification` | 拦截后发出 `Command(goto=END)` 中断图执行，等待用户回复 |

---

## 8. 工具系统

### 8.1 工具加载流程

```
config.yaml 声明的工具（resolve_variable 动态加载）
    +
内置工具（present_file, ask_clarification）
    +
视觉工具（view_image，仅 Vision 模型）
    +
子代理工具（task，仅启用时）
    +
MCP 工具（从 extensions_config.json 加载，带 mtime 缓存）
    +
ACP 工具（外部 Agent 调用）
    ↓
get_available_tools() 汇总返回
```

### 8.2 工具分类

| 类别 | 工具 | 说明 |
|------|------|------|
| **沙箱工具** | bash, ls, read_file, write_file, str_replace | 在沙箱环境中执行命令和文件操作 |
| **内置工具** | present_file | 将输出文件（仅 `/mnt/user-data/outputs`）展示给用户 |
| | ask_clarification | 向用户请求澄清（触发对话中断） |
| | view_image | 读取图像为 base64（仅 Vision 模型） |
| | task | 委托任务给子代理 |
| | tool_search | 延迟注册的工具搜索 |
| **社区工具** | tavily (search/fetch) | 网页搜索/抓取 |
| | jina_ai | Jina Reader API |
| | firecrawl | Firecrawl 爬取 |
| | image_search | DuckDuckGo 图片搜索 |
| **MCP 工具** | 动态加载 | 通过 MCP 协议连接的外部工具 |
| **ACP 工具** | invoke_acp_agent | 调用外部 ACP 兼容 Agent |

### 8.3 反射机制

工具通过 `resolve_variable(path, BaseTool)` 动态加载：

```python
# config.yaml
tools:
  - use: "deerflow.sandbox.tools:bash_tool"
    group: "bash"
  - use: "deerflow.community.tavily:web_search_tool"
    group: "search"

# 运行时解析
tool = resolve_variable("deerflow.sandbox.tools:bash_tool", BaseTool)
# 等价于: from deerflow.sandbox.tools import bash_tool
```

---

## 9. 多 Agent 协作机制

### 9.1 架构概览

```
用户消息
    ↓
Lead Agent（主 Agent）
    │
    ├── 直接回答简单问题
    │
    └── 调用 task() 工具委托复杂任务
         ↓
    ┌────────────────────────────────┐
    │  SubagentExecutor              │
    │                                │
    │  1. 创建子 Agent（create_agent）│
    │  2. 在后台线程执行             │
    │  3. 流式收集结果               │
    └────────────────────────────────┘
         ↓
    轮询结果 → SSE 事件 → 返回主 Agent
```

### 9.2 执行流程

1. **主 Agent 决策**：LLM 判断需要委托，调用 `task(description, prompt, subagent_type)`
2. **工具执行**：`task_tool.py` 创建 `SubagentExecutor` 实例
3. **子 Agent 构建**：`SubagentExecutor._create_agent()` 调用 `create_agent`，工具列表排除 `task`（禁止嵌套）
4. **后台执行**：提交到 `_execution_pool`（3 workers），在独立线程中 `astream()` 执行
5. **轮询与事件**：主协程每 5 秒轮询一次，通过 `get_stream_writer()` 发送 SSE 事件
6. **结果回传**：子 Agent 的 AI 消息作为 `SubagentResult` 返回主 Agent

### 9.3 并发控制

```
SubagentLimitMiddleware
    ↓
在 after_model 中检查模型一次产出的 task 调用数量
    ↓
超过 MAX_CONCURRENT_SUBAGENTS (默认 3) 则截断多余的调用
    ↓
15 分钟执行超时
```

### 9.4 内置子代理

| 名称 | 用途 |
|------|------|
| `general-purpose` | 通用子代理，拥有除 `task` 外的所有工具 |
| `bash` | 命令行专家（仅在允许 host bash 时可见） |

---

## 10. 沙箱系统

### 10.1 设计模式

采用 **Provider 模式** 管理沙箱生命周期：

```python
class SandboxProvider:
    async def acquire(thread_id) -> str     # 获取沙箱 ID
    async def get(sandbox_id) -> Sandbox    # 获取沙箱实例
    async def release(sandbox_id)           # 释放沙箱
```

### 10.2 虚拟路径系统

Agent 看到的是虚拟路径，后端自动翻译为物理路径：

| Agent 看到 | 物理位置 |
|-----------|---------|
| `/mnt/user-data/workspace` | `backend/.deer-flow/threads/{thread_id}/user-data/workspace` |
| `/mnt/user-data/uploads` | `backend/.deer-flow/threads/{thread_id}/user-data/uploads` |
| `/mnt/user-data/outputs` | `backend/.deer-flow/threads/{thread_id}/user-data/outputs` |
| `/mnt/skills` | `deer-flow/skills/` |
| `/mnt/acp-workspace` | `backend/.deer-flow/threads/{thread_id}/acp-workspace/` |

通过 `replace_virtual_path()` 和 `replace_virtual_paths_in_command()` 完成翻译。

### 10.3 沙箱实现

| 实现 | 说明 |
|------|------|
| **LocalSandboxProvider** | 默认实现，单例模式，在本机文件系统执行 |
| **AioSandboxProvider** | Docker 容器隔离（在 `community/aio_sandbox` 中） |
| **Provisioner** | K8s Pod 级别隔离（需 Docker 部署） |

---

## 11. 记忆系统

### 11.1 工作流

```
用户对话
    ↓
MemoryMiddleware.after_model()
    ↓ 过滤出用户消息 + 最终 AI 回复
    ↓
MemoryQueue.enqueue()
    ↓ 防抖 30 秒，按线程去重
    ↓
后台线程执行
    ↓
MemoryUpdater.update()
    ↓ LLM 提取上下文更新和事实
    ↓
原子写入 memory.json
    ↓ 临时文件 + rename，缓存失效
    ↓
下次对话
    ↓
系统提示词注入 <memory> 标签
    ↓ 最多 15 条事实 + 上下文摘要
    ↓ 受 max_injection_tokens (默认 2000) 限制
```

### 11.2 数据结构

```json
// backend/.deer-flow/memory.json
{
  "userContext": {
    "workContext": "...",
    "personalContext": "...",
    "topOfMind": "..."
  },
  "history": {
    "recentMonths": "...",
    "earlierContext": "...",
    "longTermBackground": "..."
  },
  "facts": [
    {
      "id": "uuid",
      "content": "用户偏好使用 Python",
      "category": "preference",
      "confidence": 0.95,
      "createdAt": "2024-01-01T00:00:00Z",
      "source": "conversation"
    }
  ]
}
```

### 11.3 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `memory.enabled` | false | 总开关 |
| `memory.injection_enabled` | true | 是否注入系统提示 |
| `memory.debounce_seconds` | 30 | 防抖等待时间 |
| `memory.max_facts` | 100 | 最大事实数 |
| `memory.fact_confidence_threshold` | 0.7 | 事实置信度阈值 |
| `memory.max_injection_tokens` | 2000 | 注入 Token 上限 |

---

## 12. 配置管理

### 12.1 配置文件体系

```
deer-flow/
├── config.yaml                  # 主配置（从 config.example.yaml 复制）
├── extensions_config.json       # MCP + Skills 扩展配置
├── .env                         # API Keys 等环境变量
└── backend/langgraph.json       # LangGraph Server 配置
```

### 12.2 配置优先级

**config.yaml**：
1. 显式 `config_path` 参数
2. `DEER_FLOW_CONFIG_PATH` 环境变量
3. 当前目录的 `config.yaml`（backend/）
4. 父目录的 `config.yaml`（项目根目录，推荐）

### 12.3 热重载机制

`get_app_config()` 实现了基于 mtime 的缓存自动刷新：

```python
# 伪代码
def get_app_config():
    if config_path 变化 or 文件 mtime 增大:
        重新加载并解析 config.yaml
        刷新缓存
    return 缓存的 AppConfig
```

### 12.4 环境变量展开

配置值以 `$` 开头时自动解析为环境变量：

```yaml
models:
  - name: "gpt-4o"
    use: "langchain_openai:ChatOpenAI"
    api_key: "$OPENAI_API_KEY"    # 自动读取 os.environ["OPENAI_API_KEY"]
```

---

## 13. Gateway API

### 13.1 路由总览

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/models` | GET | 列出所有可用模型 |
| `/api/models/{name}` | GET | 获取指定模型详情 |
| `/api/mcp/config` | GET/PUT | 获取/更新 MCP 配置 |
| `/api/skills` | GET | 列出所有技能 |
| `/api/skills/{name}` | GET/PUT | 获取/更新技能状态 |
| `/api/skills/install` | POST | 安装 .skill 技能包 |
| `/api/memory` | GET | 获取记忆数据 |
| `/api/memory/reload` | POST | 强制重载记忆 |
| `/api/memory/config` | GET | 获取记忆配置 |
| `/api/memory/status` | GET | 获取记忆状态（配置 + 数据） |
| `/api/threads/{id}/uploads` | POST/GET/DELETE | 文件上传/列表/删除 |
| `/api/threads/{id}` | DELETE | 删除线程本地数据 |
| `/api/threads/{id}/artifacts/{path}` | GET | 获取产物文件 |
| `/api/threads/{id}/suggestions` | POST | 生成后续问题建议 |
| `/api/agents` | CRUD | 自定义 Agent 管理 |
| `/api/channels` | GET | 频道状态 |
| `/api/runs/stream` | POST | 无线程的 stateless 流式运行 |
| `/api/threads/{id}/runs` | POST/GET | 运行管理 |
| `/health` | GET | 健康检查 |

### 13.2 运行时依赖注入

```python
# backend/app/gateway/deps.py

@asynccontextmanager
async def langgraph_runtime(app: FastAPI):
    async with AsyncExitStack() as stack:
        app.state.stream_bridge = await stack.enter_async_context(make_stream_bridge())
        app.state.checkpointer = await stack.enter_async_context(make_checkpointer())
        app.state.store = await stack.enter_async_context(make_store())
        app.state.run_manager = RunManager()
        yield
```

Gateway 启动时初始化四大运行时组件：
- **StreamBridge**：流式事件桥接
- **Checkpointer**：状态检查点（memory/sqlite/postgres）
- **Store**：线程/状态存储
- **RunManager**：运行管理

---

## 14. IM 频道集成

### 14.1 消息流

```
外部平台 (飞书/Slack/Telegram)
    ↓
Channel 实现（webhook/event）
    ↓
MessageBus.publish_inbound()
    ↓
ChannelManager._dispatch_loop()
    ↓ 查找/创建 LangGraph 线程
    ↓
├── 飞书: runs.stream() → 累积文本 → 增量更新飞书卡片
├── Slack: runs.wait() → 最终回复
└── Telegram: runs.wait() → 最终回复
    ↓
channel callbacks → 平台回复
```

### 14.2 关键设计

- **线程映射**：`store.py` 用 JSON 文件持久化 `channel:chat[:topic]` → `thread_id`
- **飞书特殊处理**：创建一个"运行中"的卡片，然后增量 patch 同一张卡片（`config.update_multi=true`）
- **命令系统**：支持 `/new`、`/status`、`/models`、`/memory`、`/help` 等快捷命令

---

## 15. 重难点技术分析

### 15.1 难点一：中间件链的有序组合

**问题**：12+ 个中间件必须按严格顺序执行，顺序错误会导致功能异常。

**解决方案**：
- 在代码中用详细注释标注每个中间件的位置约束
- `ClarificationMiddleware` 必须是最后一个（因为它会中断图执行）
- `ThreadDataMiddleware` 必须在 `SandboxMiddleware` 之前（沙箱需要 thread_id）
- `MemoryMiddleware` 在 `TitleMiddleware` 之后（标题生成后再记忆）

**二次开发建议**：新增中间件时，先明确它与哪些中间件有顺序依赖，然后在 `_build_middlewares` 中精确插入。

### 15.2 难点二：子 Agent 并发执行模型

**问题**：主 Agent 需要并发委托多个子 Agent，同时保持流式响应。

**解决方案**：
- 双线程池：`_scheduler_pool` (3 workers) 调度 + `_execution_pool` (3 workers) 执行
- 主协程 **每 5 秒轮询** `get_background_task_result`
- 通过 `get_stream_writer()` 发送自定义 SSE 事件（`task_started`/`task_running`/`task_completed`）
- `SubagentLimitMiddleware` 在模型输出层截断过多的并发请求
- 15 分钟执行超时保护

**二次开发建议**：如需新增子代理类型，在 `subagents/builtins/` 下创建配置，注册到 `registry.py`。

### 15.3 难点三：虚拟路径翻译系统

**问题**：Agent 在不同沙箱模式（本地/Docker/K8s）下需要统一的文件路径视图。

**解决方案**：
- Agent 始终看到虚拟路径（如 `/mnt/user-data/workspace`）
- `replace_virtual_path()` 在命令执行前将虚拟路径翻译为物理路径
- 本地模式直接映射到文件系统；Docker 模式通过 volume mount；K8s 通过 Provisioner

**二次开发建议**：添加新的虚拟路径映射时，需同步修改 `tools.py` 中的路径翻译规则和沙箱 Provider 的 mount 配置。

### 15.4 难点四：MCP 工具热更新

**问题**：Gateway 进程更新了 `extensions_config.json`，LangGraph Server 进程需要感知变化。

**解决方案**：
- Gateway 写入磁盘的 `extensions_config.json`
- `get_cached_mcp_tools()` 基于文件 **mtime** 检测变化
- 变化时重新初始化 `MultiServerMCPClient` 连接
- LangGraph 侧在 `get_available_tools()` 中用 `ExtensionsConfig.from_file()` 每次从磁盘读最新配置

### 15.5 难点五：记忆系统的防抖与原子更新

**问题**：高频对话场景下，记忆更新不能阻塞主对话，且不能丢失数据。

**解决方案**：
- **防抖队列**：30 秒（可配置）等待窗口，按线程去重
- **后台线程**：异步执行 LLM 记忆提取，不阻塞主对话
- **原子写入**：先写临时文件，再 `os.rename()`，避免写入中断导致数据损坏
- **事实去重**：trim 后比较，避免重复事实

### 15.6 难点六：配置热重载

**问题**：修改 `config.yaml` 后不想重启服务。

**解决方案**：
- `get_app_config()` 缓存解析结果
- 每次调用检查文件 mtime，增大则重新加载
- 支持 `config_version` 字段做版本兼容性检查
- 运行时通过 Gateway API 修改扩展配置立即生效

### 15.7 难点七：对话中断与恢复（Clarification）

**问题**：Agent 需要向用户请求澄清，但这需要中断 LangGraph 图执行。

**解决方案**：
- Agent 调用 `ask_clarification` 工具
- `ClarificationMiddleware`（必须是最后一个中间件）拦截此工具调用
- 发出 `Command(goto=END)` 中断图执行
- LangGraph 保存检查点
- 用户回复后，从检查点恢复执行

---

## 16. 二次开发指南

### 16.1 添加新工具

1. 在 `backend/packages/harness/deerflow/tools/builtins/` 或 `community/` 下创建工具
2. 在 `config.yaml` 的 `tools` 数组中声明
3. 或直接在 `get_available_tools()` 中加入内置工具列表

```python
# 示例：创建自定义工具
from langchain.tools import BaseTool

class MyTool(BaseTool):
    name = "my_tool"
    description = "描述这个工具的功能"

    def _run(self, query: str) -> str:
        return "工具执行结果"
```

### 16.2 添加新中间件

1. 在 `backend/packages/harness/deerflow/agents/middlewares/` 下创建
2. 实现 `AgentMiddleware` 接口
3. 在 `agent.py` 的 `_build_middlewares()` 中按正确顺序插入

### 16.3 添加新的 API 路由

1. 在 `backend/app/gateway/routers/` 下创建路由模块
2. 在 `app.py` 的 `create_app()` 中 `include_router`

### 16.4 添加新的子代理类型

1. 在 `backend/packages/harness/deerflow/subagents/builtins/` 下创建配置
2. 注册到 `registry.py` 的 `BUILTIN_SUBAGENTS`

### 16.5 添加新的 IM 频道

1. 在 `backend/app/channels/` 下实现 `Channel` 基类
2. 在 `service.py` 中注册
3. 在 `config.yaml` 的 `channels` 中添加配置

### 16.6 运行与调试

```bash
# 启动全部服务（推荐）
make dev

# 仅启动后端
cd backend
make dev      # LangGraph Server (2024)
make gateway  # Gateway API (8001)

# 运行测试
cd backend
make test

# 代码检查
cd backend
make lint
make format
```

---

## 17. 关键文件速查表

| 功能 | 文件路径 |
|------|---------|
| **Agent 入口** | `packages/harness/deerflow/agents/lead_agent/agent.py` → `make_lead_agent()` |
| **系统提示词** | `packages/harness/deerflow/agents/lead_agent/prompt.py` → `apply_prompt_template()` |
| **线程状态** | `packages/harness/deerflow/agents/thread_state.py` → `ThreadState` |
| **工具汇总** | `packages/harness/deerflow/tools/tools.py` → `get_available_tools()` |
| **子代理执行** | `packages/harness/deerflow/subagents/executor.py` → `SubagentExecutor` |
| **模型工厂** | `packages/harness/deerflow/models/factory.py` → `create_chat_model()` |
| **主配置** | `packages/harness/deerflow/config/app_config.py` → `AppConfig` / `get_app_config()` |
| **扩展配置** | `packages/harness/deerflow/config/extensions_config.py` → `ExtensionsConfig` |
| **沙箱工具** | `packages/harness/deerflow/sandbox/tools.py` |
| **MCP 缓存** | `packages/harness/deerflow/mcp/cache.py` → `get_cached_mcp_tools()` |
| **记忆更新** | `packages/harness/deerflow/agents/memory/updater.py` → `MemoryUpdater` |
| **记忆队列** | `packages/harness/deerflow/agents/memory/queue.py` |
| **Gateway 入口** | `app/gateway/app.py` → `create_app()` |
| **Gateway 依赖注入** | `app/gateway/deps.py` → `langgraph_runtime()` |
| **嵌入式客户端** | `packages/harness/deerflow/client.py` → `DeerFlowClient` |
| **反射加载** | `packages/harness/deerflow/reflection/resolvers.py` → `resolve_variable()` |
| **LangGraph 注册** | `backend/langgraph.json` |
| **飞书频道** | `app/channels/feishu.py` |
| **导入防火墙** | `tests/test_harness_boundary.py` |

---

## 附录 A：请求生命周期全链路

```
1. 用户在 Web UI 发送消息
2. Frontend 通过 LangGraph SDK 调用 /api/langgraph/threads/{id}/runs/stream
3. Nginx 将请求代理到 LangGraph Server (2024)
4. LangGraph Server 从 langgraph.json 找到 lead_agent 图
5. 调用 make_lead_agent(config) 构建 Agent（含中间件链 + 工具 + 提示词）
6. 中间件按顺序执行 before_model：
   - ThreadDataMiddleware：确保线程目录存在
   - UploadsMiddleware：检查新上传文件
   - SandboxMiddleware：获取沙箱
   - ...
7. 模型调用：LLM 生成回复/工具调用
8. 中间件按顺序执行 after_model：
   - TitleMiddleware：首次对话后生成标题
   - MemoryMiddleware：排队记忆更新
   - SubagentLimitMiddleware：截断过多子代理调用
   - ClarificationMiddleware：拦截澄清请求
9. 如果 LLM 决定调用工具：
   a. 沙箱工具 → 在隔离环境执行命令
   b. task 工具 → 启动子 Agent 异步执行
   c. ask_clarification → 中断对话等待用户回复
10. 工具结果返回，循环回到步骤 7
11. LLM 生成最终文本回复
12. 通过 SSE 流式推送给 Frontend
13. Frontend 更新 UI
14. 后台异步：MemoryQueue 防抖后触发记忆更新
```

---

## 附录 B：数据持久化路径

```
backend/.deer-flow/
├── threads/
│   └── {thread_id}/
│       ├── user-data/
│       │   ├── workspace/    # 工作区文件
│       │   ├── uploads/      # 用户上传文件
│       │   └── outputs/      # Agent 输出文件
│       └── acp-workspace/    # ACP Agent 工作目录
├── memory.json               # 长期记忆存储
└── channels/
    └── store.json            # IM chat→thread 映射
```

---

## 附录 C：上下文管理机制深度解析

DeerFlow 的上下文管理是一个**多层协同**的体系，分为 5 个层次协作完成。

### C.1 上下文管理全景架构图

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        上下文管理全景                                      │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─── 第1层：对话消息上下文（短期）────────────────────────────────────┐   │
│  │  ThreadState.messages                                               │   │
│  │  • 当前对话的完整消息列表（Human + AI + Tool Messages）              │   │
│  │  • 由 LangGraph AgentState 基类管理                                 │   │
│  │  • 每个 thread 独立维护                                             │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│         ↓ 消息过多时                                                      │
│  ┌─── 第2层：上下文压缩（SummarizationMiddleware）──────────────────┐   │
│  │  • 监控 messages 的 Token/消息数/模型窗口占比                      │   │
│  │  • 触发条件满足时，用 LLM 将旧消息压缩为摘要                       │   │
│  │  • 保留最近 N 条消息 + 摘要，替换原始 messages                     │   │
│  │  • 配置: config.yaml → summarization                               │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│         ↓ 持久化                                                          │
│  ┌─── 第3层：检查点持久化（Checkpointer）───────────────────────────┐   │
│  │  • 每次图执行步骤后保存完整 ThreadState 快照                       │   │
│  │  • 包含 messages + sandbox + title + artifacts + todos 等           │   │
│  │  • 支持: InMemory / SQLite / PostgreSQL                            │   │
│  │  • 按 thread_id 分区存储                                           │   │
│  │  • 支持对话中断后从检查点恢复                                       │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│         ↓ 筛选后异步提取                                                  │
│  ┌─── 第4层：长期记忆（Memory System）──────────────────────────────┐   │
│  │  MemoryMiddleware → MemoryQueue → MemoryUpdater                    │   │
│  │  • 过滤出用户消息 + 最终 AI 回复（排除工具调用）                    │   │
│  │  • 30秒防抖 + 按线程去重                                           │   │
│  │  • LLM 提取: 用户上下文 + 历史摘要 + 离散事实                      │   │
│  │  • 原子写入 memory.json                                            │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│         ↓ 注入系统提示                                                    │
│  ┌─── 第5层：上下文注入（System Prompt Injection）──────────────────┐   │
│  │  apply_prompt_template() → <memory>...</memory>                    │   │
│  │  • 读取 memory.json 中的上下文摘要和事实                           │   │
│  │  • 按置信度排序，受 max_injection_tokens (2000) 限制                │   │
│  │  • 注入系统提示词的 <memory> 标签中                                │   │
│  │  • 同时注入: Soul、Skills、Subagent 说明、当前日期等               │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### C.2 第1层：对话消息上下文

对话消息是最基础的上下文载体。

**数据结构**：`ThreadState` 继承自 `AgentState`，核心字段 `messages` 是一个有序消息列表：

```python
# 消息类型
HumanMessage    # 用户消息
AIMessage       # AI 回复（含 tool_calls 的中间步骤 + 纯文本最终回复）
ToolMessage     # 工具执行结果
```

**上下文增强**：`UploadsMiddleware` 在 `before_agent` 中将上传文件信息以 `<uploaded_files>` 标签注入最后一条 `HumanMessage`：

```python
# UploadsMiddleware 注入的内容格式
"""
<uploaded_files>
The following files were uploaded in this message:

- report.pdf (125.3 KB)
  Path: /mnt/user-data/uploads/report.pdf

The following files were uploaded in previous messages and are still available:

- data.csv (45.2 KB)
  Path: /mnt/user-data/uploads/data.csv

You can read these files using the `read_file` tool with the paths shown above.
</uploaded_files>

用户的原始问题...
"""
```

### C.3 第2层：上下文压缩（SummarizationMiddleware）

当对话变长、Token 接近模型上下文窗口时，DeerFlow 通过 LangChain 的 `SummarizationMiddleware` 自动压缩历史。

**触发条件**（三选一，OR 逻辑）：

| 类型 | 配置键 | 示例 | 含义 |
|------|--------|------|------|
| `tokens` | `type: tokens, value: 40000` | 消息总 Token ≥ 40000 时触发 |
| `messages` | `type: messages, value: 50` | 消息数量 ≥ 50 时触发 |
| `fraction` | `type: fraction, value: 0.8` | 占模型最大输入的 80% 时触发 |

**保留策略**（keep）：

| 类型 | 配置键 | 示例 | 含义 |
|------|--------|------|------|
| `messages` | `type: messages, value: 20` | 保留最近 20 条消息 |
| `tokens` | `type: tokens, value: 3000` | 保留最近 3000 Token |
| `fraction` | `type: fraction, value: 0.3` | 保留 30% |

**压缩流程**：

```
messages 列表（可能上百条）
    ↓ 检查是否满足 trigger 条件
    ↓ 满足时
    ↓
┌──────────────────────────────┐
│  旧消息（将被压缩）          │ ← trim_tokens_to_summarize 裁剪后
│  ...                         │   送给 LLM 生成摘要
│  第 N-keep 条消息             │
├──────────────────────────────┤
│  近期消息（保留）            │ ← 按 keep 策略保留
│  最后 keep 条消息            │
└──────────────────────────────┘
    ↓
结果: [摘要消息] + [近期保留的消息]
```

**配置示例**（`config.yaml`）：

```yaml
summarization:
  enabled: true
  model_name: null  # 用默认模型（建议用轻量模型降低成本）
  trigger:
    - type: "tokens"
      value: 40000
    - type: "messages"
      value: 50
  keep:
    type: "messages"
    value: 20
  trim_tokens_to_summarize: 15564
  summary_prompt: null  # 使用 LangChain 默认摘要提示
```

**关键代码路径**：
- 配置加载: `deerflow/config/summarization_config.py` → `SummarizationConfig`
- 中间件创建: `agents/lead_agent/agent.py` → `_create_summarization_middleware()`
- 实际压缩: LangChain 的 `SummarizationMiddleware`（非 DeerFlow 自研）

### C.4 第3层：检查点持久化

LangGraph 的检查点机制负责持久化完整的 `ThreadState`，支持对话中断/恢复。

**存储后端选择**：

| 类型 | 适用场景 | 持久性 |
|------|---------|--------|
| `memory` (InMemorySaver) | 开发/测试 | 进程重启丢失 |
| `sqlite` (AsyncSqliteSaver) | 单机部署 | 持久 |
| `postgres` (AsyncPostgresSaver) | 生产/多实例 | 持久 |

**检查点内容**：每次图步骤执行完毕，LangGraph 自动保存：

```python
# 检查点包含的完整 ThreadState
{
    "messages": [...],           # 对话消息（可能已被 Summarization 压缩）
    "sandbox": {...},            # 沙箱状态
    "thread_data": {...},        # 线程目录状态
    "title": "...",              # 自动生成的标题
    "artifacts": [...],          # 产物文件列表
    "todos": [...],              # Todo 列表
    "uploaded_files": [...],     # 上传文件列表
    "viewed_images": {...},      # 已查看图像缓存
}
```

**中断恢复场景**：
1. **Clarification 中断**：Agent 调用 `ask_clarification` → `ClarificationMiddleware` 发出 `Command(goto=END)` → LangGraph 保存检查点 → 用户回复后从检查点恢复
2. **超时/异常**：检查点保证状态不丢失
3. **跨请求状态**：同一 `thread_id` 的后续请求自动从最新检查点恢复

**配置方式**：

```yaml
# config.yaml
checkpointer:
  type: "sqlite"              # memory | sqlite | postgres
  connection_string: "store.db"  # sqlite 文件路径或 postgres 连接串
```

**双注册点**（注意区别）：
- `backend/langgraph.json` → `checkpointer.path`：LangGraph Server 使用
- `config.yaml` → `checkpointer`：`DeerFlowClient` 嵌入式使用

### C.5 第4层：长期记忆系统

长期记忆是上下文管理最复杂的部分，跨越多个会话积累用户画像。

#### 数据采集流程

```
Agent 完成对话
    ↓
MemoryMiddleware.after_agent()
    ↓ 从 state["messages"] 提取消息
    ↓
_filter_messages_for_memory()
    │
    ├── 保留: HumanMessage（去掉 <uploaded_files> 标签）
    ├── 保留: AIMessage（无 tool_calls 的最终回复）
    ├── 丢弃: ToolMessage（工具执行结果）
    ├── 丢弃: AIMessage with tool_calls（中间步骤）
    └── 丢弃: 纯上传消息（去掉标签后内容为空）+ 对应的 AI 回复
    ↓
MemoryQueue.add(thread_id, filtered_messages)
    ↓ 按 thread_id 去重（同线程只保留最新）
    ↓ 防抖 30 秒等待
    ↓
MemoryQueue._process_queue()
    ↓ 后台线程执行
    ↓
MemoryUpdater.update_memory()
    ↓
    ├── 1. 读取当前 memory.json
    ├── 2. 格式化对话（单条 > 1000 字符截断）
    ├── 3. 构建 MEMORY_UPDATE_PROMPT（含当前记忆 + 新对话）
    ├── 4. 调用 LLM 提取更新
    ├── 5. 解析 JSON 响应
    ├── 6. _apply_updates()（合并上下文、添加/删除事实、去重、执行 max_facts 限制）
    ├── 7. _strip_upload_mentions_from_memory()（清除上传路径引用）
    └── 8. 原子写入（临时文件 + rename）
```

#### LLM 记忆提取提示词

DeerFlow 用一个精心设计的提示词让 LLM 从对话中提取结构化记忆：

```
输入：当前记忆状态 + 新对话
    ↓
LLM 按提示词分析后输出 JSON：
{
  "user": {
    "workContext":     { "summary": "...", "shouldUpdate": true/false },
    "personalContext": { "summary": "...", "shouldUpdate": true/false },
    "topOfMind":       { "summary": "...", "shouldUpdate": true/false }
  },
  "history": {
    "recentMonths":        { "summary": "...", "shouldUpdate": true/false },
    "earlierContext":      { "summary": "...", "shouldUpdate": true/false },
    "longTermBackground":  { "summary": "...", "shouldUpdate": true/false }
  },
  "newFacts": [
    { "content": "...", "category": "preference|knowledge|context|behavior|goal", "confidence": 0.0-1.0 }
  ],
  "factsToRemove": ["fact_id_1", "fact_id_2"]
}
```

**事实去重逻辑**：
- 新事实 `content.strip()` 后与已有事实比较
- 完全相同的内容跳过
- 置信度 < `fact_confidence_threshold` (默认 0.7) 的事实不入库
- 超过 `max_facts` (默认 100) 时按置信度排序保留 Top N

**原子写入保障**：
```python
# storage.py 中的 save 方法
temp_path = file_path.with_suffix(".tmp")
with open(temp_path, "w") as f:
    json.dump(memory_data, f, indent=2, ensure_ascii=False)
temp_path.replace(file_path)  # 原子操作
```

#### 存储架构

```python
class MemoryStorage(ABC):     # 抽象基类
    def load(agent_name)      # 加载记忆（带 mtime 缓存）
    def reload(agent_name)    # 强制重载
    def save(memory_data, agent_name)  # 原子写入

class FileMemoryStorage(MemoryStorage):  # 默认实现
    # 基于文件的记忆存储
    # 支持 per-agent 记忆隔离
    # mtime 缓存机制避免频繁磁盘 IO
```

**per-Agent 记忆隔离**：
- 全局记忆: `backend/.deer-flow/memory.json`
- Agent 专属记忆: `backend/.deer-flow/agents/{agent_name}/memory.json`

### C.6 第5层：上下文注入

每次构建 Agent 时，`apply_prompt_template()` 将长期记忆注入系统提示词。

**注入内容**：

```xml
<memory>
User Context:
- Work: 后端开发工程师，主要使用 Go 和 Python
- Personal: 中文母语，英文流利
- Current Focus: 正在学习 LangGraph 框架，计划基于 DeerFlow 二次开发

History:
- Recent: 最近3个月主要研究 AI Agent 架构...

Facts:
- [knowledge | 0.95] 熟悉 Go Application Server (GAS) 框架
- [preference | 0.90] 偏好中文交流
- [context | 0.85] 在 Shopee 工作
- [goal | 0.80] 计划基于 DeerFlow 构建内部 AI 工具
</memory>
```

**Token 预算控制**：

```python
def format_memory_for_injection(memory_data, max_tokens=2000):
    # 1. 先拼接 User Context 和 History 摘要
    # 2. 然后按置信度排序 Facts
    # 3. 逐条添加 Fact，直到 Token 超预算
    # 4. 最终整体检查，超限则按比例截断
```

Token 计算使用 `tiktoken` 的 `cl100k_base` 编码（GPT-4/3.5 系列），不可用时回退到 `len//4` 估算。

### C.7 各层交互关系总结

```
用户发送消息
    ↓
[UploadsMiddleware] 注入 <uploaded_files> → messages 增加上下文
    ↓
[SummarizationMiddleware] 检查是否需要压缩 → 可能替换旧消息为摘要
    ↓
[Checkpointer] 每步保存 ThreadState 快照 → 支持中断恢复
    ↓
Agent 执行（LLM 调用 + 工具调用循环）
    ↓
[MemoryMiddleware] 过滤消息 → 排入防抖队列 → 后台 LLM 提取记忆
    ↓
[下次对话] apply_prompt_template() → 注入 <memory> 到系统提示 → LLM 获得长期上下文
```

**关键设计权衡**：

| 设计决策 | 选择 | 原因 |
|---------|------|------|
| 压缩实现 | 委托给 LangChain | 避免重复造轮，专注业务逻辑 |
| 记忆更新时机 | 异步防抖 | 不阻塞主对话，合并高频更新 |
| 记忆注入方式 | 系统提示词 | 对 LLM 最友好的上下文注入方式 |
| 检查点存储 | 可插拔后端 | 开发用 memory，生产用 postgres |
| 上传文件标签 | 注入 + 过滤 | 对话中可见，但不进长期记忆 |
| Token 预算 | 分层控制 | 压缩有独立阈值，记忆注入有独立上限 |

---

> **文档维护**：本文档基于 2026-03-31 的代码状态生成。代码变更后请同步更新此文档。
