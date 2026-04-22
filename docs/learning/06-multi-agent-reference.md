# 06 - 多 Agent 业务架构落地：可借鉴的技术细节

> 本文从 DeerFlow 源码中提炼出适用于多 Agent 业务系统的关键技术细节和设计模式。

## 一、架构层面

### 1.1 Agent 编排选型：ReAct + 中间件 vs DAG 图

**DeerFlow 的选择**：没有使用 LangGraph 的多节点 DAG，而是用 `create_agent` (ReAct) + 中间件链。

**借鉴价值**：
- ReAct 模式天然适合「一个主 Agent + 按需委托子任务」的场景
- 中间件链提供了比 DAG 更灵活的横切关注点管理
- 如果你的业务是「固定流程」（如审批流），考虑用 DAG；如果是「开放式对话+工具调用」，ReAct 更合适

**代码参考**：
```python
# 不写 StateGraph，而是用 create_agent
agent = create_agent(
    model=model,
    tools=tools,
    middleware=middlewares,    # 横切关注点在这里
    system_prompt=prompt,
    state_schema=ThreadState,
)
```

### 1.2 分层架构：可发布框架 vs 应用层

**DeerFlow 的选择**：Harness（框架，可发布）/ App（应用，不发布）双层分离。

**借鉴价值**：
- 如果你要做平台型产品，核心 Agent 逻辑做成独立包
- 通过 CI 防火墙（`test_harness_boundary.py`）强制边界
- 支持嵌入式（`DeerFlowClient`）和 HTTP（Gateway）两种接入方式

### 1.3 多服务组合：Nginx 统一入口

**DeerFlow 的选择**：LangGraph Server + Gateway + Frontend 由 Nginx 聚合。

**借鉴价值**：
- Agent 运行时（LangGraph）和管理 API（Gateway）分离
- 前端通过相对路径访问，Nginx 代理，避免 CORS 问题
- 多个后端服务对外呈现为单端口

---

## 二、多 Agent 协作模式

### 2.1 主从委托模式

**DeerFlow 的实现**：Lead Agent → `task` 工具 → SubagentExecutor → 子 Agent

**关键设计决策**：

| 决策 | DeerFlow 的选择 | 理由 |
|------|-----------------|------|
| 子 Agent 能否嵌套？ | 不能（`disallowed_tools=["task"]`） | 防止递归爆炸 |
| 子 Agent 共享什么？ | 沙箱 + 线程目录 | 共享文件但独立对话上下文 |
| 子 Agent 模型选择？ | 默认继承父级（`model="inherit"`） | 也支持独立配置 |
| 子 Agent 如何返回？ | 收集所有 AI 消息，返回最终文本 | 保留完整推理链 |

### 2.2 并发控制

**DeerFlow 的实现**：

```
限制层1：SubagentLimitMiddleware（after_model 截断）
    ↓ 限制 LLM 单次产出的 task 调用数 ≤ 3
限制层2：双线程池（scheduler 3 + execution 3）
    ↓ 物理并发限制
限制层3：超时保护（默认 15 分钟）
    ↓ Future.result(timeout=900)
限制层4：轮询安全网（polling_limit = timeout/5 + 60/5）
```

**借鉴价值**：
- **不信任 LLM 的自律**：提示词说「最多 3 个」，但用中间件强制截断
- **双线程池**：调度和执行分离，调度线程不被执行阻塞
- **多层超时**：线程池超时 + 轮询超时 + 后台清理

### 2.3 SSE 实时事件流

```python
writer = get_stream_writer()
writer({"type": "task_started", "task_id": task_id, "description": description})

# 轮询中发现新消息
writer({"type": "task_running", "task_id": task_id, "message": ai_message})

# 完成
writer({"type": "task_completed", "task_id": task_id, "result": result})
```

**借鉴价值**：
- 子任务进度通过自定义 SSE 事件实时推送到前端
- 前端可以展示「子任务 A 执行中... 子任务 B 已完成」的进度条
- 事件类型清晰：started/running/completed/failed/timed_out

---

## 三、沙箱与安全

### 3.1 虚拟路径抽象

**核心思想**：Agent 始终使用虚拟路径，后端透明翻译。

**借鉴价值**：
- 沙箱模式切换（本地/Docker/K8s）对 Agent 完全透明
- 输出脱敏：执行结果中的物理路径自动替换回虚拟路径
- 路径穿越防护：`_reject_path_traversal` 拒绝 `..`

### 3.2 权限分级

```
/mnt/user-data/*     → 读写（Agent 主工作区）
/mnt/skills/*        → 只读（技能文件）
/mnt/acp-workspace/* → 只读（ACP Agent 输出）
其他路径              → 禁止（除系统路径 /bin, /usr/bin 等）
```

### 3.3 懒初始化

```python
# 沙箱不在 before_agent 中创建，而是首次工具调用时
def ensure_sandbox_initialized(runtime):
    if runtime.state.get("sandbox"): return existing
    sandbox_id = provider.acquire(thread_id)
    runtime.state["sandbox"] = {"sandbox_id": sandbox_id}
```

**借鉴价值**：纯对话不使用工具时，不创建沙箱，节省资源。

---

## 四、中间件设计模式

### 4.1 有序中间件链

**DeerFlow 的实现**：15 个中间件，严格排序。

**借鉴价值**：

```python
def _build_middlewares(config):
    middlewares = build_runtime_middlewares()       # 基础层
    middlewares.append(SummarizationMiddleware())   # 上下文压缩
    middlewares.append(TitleMiddleware())           # 标题生成
    middlewares.append(MemoryMiddleware())          # 记忆
    # ...
    middlewares.append(ClarificationMiddleware())   # 必须最后
    return middlewares
```

