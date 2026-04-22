# 12. API 请求指南 — 如何用 cURL / Postman 发消息

## 1. 两套 API 概览

DeerFlow Gateway（端口 8001）提供两套 Runs API：

| API | 路由前缀 | 特点 |
|-----|---------|------|
| **Stateless Runs** | `/api/runs/` | 无需提前创建 Thread，自动生成（也可通过 `config.configurable.thread_id` 复用已有 Thread） |
| **Thread Runs** | `/api/threads/{thread_id}/runs/` | 需先 `POST /api/threads` 创建 Thread，再发起 Run |

两套 API 的请求体格式完全相同（都用 `RunCreateRequest`），只是路由和 Thread 管理方式不同。

---

## 2. 请求体结构（RunCreateRequest）

```json
{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        { "role": "user", "content": "你的问题" }
      ]
    },
    "stream_mode": ["updates"],
    "context": {
      "model_name": "gpt-4o"
    },
    "config": {
      "configurable": {
        "thread_id": "可选，指定后可复用对话历史"
      }
    }
  }
```

### 关键参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `assistant_id` | string | 否（默认 `"lead_agent"`） | Agent 名称，**必须传 `"lead_agent"` 或不传**；传其他值会被当作自定义 Agent 名称去 `.deer-flow/agents/<name>/` 目录查找，不存在则报 `FileNotFoundError` |
| `input.messages` | array | 是（首次对话） | 用户消息列表，格式 `{role: "user", content: "..."}` |
| `stream_mode` | string / array | 否 | 流式模式：`"updates"` / `"values"` / `"debug"` |
| `context.model_name` | string | 否 | 指定 LLM 模型（如 `"gpt-4o"`、`"deepseek-chat"` 等） |
| `context.thinking_enabled` | bool | 否 | 是否开启思维链 |
| `command` | object | 否 | LangGraph Command（用于 Human-in-the-loop resume） |
| `config.configurable.thread_id` | string | 否 | 指定 Thread ID 以复用对话历史 |

---

## 3. 最简请求示例

### 3.1 Stateless 流式（推荐快速测试）

不需要提前创建 Thread，发完即走：

```bash
curl -N -X POST http://localhost:8001/api/runs/stream \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        { "role": "user", "content": "帮我查一下苹果公司(AAPL)的最新股价" }
      ]
    },
    "stream_mode": ["updates"]
  }'
```

> `-N` 是 curl 参数，禁用输出缓冲，让 SSE 事件实时显示。

### 3.2 Stateless 同步等待（等全部处理完再返回）

```bash
curl -X POST http://localhost:8001/api/runs/wait \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        { "role": "user", "content": "帮我查一下苹果公司(AAPL)的最新股价" }
      ]
    }
  }'
```

### 3.3 多轮对话（保持上下文）

在 `config.configurable.thread_id` 中指定固定 ID：

```bash
# 第一轮
curl -N -X POST http://localhost:8001/api/runs/stream \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        { "role": "user", "content": "帮我查一下苹果公司(AAPL)的最新股价" }
      ]
    },
    "stream_mode": ["updates"],
    "config": {
      "configurable": {
        "thread_id": "my-test-thread-001"
      }
    }
  }'

# 第二轮（同一个 thread_id，自动带上历史上下文）
curl -N -X POST http://localhost:8001/api/runs/stream \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        { "role": "user", "content": "它的市值是多少？" }
      ]
    },
    "stream_mode": ["updates"],
    "config": {
      "configurable": {
        "thread_id": "my-test-thread-001"
      }
    }
  }'
```

### 3.4 Thread 模式（先建后用）

```bash
# 第 1 步：创建 Thread
curl -s -X POST http://localhost:8001/api/threads \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool

# 响应示例:
# { "thread_id": "a1b2c3d4-...", ... }

# 第 2 步：在 Thread 上跑 Run
curl -N -X POST http://localhost:8001/api/threads/a1b2c3d4-.../runs/stream \
  -H "Content-Type: application/json" \
  -d '{
    "assistant_id": "lead_agent",
    "input": {
      "messages": [
        { "role": "user", "content": "帮我查一下苹果公司(AAPL)的最新股价" }
      ]
    },
    "stream_mode": ["updates"]
  }'
```

---

## 4. stream_mode 的选择

| 模式 | 输出内容 | 适用场景 |
|------|---------|---------|
| `"updates"` | 每个节点的增量输出（新产生的 messages） | **推荐日常使用**，输出紧凑 |
| `"values"` | 每步的完整 state 快照 | 需要看完整上下文时使用 |
| `"debug"` | 框架内部执行细节 | 调试 ReAct 循环、排查问题 |

可以组合使用：`"stream_mode": ["updates", "debug"]`

---

## 5. SSE 响应格式

流式响应是标准的 [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)，每个事件格式：

```
event: updates
data: {"node_name": {"messages": [...]}}

event: updates
data: {"tools": {"messages": [...]}}

event: end
data: null
```

