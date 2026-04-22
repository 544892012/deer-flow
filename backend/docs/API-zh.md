# API 参考

本文档提供 DeerFlow 后端 API 的完整说明。

## 概览

DeerFlow 后端暴露两类 API：

1. **LangGraph API** — Agent 交互、线程与流式输出（`/api/langgraph/*`）
2. **Gateway API** — 模型、MCP、技能、上传与产物（`/api/*`）

所有 API 均通过 Nginx 反向代理，统一从 2026 端口访问。

## LangGraph API

基础路径：`/api/langgraph`

LangGraph API 由 LangGraph 服务提供，遵循 LangGraph SDK 约定。

### 线程（Threads）

#### 创建线程

```http
POST /api/langgraph/threads
Content-Type: application/json
```

**请求体：**
```json
{
  "metadata": {}
}
```

**响应：**
```json
{
  "thread_id": "abc123",
  "created_at": "2024-01-15T10:30:00Z",
  "metadata": {}
}
```

#### 获取线程状态

```http
GET /api/langgraph/threads/{thread_id}/state
```

**响应：**
```json
{
  "values": {
    "messages": [...],
    "sandbox": {...},
    "artifacts": [...],
    "thread_data": {...},
    "title": "Conversation Title"
  },
  "next": [],
  "config": {...}
}
```

### 运行（Runs）

#### 创建运行（Create Run）

使用输入执行 agent。

```http
POST /api/langgraph/threads/{thread_id}/runs
Content-Type: application/json
```

**请求体：**
```json
{
  "input": {
    "messages": [
      {
        "role": "user",
        "content": "Hello, can you help me?"
      }
    ]
  },
  "config": {
    "configurable": {
      "model_name": "gpt-4",
      "thinking_enabled": false,
      "is_plan_mode": false
    }
  },
  "stream_mode": ["values", "messages-tuple", "custom"]
}
```

**流模式（stream_mode）兼容性：**
- 可使用：`values`、`messages-tuple`、`custom`、`updates`、`events`、`debug`、`tasks`、`checkpoints`
- 不要使用：`tools`（在当前 `langgraph-api` 中已废弃/无效，会触发校验错误）

**可配置项（configurable）：**
- `model_name`（字符串）：覆盖默认模型
- `thinking_enabled`（布尔）：为支持的模型启用扩展思考
- `is_plan_mode`（布尔）：启用 TodoList 中间件以跟踪任务

**响应：** 服务器推送事件（SSE）流

```
event: values
data: {"messages": [...], "title": "..."}

event: messages
data: {"content": "Hello! I'd be happy to help.", "role": "assistant"}

event: end
data: {}
```

#### 获取运行历史

```http
GET /api/langgraph/threads/{thread_id}/runs
```