- 每个中间件关注一个横切关注点
- `before_agent` / `after_agent` / `before_model` / `after_model` 四个切面
- 顺序依赖用注释明确标注

### 4.2 主 Agent 与子 Agent 差异化中间件

```python
# 主 Agent：完整链
build_lead_runtime_middlewares()
# → ThreadData, Uploads, Sandbox, DanglingToolCall, Guardrail, ...

# 子 Agent：精简链
build_subagent_runtime_middlewares()
# → ThreadData, Sandbox, ToolErrorHandling（无 Uploads, 无 DanglingToolCall）
```

**借鉴价值**：子 Agent 不需要处理上传文件、不需要修复悬空工具调用。

---

## 五、配置驱动设计

### 5.1 反射加载

```python
# config.yaml
tools:
  - use: "deerflow.sandbox.tools:bash_tool"
sandbox:
  use: "deerflow.sandbox.local:LocalSandboxProvider"

# 运行时
tool = resolve_variable("deerflow.sandbox.tools:bash_tool", BaseTool)
cls = resolve_class("deerflow.sandbox.local:LocalSandboxProvider", SandboxProvider)
```

**借鉴价值**：
- 工具、沙箱 Provider、存储后端都通过配置文件声明
- 新增实现只需要在 `config.yaml` 中声明路径，无需改核心代码
- `resolve_variable` 和 `resolve_class` 统一处理动态加载

### 5.2 热重载

```python
def get_app_config():
    if file_mtime_changed:  # 基于文件修改时间
        reload_config()
    return cached_config
```

### 5.3 环境变量展开

```yaml
api_key: $DEEPSEEK_API_KEY  # 自动读取 os.environ
```

---

## 六、记忆与状态持久化

### 6.1 异步防抖记忆

```
对话完成 → MemoryMiddleware.after_agent()
  ↓ 过滤（只保留用户消息 + 最终 AI 回复）
  ↓ MemoryQueue.add()（30秒防抖，按线程去重）
  ↓ 后台线程 LLM 提取
  ↓ 原子写入 memory.json（临时文件 + rename）
  ↓ 下次对话注入 <memory> 标签
```

**借鉴价值**：
- **不阻塞主对话**：记忆更新完全异步
- **防抖合并**：同线程 30 秒内的多次对话只更新一次
- **原子写入**：避免写入中断导致数据损坏
- **上传路径清洗**：避免跨会话幻觉

### 6.2 多后端检查点

```
InMemorySaver → 开发/测试
AsyncSqliteSaver → 单机部署
AsyncPostgresSaver → 生产/多实例
```

---

## 七、错误处理与容错

### 7.1 工具错误转消息

`ToolErrorHandlingMiddleware` 将工具异常转换为 `ToolMessage` 返回给 LLM，而不是让整个图崩溃。

### 7.2 悬空工具调用修复

`DanglingToolCallMiddleware` 为用户中断导致的无响应 tool_call 插入占位 ToolMessage。

### 7.3 循环检测

`LoopDetectionMiddleware` 检测重复的工具调用模式并打断。

### 7.4 对话中断与恢复

```
Agent 调用 ask_clarification
  → ClarificationMiddleware 拦截
  → Command(goto=END) 中断图
  → LangGraph 保存检查点
  → 等待用户回复
  → 从检查点恢复
```

---

## 八、二次开发检查清单

准备基于 DeerFlow 做多 Agent 业务系统时，按以下清单评估：

### 必须了解的

- [ ] 中间件链的顺序和每个中间件的职责
- [ ] `ThreadState` 的字段和自定义 reducer
- [ ] `get_available_tools()` 的工具加载逻辑
- [ ] 虚拟路径翻译机制
- [ ] `SubagentExecutor` 的执行模型

### 常见改造点

- [ ] **添加新工具**：在 `tools/builtins/` 或 `community/` 下创建，`config.yaml` 中声明
- [ ] **添加新中间件**：实现 `AgentMiddleware`，在 `_build_middlewares()` 中插入
- [ ] **添加新子代理类型**：在 `subagents/builtins/` 下创建 `SubagentConfig`，注册到 `BUILTIN_SUBAGENTS`
- [ ] **更换沙箱实现**：实现 `SandboxProvider`，在 `config.yaml` 中声明 `sandbox.use`
- [ ] **添加新 API 路由**：在 `app/gateway/routers/` 下创建，`app.py` 中 `include_router`
- [ ] **添加新 IM 频道**：实现 `Channel` 基类，在 `service.py` 中注册
- [ ] **自定义记忆存储**：实现 `MemoryStorage` 抽象类，在 `config.yaml` 中声明

### 注意事项

- Harness 层禁止 import App 层（CI 有测试）
- `ClarificationMiddleware` 必须是最后一个中间件
- 子 Agent 的 `disallowed_tools` 至少包含 `"task"` 防止递归
- 本地沙箱默认禁止 host bash，需要 `sandbox.allow_host_bash: true`
- 记忆更新是异步的，不会立即反映在当前对话中

---

## 九、DeerFlow 的设计原则总结

| 原则 | 体现 |
|------|------|
| **配置驱动** | 工具、沙箱、模型、存储后端都通过 YAML 声明 |
| **反射加载** | `resolve_variable` / `resolve_class` 动态实例化 |
| **分层解耦** | Harness/App 分离，CI 防火墙 |
| **中间件模式** | 横切关注点通过有序中间件链管理 |
| **虚拟路径** | Agent 与物理路径解耦，沙箱模式透明切换 |
| **异步不阻塞** | 记忆更新、子 Agent 执行都是异步 |
| **防御性设计** | 路径校验、输出脱敏、循环检测、多层超时 |
| **懒初始化** | 沙箱按需创建，MCP 工具按需加载 |