在 Postman 中测试 SSE：选择 **Send and Download** 或使用 Postman 的 WebSocket/SSE 客户端功能。

---

## 6. 健康检查

```bash
curl http://localhost:8001/health
# {"status": "ok"}
```

---

## 7. Postman 配置要点

1. **Method**: `POST`
2. **URL**: `http://localhost:8001/api/runs/stream`（或 `/wait`）
3. **Headers**: `Content-Type: application/json`
4. **Body**: 选 `raw` → `JSON`，粘贴上面的请求体
5. **对于 SSE 流式**：建议使用 Postman 的 "Send" 按钮并观察 Events 标签页，或改用 `/wait` 端点获取完整响应

---

## 8. 常见问题

### Q: `assistant_id` 传了 `"lead"` 报 `Agent directory not found`？

```json
{
  "message": "Agent directory not found: .deer-flow/agents/lead",
  "name": "FileNotFoundError"
}
```

**原因**：`assistant_id` 的默认值是 `"lead_agent"`（见 `services.py` 中 `_DEFAULT_ASSISTANT_ID = "lead_agent"`）。当传入的值 **不等于** `"lead_agent"` 且 **不为 null** 时，代码会把它当作 **自定义 Agent 名称**，去 `.deer-flow/agents/<name>/` 查找 `config.yaml`。

**解决**：`assistant_id` 填 `"lead_agent"` 或直接不传这个字段。

### Q: 不传 `assistant_id` 可以吗？

可以。`RunCreateRequest` 中 `assistant_id` 默认为 `None`，`resolve_agent_factory` 对 `None` 的处理和 `"lead_agent"` 一致，都返回默认的 `make_lead_agent` 工厂。

---

## 9. 源码定位

| 路由 | 源文件 |
|------|--------|
| `/api/runs/stream` 和 `/api/runs/wait` | `app/gateway/routers/runs.py` |
| `/api/threads/{id}/runs/stream` 等 | `app/gateway/routers/thread_runs.py` |
| 请求体定义 `RunCreateRequest` | `app/gateway/routers/thread_runs.py:35-56` |
| Run 生命周期逻辑 | `app/gateway/services.py` |

---

## 10. runs.py 与 thread_runs.py 深度对比与前端调用决策

### 🔗 两个文件的核心区别

