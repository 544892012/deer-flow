# 架构总览

本文档提供 DeerFlow 后端架构的全面概述。

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              客户端 (浏览器)                              │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          Nginx (端口 2026)                               │
│                        统一反向代理入口                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  /api/langgraph/*  →  LangGraph Server (2024)                      │  │
│  │  /api/*            →  Gateway API (8001)                           │  │
│  │  /*                →  Frontend (3000)                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
│   LangGraph Server  │ │    Gateway API      │ │     Frontend        │
│     (端口 2024)      │ │    (端口 8001)      │ │    (端口 3000)      │
│                     │ │                     │ │                     │
│  - Agent 运行时     │ │  - 模型 API         │ │  - Next.js 应用     │
│  - 线程管理         │ │  - MCP 配置         │ │  - React UI         │
│  - SSE 流式传输     │ │  - 技能管理         │ │  - 聊天界面         │
│  - 检查点持久化     │ │  - 文件上传         │ │                     │
│                     │ │  - 线程清理         │ │                     │
│                     │ │  - 产物管理         │ │                     │
└─────────────────────┘ └─────────────────────┘ └─────────────────────┘
          │                       │
          │     ┌─────────────────┘
          │     │
          ▼     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            共享配置                                       │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────┐ │
│  │      config.yaml        │  │      extensions_config.json            │ │
│  │  - 模型配置             │  │  - MCP 服务器                          │ │
│  │  - 工具配置             │  │  - 技能状态                            │ │
│  │  - 沙箱配置             │  │                                        │ │
│  │  - 摘要配置             │  │                                        │ │
│  └─────────────────────────┘  └────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

## 组件详情

### LangGraph Server

LangGraph Server 是核心 Agent 运行时，基于 LangGraph 构建，用于稳健的多 Agent 工作流编排。

**入口**：`packages/harness/deerflow/agents/lead_agent/agent.py:make_lead_agent`

**核心职责**：
- Agent 创建和配置
- 线程状态管理
- 中间件链执行
- 工具执行编排
- SSE 流式实时响应

**配置**：`langgraph.json`

```json
{
  "agent": {
    "type": "agent",
    "path": "deerflow.agents:make_lead_agent"
  }
}
```

### Gateway API

FastAPI 应用，为非 Agent 操作提供 REST 端点。

**入口**：`app/gateway/app.py`

**路由**：
- `models.py` - `/api/models` - 模型列表和详情
- `mcp.py` - `/api/mcp` - MCP 服务器配置
- `skills.py` - `/api/skills` - 技能管理
- `uploads.py` - `/api/threads/{id}/uploads` - 文件上传
- `threads.py` - `/api/threads/{id}` - LangGraph 删除后的本地 DeerFlow 线程数据清理
- `artifacts.py` - `/api/threads/{id}/artifacts` - 产物提供
- `suggestions.py` - `/api/threads/{id}/suggestions` - 后续问题建议生成

Web 对话删除流程现在分布在两个后端服务上：LangGraph 处理 `DELETE /api/langgraph/threads/{thread_id}` 来删除线程状态，然后 Gateway 的 `threads.py` 路由通过 `Paths.delete_thread_dir()` 移除 DeerFlow 管理的文件系统数据。

### Agent 架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           make_lead_agent(config)                        │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             中间件链                                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. ThreadDataMiddleware  - 初始化 workspace/uploads/outputs     │   │
│  │ 2. UploadsMiddleware     - 处理上传文件                          │   │
│  │ 3. SandboxMiddleware     - 获取沙箱环境                          │   │
│  │ 4. SummarizationMiddleware - 上下文压缩（若启用）                │   │
│  │ 5. TitleMiddleware       - 自动生成标题                          │   │
│  │ 6. TodoListMiddleware    - 任务跟踪（计划模式）                   │   │
│  │ 7. ViewImageMiddleware   - 视觉模型支持                          │   │
│  │ 8. ClarificationMiddleware - 处理澄清请求                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              Agent 核心                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   │
│  │      模型        │  │      工具        │  │    系统提示词         │   │
│  │  (模型工厂创建)  │  │  (配置 + MCP     │  │  (含技能注入)        │   │
│  │                  │  │   + 内置工具)    │  │                      │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 线程状态

`ThreadState` 扩展了 LangGraph 的 `AgentState`，增加了额外字段：

```python
class ThreadState(AgentState):
    # AgentState 核心状态
    messages: list[BaseMessage]

    # DeerFlow 扩展字段
    sandbox: dict             # 沙箱环境信息
    artifacts: list[str]      # 生成的文件路径
    thread_data: dict         # {workspace, uploads, outputs} 路径
    title: str | None         # 自动生成的对话标题
    todos: list[dict]         # 任务跟踪（计划模式）
    viewed_images: dict       # 视觉模型图像数据
```

### 沙箱系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            沙箱架构                                      │
└─────────────────────────────────────────────────────────────────────────┘

                      ┌─────────────────────────┐
                      │    SandboxProvider      │ (抽象类)
                      │  - acquire()            │
                      │  - get()                │
                      │  - release()            │
                      └────────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                                         │
              ▼                                         ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│  LocalSandboxProvider   │              │  AioSandboxProvider     │
│  (本地沙箱提供者)        │              │  (Docker 沙箱提供者)    │
│                         │              │                         │
│  - 单例实例             │              │  - 基于 Docker          │
│  - 直接执行             │              │  - 容器隔离             │
│  - 开发环境使用         │              │  - 生产环境推荐         │
└─────────────────────────┘              └─────────────────────────┘

                      ┌─────────────────────────┐
                      │        Sandbox          │ (抽象类)
                      │  - execute_command()    │
                      │  - read_file()          │
                      │  - write_file()         │
                      │  - list_dir()           │
                      └─────────────────────────┘
```

**虚拟路径映射**：

| 虚拟路径 | 物理路径 |
|----------|----------|
| `/mnt/user-data/workspace` | `backend/.deer-flow/threads/{thread_id}/user-data/workspace` |
| `/mnt/user-data/uploads` | `backend/.deer-flow/threads/{thread_id}/user-data/uploads` |
| `/mnt/user-data/outputs` | `backend/.deer-flow/threads/{thread_id}/user-data/outputs` |
| `/mnt/skills` | `deer-flow/skills/` |

### 工具系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             工具来源                                     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│    内置工具          │  │    配置工具          │  │     MCP 工具        │
│  (deerflow/tools/)  │  │  (config.yaml)      │  │  (extensions.json)  │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│ - present_file      │  │ - web_search        │  │ - github            │
│ - ask_clarification │  │ - web_fetch         │  │ - filesystem        │
│ - view_image        │  │ - bash              │  │ - postgres          │
│                     │  │ - read_file         │  │ - brave-search      │
│                     │  │ - write_file        │  │ - puppeteer         │
│                     │  │ - str_replace       │  │ - ...               │
│                     │  │ - ls                │  │                     │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
           │                       │                       │
           └───────────────────────┴───────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   get_available_tools() │
                      └─────────────────────────┘
```

### 模型工厂

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           模型工厂                                       │
│                     (deerflow/models/factory.py)                         │
└─────────────────────────────────────────────────────────────────────────┘

config.yaml:
┌─────────────────────────────────────────────────────────────────────────┐
│ models:                                                                  │
│   - name: gpt-4                                                         │
│     display_name: GPT-4                                                 │
│     use: langchain_openai:ChatOpenAI                                    │
│     model: gpt-4                                                        │
│     api_key: $OPENAI_API_KEY                                            │
│     max_tokens: 4096                                                    │
│     supports_thinking: false                                            │
│     supports_vision: true                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   create_chat_model()   │
                      │  - name: str            │
                      │  - thinking_enabled     │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   resolve_class()       │
                      │  (反射加载系统)          │
                      └────────────┬────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │   BaseChatModel         │
                      │  (LangChain 实例)       │
                      └─────────────────────────┘
```

**支持的模型提供商**：
- OpenAI (`langchain_openai:ChatOpenAI`)
- Anthropic (`langchain_anthropic:ChatAnthropic`)
- DeepSeek (`langchain_deepseek:ChatDeepSeek`)
- 通过 LangChain 集成的自定义提供商

### MCP 集成

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          MCP 集成                                        │
│                        (deerflow/mcp/manager.py)                         │
└─────────────────────────────────────────────────────────────────────────┘

extensions_config.json:
┌─────────────────────────────────────────────────────────────────────────┐
│ {                                                                        │
│   "mcpServers": {                                                       │
│     "github": {                                                         │
│       "enabled": true,                                                  │
│       "type": "stdio",                                                  │
│       "command": "npx",                                                 │
│       "args": ["-y", "@modelcontextprotocol/server-github"],           │
│       "env": {"GITHUB_TOKEN": "$GITHUB_TOKEN"}                          │
│     }                                                                   │
│   }                                                                     │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                      ┌─────────────────────────┐
                      │  MultiServerMCPClient   │
                      │  (langchain-mcp-adapters)│
                      └────────────┬────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
       ┌───────────┐        ┌───────────┐        ┌───────────┐
       │  stdio    │        │   SSE     │        │   HTTP    │
       │  传输     │        │   传输    │        │   传输    │
       └───────────┘        └───────────┘        └───────────┘
```

### 技能系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           技能系统                                       │
│                       (deerflow/skills/loader.py)                        │
└─────────────────────────────────────────────────────────────────────────┘

目录结构：
┌─────────────────────────────────────────────────────────────────────────┐
│ skills/                                                                  │
│ ├── public/                        # 公共技能（已提交）                  │
│ │   ├── pdf-processing/                                                 │
│ │   │   └── SKILL.md                                                    │
│ │   ├── frontend-design/                                                │
│ │   │   └── SKILL.md                                                    │
│ │   └── ...                                                             │
│ └── custom/                        # 自定义技能（已忽略）                │
│     └── user-installed/                                                 │
│         └── SKILL.md                                                    │
└─────────────────────────────────────────────────────────────────────────┘

SKILL.md 格式：
┌─────────────────────────────────────────────────────────────────────────┐
│ ---                                                                      │
│ name: PDF Processing                                                     │
│ description: 高效处理 PDF 文档                                           │
│ license: MIT                                                            │
│ allowed-tools:                                                          │
│   - read_file                                                           │
│   - write_file                                                          │
│   - bash                                                                │
│ ---                                                                      │
│                                                                          │
│ # 技能指令                                                               │
│ 注入到系统提示词中的内容...                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### 请求流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          请求流程示例                                     │
│                    用户向 Agent 发送消息                                  │
└─────────────────────────────────────────────────────────────────────────┘

1. 客户端 → Nginx
   POST /api/langgraph/threads/{thread_id}/runs
   {"input": {"messages": [{"role": "user", "content": "你好"}]}}

2. Nginx → LangGraph Server (2024)
   代理转发到 LangGraph Server

3. LangGraph Server
   a. 加载/创建线程状态
   b. 执行中间件链：
      - ThreadDataMiddleware：设置路径
      - UploadsMiddleware：注入文件列表
      - SandboxMiddleware：获取沙箱
      - SummarizationMiddleware：检查 token 限制
      - TitleMiddleware：需要时生成标题
      - TodoListMiddleware：加载待办事项（计划模式）
      - ViewImageMiddleware：处理图像
      - ClarificationMiddleware：检查澄清请求

   c. 执行 Agent：
      - 模型处理消息
      - 可能调用工具（bash、web_search 等）
      - 工具通过沙箱执行
      - 结果添加到消息中

   d. 通过 SSE 流式返回响应

4. 客户端接收流式响应
```

## 数据流

### 文件上传流程

```
1. 客户端上传文件
   POST /api/threads/{thread_id}/uploads
   Content-Type: multipart/form-data

2. Gateway 接收文件
   - 验证文件
   - 存储到 .deer-flow/threads/{thread_id}/user-data/uploads/
   - 如果是文档：通过 markitdown 转换为 Markdown

3. 返回响应
   {
     "files": [{
       "filename": "doc.pdf",
       "path": ".deer-flow/.../uploads/doc.pdf",
       "virtual_path": "/mnt/user-data/uploads/doc.pdf",
       "artifact_url": "/api/threads/.../artifacts/mnt/.../doc.pdf"
     }]
   }

4. 下次 Agent 执行
   - UploadsMiddleware 列出文件
   - 注入文件列表到消息中
   - Agent 可通过 virtual_path 访问
```

### 线程清理流程

```
1. 客户端通过 LangGraph 删除对话
   DELETE /api/langgraph/threads/{thread_id}

2. Web UI 跟进调用 Gateway 清理
   DELETE /api/threads/{thread_id}

3. Gateway 移除本地 DeerFlow 管理的文件
   - 递归删除 .deer-flow/threads/{thread_id}/
   - 目录不存在时视为无操作
   - 在文件系统访问前拒绝无效的线程 ID
```

### 配置重载

```
1. 客户端更新 MCP 配置
   PUT /api/mcp/config

2. Gateway 写入 extensions_config.json
   - 更新 mcpServers 部分
   - 文件修改时间变化

3. MCP Manager 检测到变更
   - get_cached_mcp_tools() 检查文件修改时间
   - 如果变更：重新初始化 MCP 客户端
   - 加载更新后的服务器配置

4. 下次 Agent 执行使用新工具
```

## 安全考虑

### 沙箱隔离

- Agent 代码在沙箱边界内执行
- 本地沙箱：直接执行（仅限开发环境）
- Docker 沙箱：容器隔离（生产环境推荐）
- 文件操作中的路径穿越防护

### API 安全

- 线程隔离：每个线程有独立的数据目录
- 文件验证：上传文件检查路径安全性
- 环境变量解析：密钥不存储在配置文件中

### MCP 安全

- 每个 MCP 服务器在自己的进程中运行
- 环境变量在运行时解析
- 服务器可以独立启用/禁用

## 性能考虑

### 缓存

- MCP 工具使用文件修改时间失效的缓存
- 配置加载一次，文件变更时重载
- 技能在启动时解析一次，缓存在内存中

### 流式传输

- 使用 SSE 进行实时响应流式传输
- 减少首个 token 的延迟
- 为长时间操作提供进度可见性

### 上下文管理

- 摘要中间件在接近限制时压缩上下文
- 可配置触发器：token 数、消息数或比例
- 保留最近的消息，同时摘要较早的消息
