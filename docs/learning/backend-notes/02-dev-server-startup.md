# make dev 启动了什么服务

---

`make dev` 只会启动 **一个服务**：

```bash
uv run langgraph dev --no-browser --allow-blocking --no-reload --n-jobs-per-worker 10
```

这是 **LangGraph Development Server**，监听端口 **2024**。

它会做以下事情：
1. 读取 `langgraph.json` 配置
2. 加载并注册 `deerflow.agents:make_lead_agent` 作为 graph factory
3. 启动内置的 Starlette HTTP 服务器
4. 提供 LangGraph Platform API（threads, runs, assistants 等接口）

**它不会启动 Gateway API。** Gateway 需要单独启动：

```bash
make gateway   # 启动 Gateway API，端口 8001
```

## 两个服务的关系

| 服务 | 命令 | 端口 | 作用 |
|------|------|------|------|
| LangGraph Server | `make dev` | 2024 | Agent 运行时，提供 LangGraph Platform API |
| Gateway API | `make gateway` | 8001 | 自定义 REST API，提供额外业务逻辑 |

前端默认通过 Nginx 代理访问这两个服务。如果只是学习后端流程，`make dev` 就够了。

## 端口 2024 是在哪里监听的

端口 2024 **不是项目代码写的**，而是 LangGraph CLI 框架的默认值。完整调用链：

```
Makefile: make dev
│  uv run langgraph dev --no-browser --allow-blocking --no-reload --port 2024（默认）
│
└→ langgraph_cli/cli.py: dev()
   │  @click.option("--port", default=2024, ...)
   │  config_json = validate_config_file("langgraph.json")
   │  graphs = config_json.get("graphs", {})
   │
   └→ langgraph_api/cli.py: run_server(host="127.0.0.1", port=2024, graphs=graphs, ...)
      │
      └→ uvicorn.run(
            "langgraph_api.server:app",  ← 框架内置的 Starlette ASGI 应用
            host="127.0.0.1",
            port=2024,                    ← 在这里绑定端口
            ...
         )
```

关键文件（全是框架代码）：
- `langgraph_cli/cli.py` — CLI 入口，`--port` 默认值 2024
- `langgraph_api/cli.py` — `run_server()` 函数，调用 `uvicorn.run()`
- `langgraph_api/server.py` — Starlette `app` 应用实例

所以端口 2024 的绑定完全由框架完成，项目代码没有任何端口相关的配置。如果想改端口，可以在 Makefile 中加参数：
```bash
uv run langgraph dev --port 3000 --no-browser ...
```

## LangSmith Studio 为什么能访问本机

URL: `https://smith.langchain.com/studio/thread?baseUrl=http://127.0.0.1:2024&...`

**这和 Nginx 无关。** 原理是：
1. 浏览器访问 `smith.langchain.com`，加载一个前端 SPA（单页应用）
2. SPA 的 JavaScript 读取 URL 中的 `baseUrl=http://127.0.0.1:2024` 参数
3. JS 直接从你的浏览器向 `http://127.0.0.1:2024` 发起 HTTP 请求
4. 请求直接到达你本机的 LangGraph Server，不经过任何代理

```
你的浏览器
  │  1. 加载页面: GET https://smith.langchain.com/studio/...
  │  2. JS 解析 baseUrl = http://127.0.0.1:2024
  │  3. 直接请求: POST http://127.0.0.1:2024/threads/xxx/runs/stream
  │     └→ 这是浏览器本地发的请求，直接连接你本机的 LangGraph Server
```

所以别人无法通过你的这个 URL 访问你的服务 —— 因为对他们来说 127.0.0.1 指向的是他们自己的机器。

## 如何通过 HTTP 访问

`make dev` 启动后，LangGraph Server 监听 `http://127.0.0.1:2024`。

### 常用接口

**1. 创建会话线程**
```bash
curl -X POST http://127.0.0.1:2024/threads \
  -H 'Content-Type: application/json' \
  -d '{}'
```
返回：`{"thread_id": "xxx-xxx-xxx", ...}`

**2. 发送消息（流式 SSE）**
```bash
curl -N -X POST http://127.0.0.1:2024/threads/{thread_id}/runs/stream \
  -H 'Content-Type: application/json' \
  -d '{
    "assistant_id": "lead_agent",
    "input": {"messages": [{"role": "user", "content": "你好"}]},
    "stream_mode": ["values"]
  }'
```
返回 SSE 流，实时看到 Agent 的回复。

**3. 查看已注册的 assistant**
```bash
curl -X POST http://127.0.0.1:2024/assistants/search \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**4. 查看线程列表**
```bash
curl -X POST http://127.0.0.1:2024/threads/search \
  -H 'Content-Type: application/json' \
  -d '{}'
```

这些是 LangGraph Platform 的标准 API。

### 通过浏览器 UI 访问

`make dev` 启动时会自动连接 [LangGraph Studio](https://smith.langchain.com/)（LangSmith 平台）。在浏览器中打开 https://smith.langchain.com/ 即可看到一个可视化的调试界面，可以：
- 直接与 Agent 对话
- 查看实时的 graph 执行过程
- 查看每一步的输入输出
- 查看 checkpoint 历史

这是调试和理解执行流程最直观的方式。