**响应：**
```json
{
  "runs": [
    {
      "run_id": "run123",
      "status": "success",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### 流式运行（Stream Run）

实时流式返回结果。

```http
POST /api/langgraph/threads/{thread_id}/runs/stream
Content-Type: application/json
```

请求体与「创建运行」相同。返回 SSE 流。

---

## Gateway API

基础路径：`/api`

### 模型（Models）

#### 列出模型

从配置中获取所有可用的大语言模型。

```http
GET /api/models
```

**响应：**
```json
{
  "models": [
    {
      "name": "gpt-4",
      "display_name": "GPT-4",
      "supports_thinking": false,
      "supports_vision": true
    },
    {
      "name": "claude-3-opus",
      "display_name": "Claude 3 Opus",
      "supports_thinking": false,
      "supports_vision": true
    },
    {
      "name": "deepseek-v3",
      "display_name": "DeepSeek V3",
      "supports_thinking": true,
      "supports_vision": false
    }
  ]
}
```

#### 获取模型详情

```http
GET /api/models/{model_name}
```

**响应：**
```json
{
  "name": "gpt-4",
  "display_name": "GPT-4",
  "model": "gpt-4",
  "max_tokens": 4096,
  "supports_thinking": false,
  "supports_vision": true
}
```

### MCP 配置

#### 获取 MCP 配置

获取当前 MCP 服务配置。

```http
GET /api/mcp/config
```

**响应：**
```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "***"
      },
      "description": "GitHub operations"
    },
    "filesystem": {
      "enabled": false,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "description": "File system access"
    }
  }
}
```

#### 更新 MCP 配置

更新 MCP 服务配置。

```http
PUT /api/mcp/config
Content-Type: application/json
```

**请求体：**
```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "$GITHUB_TOKEN"
      },
      "description": "GitHub operations"
    }
  }
}
```

**响应：**
```json
{
  "success": true,
  "message": "MCP configuration updated"
}
```

### 技能（Skills）

#### 列出技能

获取所有可用技能。

```http
GET /api/skills
```

**响应：**
```json
{
  "skills": [
    {
      "name": "pdf-processing",
      "display_name": "PDF Processing",
      "description": "Handle PDF documents efficiently",
      "enabled": true,
      "license": "MIT",
      "path": "public/pdf-processing"
    },
    {
      "name": "frontend-design",
      "display_name": "Frontend Design",
      "description": "Design and build frontend interfaces",
      "enabled": false,
      "license": "MIT",
      "path": "public/frontend-design"
    }
  ]
}
```

#### 获取技能详情

```http
GET /api/skills/{skill_name}
```

**响应：**
```json
{
  "name": "pdf-processing",
  "display_name": "PDF Processing",
  "description": "Handle PDF documents efficiently",
  "enabled": true,
  "license": "MIT",
  "path": "public/pdf-processing",
  "allowed_tools": ["read_file", "write_file", "bash"],
  "content": "# PDF Processing\n\nInstructions for the agent..."
}
```

#### 启用技能

```http
POST /api/skills/{skill_name}/enable
```

**响应：**
```json
{
  "success": true,
  "message": "Skill 'pdf-processing' enabled"
}
```

#### 禁用技能

```http
POST /api/skills/{skill_name}/disable
```

**响应：**
```json
{
  "success": true,
  "message": "Skill 'pdf-processing' disabled"
}
```

#### 安装技能

从 `.skill` 文件安装技能。

```http
POST /api/skills/install
Content-Type: multipart/form-data
```

**请求体：**
- `file`：要安装的 `.skill` 文件

**响应：**
```json
{
  "success": true,
  "message": "Skill 'my-skill' installed successfully",
  "skill": {
    "name": "my-skill",
    "display_name": "My Skill",
    "path": "custom/my-skill"
  }
}
```

### 文件上传

#### 上传文件

向某个线程上传一个或多个文件。

```http
POST /api/threads/{thread_id}/uploads
Content-Type: multipart/form-data
```

**请求体：**
- `files`：一个或多个待上传文件

**响应：**
```json
{
  "success": true,
  "files": [
    {
      "filename": "document.pdf",
      "size": 1234567,
      "path": ".deer-flow/threads/abc123/user-data/uploads/document.pdf",
      "virtual_path": "/mnt/user-data/uploads/document.pdf",
      "artifact_url": "/api/threads/abc123/artifacts/mnt/user-data/uploads/document.pdf",
      "markdown_file": "document.md",
      "markdown_path": ".deer-flow/threads/abc123/user-data/uploads/document.md",
      "markdown_virtual_path": "/mnt/user-data/uploads/document.md",
      "markdown_artifact_url": "/api/threads/abc123/artifacts/mnt/user-data/uploads/document.md"
    }
  ],
  "message": "Successfully uploaded 1 file(s)"
}
```

**支持的文档格式**（自动转为 Markdown）：
- PDF（`.pdf`）
- PowerPoint（`.ppt`、`.pptx`）
- Excel（`.xls`、`.xlsx`）
- Word（`.doc`、`.docx`）

#### 列出已上传文件

```http
GET /api/threads/{thread_id}/uploads/list
```

**响应：**
```json
{
  "files": [
    {
      "filename": "document.pdf",
      "size": 1234567,
      "path": ".deer-flow/threads/abc123/user-data/uploads/document.pdf",
      "virtual_path": "/mnt/user-data/uploads/document.pdf",
      "artifact_url": "/api/threads/abc123/artifacts/mnt/user-data/uploads/document.pdf",
      "extension": ".pdf",
      "modified": 1705997600.0
    }
  ],
  "count": 1
}
```

#### 删除文件

```http
DELETE /api/threads/{thread_id}/uploads/{filename}
```

**响应：**
```json
{
  "success": true,
  "message": "Deleted document.pdf"
}
```

### 线程清理

在 LangGraph 侧线程已删除后，删除 `.deer-flow/threads/{thread_id}` 下由 DeerFlow 管理的本地线程文件。

```http
DELETE /api/threads/{thread_id}
```

**响应：**
```json
{
  "success": true,
  "message": "Deleted local thread data for abc123"
}
```

**错误行为：**
- 非法线程 ID 返回 `422`
- `500` 返回通用 `{"detail": "Failed to delete local thread data."}`，完整异常信息仅记录在服务端日志

### 产物（Artifacts）

#### 获取产物

下载或查看 agent 生成的产物。

```http
GET /api/threads/{thread_id}/artifacts/{path}
```

**路径示例：**
- `/api/threads/abc123/artifacts/mnt/user-data/outputs/result.txt`
- `/api/threads/abc123/artifacts/mnt/user-data/uploads/document.pdf`

**查询参数：**
- `download`（布尔）：为 `true` 时强制下载并设置 Content-Disposition 头

**响应：** 文件内容，Content-Type 按类型设置

---

## 错误响应

所有 API 的错误格式一致：

```json
{
  "detail": "Error message describing what went wrong"
}
```

**HTTP 状态码：**
- `400` — 错误请求：输入无效
- `404` — 未找到：资源不存在
- `422` — 校验错误：请求未通过校验
- `500` — 服务器内部错误

---

## 认证

当前 DeerFlow 未实现 API 层认证，所有接口均可无凭证访问。

说明：此处指 DeerFlow API 本身的认证。MCP 对外连接仍可为已配置的 HTTP/SSE MCP 服务使用 OAuth。

生产环境建议：
1. 在 Nginx 上配置基础认证或接入 OAuth
2. 部署在 VPN 或私有网络之后
3. 实现自定义认证中间件

---

## 限流

默认未实现限流。生产环境可在 Nginx 中配置，例如：

```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://backend;
}
```

---

## WebSocket 支持

LangGraph 服务支持 WebSocket 实时流式连接，地址为：

```
ws://localhost:2026/api/langgraph/threads/{thread_id}/runs/stream
```

---

## SDK 用法

### Python（LangGraph SDK）

```python
from langgraph_sdk import get_client

