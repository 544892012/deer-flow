# 02 - Agent 系统与中间件

## Agent 编排模型

DeerFlow 不手写 LangGraph 多节点 DAG 图，编排模型为：

```
单主 ReAct Agent + 有序中间件链 + 可选子 Agent 委托
```

流程控制编码在三个层面：
1. **`create_agent`**：LangChain 提供的 ReAct Agent 构造器
2. **中间件链**：15 个有序 `AgentMiddleware`
3. **工具行为**：如 `task` 触发子 Agent，`ask_clarification` 中断对话

## Lead Agent 构建流程

```python
# agents/lead_agent/agent.py → make_lead_agent()

def make_lead_agent(config: RunnableConfig):
    # 1. 解析运行时参数（thinking、model、subagent 等）
    # 2. 解析模型（支持 per-agent 配置覆盖）
    # 3. 构建中间件链 → _build_middlewares()
    # 4. 加载工具集 → get_available_tools()
    # 5. 生成系统提示词 → apply_prompt_template()
    # 6. 创建 Agent → create_agent(model, tools, middleware, system_prompt, state_schema)
    return create_agent(...)
```

入口注册在 `backend/langgraph.json`：
```json
{
  "graphs": {
    "lead_agent": "deerflow.agents:make_lead_agent"
  }
}
```

## ThreadState 状态模式

```python
class ThreadState(AgentState):
    sandbox: SandboxState | None         # 沙箱状态
    thread_data: ThreadDataState | None  # 线程目录路径
    title: str | None                    # 自动生成的标题
    artifacts: list[str]                 # 产物文件（去重合并）
    todos: list | None                   # Todo 列表
    uploaded_files: list[dict] | None    # 上传文件
    viewed_images: dict[str, ViewedImageData]  # 图像缓存
```

## 中间件链执行顺序

```
请求 → [1] ThreadData → [2] Uploads → [3] Sandbox →
       [4] DanglingToolCall → [5] Guardrail → [6] Summarization →
       [7] TodoList → [8] TokenUsage → [9] Title → [10] Memory →
       [11] ViewImage → [12] DeferredToolFilter → [13] SubagentLimit →
       [14] LoopDetection → [15] Clarification → LLM 调用
```

关键约束：
- **ClarificationMiddleware 必须最后**：它会中断图执行
- **ThreadData 必须在 Sandbox 前**：沙箱需要 thread_id
- **Memory 在 Title 后**：标题生成后再记忆

## 工具系统

`get_available_tools()` 汇总所有工具：

```
config.yaml 声明的工具（反射加载）
  + 内置工具（present_file, ask_clarification）
  + 视觉工具（view_image，仅 Vision 模型）
  + 子代理工具（task，仅启用时）
  + MCP 工具（extensions_config.json，带 mtime 缓存）
  + ACP 工具（外部 Agent 调用）
```

## Gateway API 路由

| 路由 | 说明 |
|------|------|
| `/api/models` | 模型管理 |
| `/api/mcp/config` | MCP 配置 |
| `/api/skills` | 技能管理 |
| `/api/memory` | 记忆管理 |
| `/api/threads/{id}/uploads` | 文件上传 |
| `/api/threads/{id}/artifacts` | 产物获取 |
| `/api/threads/{id}/suggestions` | 后续问题建议 |
| `/api/agents` | 自定义 Agent CRUD |
| `/health` | 健康检查 |
