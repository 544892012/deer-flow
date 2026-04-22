# 01 - 架构总览

## 整体架构图

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
```

## 技术栈

| 分类 | 后端 | 前端 |
|------|------|------|
| **语言** | Python ≥ 3.12 | TypeScript 5.8 |
| **包管理** | uv（工作区模式） | pnpm |
| **Agent** | LangGraph + LangChain | — |
| **HTTP** | FastAPI + Uvicorn | Next.js 16 |
| **流式** | SSE (sse-starlette) | LangGraph SDK |
| **UI** | — | React 19, Tailwind 4, Radix UI |

## Harness / App 双层分离

这是最重要的架构决策：

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

**设计意图**：
1. `deerflow-harness` 可独立发布到 PyPI
2. 通过 `DeerFlowClient` 可以不启动 HTTP 服务直接使用
3. `test_harness_boundary.py` 在 CI 中强制检测违规导入

## 后端目录结构速览

```
backend/
├── packages/harness/deerflow/    # 可发布框架包 (import: deerflow.*)
│   ├── agents/                   # Agent 系统（→ 详见 02）
│   ├── subagents/                # 子代理系统（→ 详见 03）
│   ├── sandbox/                  # 沙箱系统（→ 详见 04）
│   ├── tools/                    # 工具系统（→ 详见 02）
│   ├── models/                   # 模型工厂
│   ├── mcp/                      # MCP 协议集成
│   ├── skills/                   # 技能系统
│   ├── config/                   # 配置管理
│   ├── runtime/                  # 运行时基础设施
│   ├── community/                # 社区工具
│   └── client.py                 # 嵌入式客户端
│
├── app/                          # 应用层 (import: app.*)
│   ├── gateway/                  # FastAPI 网关 + 路由
│   └── channels/                 # IM 平台桥接
│
├── tests/                        # 测试套件
└── langgraph.json                # LangGraph Server 配置
```

## 服务端口一览

| 服务 | 端口 | 职责 |
|------|------|------|
| Nginx | 2026 | 统一入口，反向代理，CORS |
| LangGraph Server | 2024 | Agent 运行时，对话/线程/流式执行 |
| Gateway API | 8001 | 管理面 REST API |
| Frontend | 3000 | Web UI |
| Provisioner | 8002 | （可选）K8s 沙箱 Pod 编排 |

## 启动命令

```bash
make dev        # 启动全部服务，访问 http://localhost:2026
make stop       # 停止全部服务
cd backend && make dev      # 仅 LangGraph Server
cd backend && make gateway  # 仅 Gateway API
```