| 文件 | 路由前缀 | 设计理念 | 适用场景 |
|------|---------|---------|---------|
| **[runs.py](file:///Users/wenchao.zeng/work/codes/deer-flow/backend/app/gateway/routers/runs.py)** | `/api/runs` | **无状态运行** (Stateless) | 一次性交互，无需预先创建线程 |
| **[thread_runs.py](file:///Users/wenchao.zeng/work/codes/deer-flow/backend/app/gateway/routers/thread_runs.py)** | `/api/threads/{thread_id}/runs` | **线程化运行** (Stateful) | 有状态的连续对话，需要历史上下文 |

### 🏗️ 架构关系图

```
DeerFlow 运行端点架构
┌─────────────────────────────────────────────────────────┐
│                    Gateway API Layer                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  /api/runs/* (runs.py)                                 │
│  ├─ POST /stream      # 无状态流式运行                 │
│  └─ POST /wait        # 无状态阻塞运行                 │
│                                                         │
│  /api/threads/* (thread_runs.py)                       │
│  ├─ POST /{thread_id}/runs         # 创建后台运行      │
│  ├─ POST /{thread_id}/runs/stream  # 线程流式运行      │
│  └─ GET  /{thread_id}/runs/{run_id} # 获取运行状态     │
│                                                         │
└─────────────────────────────────────────────────────────┘
         │                              │
         │ 重用线程 (thread_id)          │ 自动创建临时线程
         ▼                              ▼
┌─────────────────┐          ┌──────────────────┐
│ 有状态连续对话   │          │ 无状态单次交互    │
│ 保留历史上下文   │          │ 无历史记录        │
└─────────────────┘          └──────────────────┘
```

### 🔄 代码依赖关系

`runs.py` **复用** `thread_runs.py` 的核心功能：

```python
# runs.py 导入 thread_runs.py 的组件
from app.gateway.routers.thread_runs import RunCreateRequest
from app.gateway.services import sse_consumer, start_run

# 核心逻辑：解析或生成 thread_id
def _resolve_thread_id(body: RunCreateRequest) -> str:
    thread_id = (body.config or {}).get("configurable", {}).get("thread_id")
    if thread_id:
        return str(thread_id)  # 重用现有线程
    return str(uuid.uuid4())   # 创建临时线程
```

### 🎯 前端调用决策机制

前端根据 **是否已有线程上下文** 决定使用哪个端点：

#### **情况一：使用 `/api/threads/{thread_id}/runs/stream`**
```javascript
// 已有 thread_id（如从 localStorage 或前一次响应获取）
const threadId = "abc-123-def-456";
fetch(`/api/threads/${threadId}/runs/stream`, {
  method: "POST",
  body: JSON.stringify({
    assistant_id: "lead_agent",
    input: { messages: [{ role: "user", content: "继续上次的话题" }] },
    // 不需要显式指定 thread_id
  })
});
```

**决策条件**：
- 用户正在**继续对话**（聊天界面）
- 需要**保持历史上下文**
- 前端已保存了 `thread_id`

#### **情况二：使用 `/api/runs/stream`**
```javascript
// 无状态调用，不关心线程
fetch("/api/runs/stream", {
  method: "POST",
  body: JSON.stringify({
    assistant_id: "lead_agent",
    input: { messages: [{ role: "user", content: "简单问答" }] },
    config: {
      configurable: {
        // 可选：如果提供 thread_id，会重用该线程
        thread_id: existing_thread_id
      }
    }
  })
});
```

**决策条件**：
- **一次性交互**（如工具调用、快速问答）
- **不需要历史记录**
- 希望**自动管理线程生命周期**

### 📊 功能对比表

| 特性 | `runs.py` (无状态) | `thread_runs.py` (有状态) |
|------|-------------------|---------------------------|
| **线程管理** | 自动创建临时线程，可选重用 | 必须提供现有 `thread_id` |
| **历史保持** | 可选（通过 `thread_id`） | 强制保持完整对话历史 |
| **API 复杂度** | 简单，隐藏线程细节 | 显式线程管理 |
| **适用前端组件** | 工具面板、快速问答 | 聊天界面、多轮对话 |
| **资源清理** | 临时线程可自动清理 | 线程持久化，需显式删除 |
| **并发控制** | 每个请求独立线程 | 可配置多任务策略 |

### 🔍 实际工作流程示例

**场景：用户打开聊天界面**
1. **首次打开** → 前端调用 `/api/runs/stream`（无 `thread_id`）
   - Gateway 生成新的 `thread_id = "temp-123"`
   - 返回响应头中包含 `Content-Location: /api/threads/temp-123/runs/...`
   - 前端保存 `thread_id` 到本地状态

2. **后续消息** → 前端调用 `/api/threads/temp-123/runs/stream`
   - 重用同一个线程，保持对话历史
   - Agent 能看到之前的消息上下文

3. **工具调用（无历史）** → 前端调用 `/api/runs/stream`
   - 不提供 `thread_id`，创建临时线程
   - 执行完成后临时线程可被清理

### 📝 日志增强示例

在 `runs.py` 的 `stateless_stream` 函数中添加详细的参数日志：

```python
async def stateless_stream(body: RunCreateRequest, request: Request) -> StreamingResponse:
    thread_id = _resolve_thread_id(body)
    logger.info(
        "[FLOW] ➡️  POST /api/runs/stream — thread_id=%s, assistant=%s, model=%s, stream_mode=%s\n"
        "  input=%s\n"
        "  command=%s\n"
        "  config=%s\n"
        "  context=%s\n"
        "  metadata=%s\n"
        "  interrupt_before=%s, interrupt_after=%s\n"
        "  on_disconnect=%s",
        thread_id,
        body.assistant_id,
        (body.context or {}).get("model_name"),
        body.stream_mode,
        body.input,
        body.command,
        body.config,
        body.context,
        body.metadata,
        body.interrupt_before,
        body.interrupt_after,
        body.on_disconnect,
    )
    # ... 后续代码
```

**日志参数说明**：
- `thread_id`: 从 `body.config.configurable.thread_id` 解析或自动生成
- `assistant`: `body.assistant_id` - 使用的代理/助手名称
- `model`: `body.context.model_name` - 大模型名称
- `stream_mode`: `body.stream_mode` - 流模式（values/updates/messages等）
- `input`: `body.input` - 图输入数据，通常是 `{messages: [...]}`
- `command`: `body.command` - LangGraph 命令对象
- `config`: `body.config` - RunnableConfig 配置覆盖
- `context`: `body.context` - DeerFlow 上下文覆盖
- `metadata`: `body.metadata` - 运行元数据
- `interrupt_before/after`: `body.interrupt_before/after` - 中断控制节点列表
- `on_disconnect`: `body.on_disconnect` - SSE 断开连接行为（cancel/continue）

### 💡 最佳实践建议

1. **统一前端调用策略**：
   - 聊天界面始终使用 Thread 模式
   - 工具调用使用 Stateless 模式
   - 从 `/api/runs/stream` 响应头中提取 `thread_id` 用于后续对话

2. **线程生命周期管理**：
   - 临时线程设置合理的 TTL（Time-To-Live）
   - 定期清理长时间未使用的线程
   - 提供线程归档和导出功能

3. **监控与调试**：
   - 启用详细的 `[FLOW]` 日志追踪
   - 监控线程数量和资源使用情况
   - 记录前端调用决策逻辑，便于问题排查