client = get_client(url="http://localhost:2026/api/langgraph")

# Create thread
thread = await client.threads.create()

# Run agent
async for event in client.runs.stream(
    thread["thread_id"],
    "lead_agent",
    input={"messages": [{"role": "user", "content": "Hello"}]},
    config={"configurable": {"model_name": "gpt-4"}},
    stream_mode=["values", "messages-tuple", "custom"],
):
    print(event)
```

### JavaScript/TypeScript

```typescript
// Using fetch for Gateway API
const response = await fetch('/api/models');
const data = await response.json();
console.log(data.models);

// Using EventSource for streaming
const eventSource = new EventSource(
  `/api/langgraph/threads/${threadId}/runs/stream`
);
eventSource.onmessage = (event) => {
  console.log(JSON.parse(event.data));
};
```

### cURL 示例

```bash
# List models
curl http://localhost:2026/api/models

# Get MCP config
curl http://localhost:2026/api/mcp/config

# Upload file
curl -X POST http://localhost:2026/api/threads/abc123/uploads \
  -F "files=@document.pdf"

# Enable skill
curl -X POST http://localhost:2026/api/skills/pdf-processing/enable

# Create thread and run agent
curl -X POST http://localhost:2026/api/langgraph/threads \
  -H "Content-Type: application/json" \
  -d '{}'

curl -X POST http://localhost:2026/api/langgraph/threads/abc123/runs \
  -H "Content-Type: application/json" \
  -d '{
    "input": {"messages": [{"role": "user", "content": "Hello"}]},
    "config": {"configurable": {"model_name": "gpt-4"}}
  }'
```
