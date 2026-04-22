# Slide Deck Outline

**Topic**: DeerFlow 后端架构深度解析
**Style**: blueprint
**Dimensions**: grid + cool + technical + balanced
**Audience**: Intermediate developers
**Language**: zh (Chinese Simplified)
**Slide Count**: 15 slides
**Generated**: 2026-04-07 16:00

---

<STYLE_INSTRUCTIONS>
Design Aesthetic: Clean, structured visual metaphors using blueprints, diagrams, and schematics. Precise, analytical and aesthetically refined. Information presented in triptych or grid-based layouts with engineering precision. Technical grid overlay with cool analytical blues and grays.

Background:
  Texture: Subtle grid overlay, light engineering paper feel
  Base Color: Blueprint Off-White (#FAF8F5)

Typography:
  Headlines: Bold, precise clean sans-serif with technical, authoritative presence. Perfect geometric letterforms with consistent spacing.
  Body: Elegant serif for body explanations. Clean, readable at smaller sizes. Professional editorial quality.

Color Palette:
  Primary Text: Deep Slate (#334155) - Headlines, body text
  Background: Blueprint Paper (#FAF8F5) - Primary background
  Grid: Light Gray (#E5E5E5) - Background grid lines
  Accent 1: Engineering Blue (#2563EB) - Key elements, highlights
  Accent 2: Navy Blue (#1E3A5F) - Supporting elements
  Accent 3: Light Blue (#BFDBFE) - Backgrounds, fills
  Warning: Amber (#F59E0B) - Warnings, emphasis points

Visual Elements:
  - Precise lines with consistent stroke weights
  - Technical schematics and clean vector graphics
  - Thin line work in technical drawing style
  - Connection lines use straight lines or 90-degree angles only
  - Data visualization with clean, minimal charts
  - Dimension lines and measurement indicators
  - Cross-section style diagrams

Density Guidelines:
  - Content per slide: 2-3 key points, moderate detail
  - Whitespace: Generous margins, balanced visual weight
  - Element count: 3-5 visual elements per slide

Style Rules:
  Do: Maintain consistent line weights, use grid alignment, keep color palette restrained, create clear visual hierarchy through scale, use geometric precision for all shapes
  Don't: Use hand-drawn or organic shapes, add decorative flourishes, use curved connection lines, include photographic elements, add slide numbers, footers, or logos
</STYLE_INSTRUCTIONS>

---

## Slide 1 of 15

**Type**: Cover
**Filename**: 01-slide-cover.png

// NARRATIVE GOAL
设定技术分享的基调——这是一次关于现代 AI Agent 框架后端架构的深度技术解析。

// KEY CONTENT
Headline: DeerFlow 后端架构深度解析
Sub-headline: 工厂模式 + 框架运行时 — 构建可扩展的多 Agent 协作系统

// VISUAL
中央是一个精密的蓝图风格技术图纸，展示一个简化的 Agent 系统蓝图轮廓。背景是浅色工程图纸网格。标题以工程蓝色为主色调，具有权威感。

// LAYOUT
Layout: title-hero
大标题居中偏上，副标题在下方。底部有细线装饰。

---

## Slide 2 of 15

**Type**: Content
**Filename**: 02-slide-project-overview.png

// NARRATIVE GOAL
让听众快速了解 DeerFlow 是什么、核心技术栈。

// KEY CONTENT
Headline: 项目全景：字节跳动开源的 AI Agent 框架
Sub-headline: Python + LangGraph + LangChain + FastAPI
Body:
- 多 Agent 协作框架，支持工具调用、代码执行、记忆管理
- 后端双服务架构：LangGraph Server (2024) + Gateway API (8001)
- 核心思想：后端只负责"组装 Agent"，运行时交给框架

// VISUAL
蓝图风格的系统全景图，展示前端、Nginx、LangGraph Server、Gateway API 四个模块的连接关系。每个模块用方框表示，端口号标注在旁。

// LAYOUT
Layout: hub-spoke
中央是 DeerFlow 核心，四周辐射出关键技术组件。

---

## Slide 3 of 15

**Type**: Content
**Filename**: 03-slide-call-chain.png

// NARRATIVE GOAL
展示请求从 HTTP 入口到 ReAct 循环的完整路径——这是理解后端的核心主线。

// KEY CONTENT
Headline: 一条主线贯穿全局：核心调用链
Sub-headline: 从 HTTP 请求到 ReAct 循环的 6 步旅程
Body:
- HTTP 请求 → thread_runs.py（入口）
- start_run() → services.py（编排）
- run_agent() → worker.py（执行器）
- make_lead_agent() → agent.py（工厂函数）
- graph.astream() → ReAct 循环开始
- 逐 chunk 推送 → SSE 实时响应

// VISUAL
垂直的蓝图式流程图，6 个步骤从上到下排列，每步标注对应文件名。用工程蓝线条连接，右侧标注"项目代码"和"框架代码"的分界线。

// LAYOUT
Layout: linear-progression
从上到下的线性流程，清晰展示调用层次。

---

## Slide 4 of 15

**Type**: Content
**Filename**: 04-slide-factory-pattern.png

// NARRATIVE GOAL
解释 make_lead_agent 工厂模式——后端代码的核心所在。

// KEY CONTENT
Headline: 工厂函数：make_lead_agent 的 5 步组装
Sub-headline: 每次请求动态构建全新 Agent 实例
Body:
- 解析配置 → model_name, thinking_enabled, subagent_enabled
- 构建 Middleware 链 → 12-17 个中间件
- 加载工具 → Config + 内置 + MCP + ACP
- 生成系统提示词 → apply_prompt_template
- create_agent() → 返回 CompiledStateGraph

// VISUAL
蓝图风格的装配流水线图，5 个步骤依次排列，每步用技术图标表示。最终输出一个标注 "CompiledStateGraph" 的成品。

// LAYOUT
Layout: linear-progression
水平装配线，从左到右展示组装过程。

---

## Slide 5 of 15

**Type**: Content
**Filename**: 05-slide-agent-lifecycle.png

// NARRATIVE GOAL
澄清 Agent 的生命周期——每请求创建 vs 共享组件。

// KEY CONTENT
Headline: 每请求新建 Agent，但不是所有东西都重建
Sub-headline: 理解"按请求创建"与"共享缓存"的边界
Body:
- 请求级：CompiledStateGraph、Middleware 实例、LLM Model
- 缓存共享：MCP 工具列表（mtime 热更新）
- 进程级共享：Checkpointer、Store
- 对话连续性：Thread + Checkpointer 重建上下文

// VISUAL
蓝图风格的双层架构图。上层是"请求级"（每次新建），下层是"共享级"（跨请求复用），用虚线分隔。

// LAYOUT
Layout: binary-comparison
左侧"请求级"，右侧"共享级"，清晰对比。

---

## Slide 6 of 15

**Type**: Content
**Filename**: 06-slide-react-loop.png

// NARRATIVE GOAL
揭示 ReAct 循环的内部结构——这是理解 Agent 行为的关键。

// KEY CONTENT
Headline: ReAct 循环：model ↔ tools 的交替执行
Sub-headline: LangGraph StateGraph 驱动的推理-行动循环
Body:
- model 节点：调用 LLM → 返回 AIMessage（可能含 tool_calls）
- 条件边判断：有 tool_calls → 执行工具；无 → 结束
- tools 节点（ToolNode）：并行执行，返回 ToolMessage
- 循环直到 LLM 不再调用工具

// VISUAL
蓝图风格的循环流程图。model 和 tools 两个核心节点通过条件边连接，形成循环。条件边用菱形判断符号表示。

// LAYOUT
Layout: circular-flow
环形流程，model → 条件判断 → tools → model，突出循环本质。

---

## Slide 7 of 15

**Type**: Content
**Filename**: 07-slide-stategraph-nodes.png

// NARRATIVE GOAL
展示完整的 StateGraph 节点结构，让听众理解 Middleware 如何嵌入图中。

// KEY CONTENT
Headline: StateGraph 完整节点图：15 个节点的精密编排
Sub-headline: Middleware 作为图节点参与 ReAct 循环
Body:
- 入口（一次）：ThreadData → Uploads → Sandbox
- 循环前：Summarization → ViewImage → model
- 循环后：Title → LoopDetection → 条件边
- 出口（一次）：Memory → Sandbox → END
- 内联节点：wrap_model_call / wrap_tool_call 不生成独立节点

// VISUAL
完整的蓝图风格 StateGraph ASCII 图，清晰展示所有节点和边的连接关系。入口、循环体、出口用不同颜色区分。

// LAYOUT
Layout: linear-progression
垂直方向的完整图流程，从 START 到 END。

---

## Slide 8 of 15

**Type**: Content
**Filename**: 08-slide-middleware-system.png

// NARRATIVE GOAL
深入 Middleware 系统——两种图表现形式和洋葱模型。

// KEY CONTENT
Headline: Middleware 双模式：图节点 vs 洋葱包裹
Sub-headline: 17 个中间件的精密协作机制
Body:
- 图节点模式：before_agent / before_model / after_model / after_agent → 独立执行步骤
- 内联模式：wrap_model_call / wrap_tool_call → 洋葱模型包裹
- 执行顺序：Dangling → LLMError → Todo → Deferred → base_handler
- 返回顺序：反向传播结果

// VISUAL
左侧展示图节点的链式连接，右侧展示 wrap_model_call 的洋葱层级示意图。两种模式并排对比。

// LAYOUT
Layout: split-screen
左半"图节点模式"，右半"洋葱模型"，清晰对比两种机制。

---

## Slide 9 of 15

**Type**: Content
**Filename**: 09-slide-tool-system.png

// NARRATIVE GOAL
展示四类工具体系和 MCP 工具的动态加载机制。

// KEY CONTENT
Headline: 四类工具汇聚：从静态配置到动态 MCP
Sub-headline: get_available_tools() — 工具的编排中心
Body:
- Config 工具：config.yaml 声明，反射加载
- 内置工具：硬编码（present_file, ask_clarification）
- MCP 工具：懒加载 + mtime 缓存 + 热更新
- ACP 工具：外部 Agent 调用

// VISUAL
蓝图风格的四路汇聚图。四条管道从四个方向汇入中心的 "get_available_tools()" 汇聚点，最终输出 "all_tools" 列表。

// LAYOUT
Layout: hub-spoke
中心是工具编排中心，四个方向是四类工具来源。

---

## Slide 10 of 15

**Type**: Content
**Filename**: 10-slide-llm-decision.png

// NARRATIVE GOAL
解释 LLM 如何自主决定调用工具——消除"框架决定调用"的误解。

// KEY CONTENT
Headline: 决策权在 LLM：工具调用不是框架逻辑
Sub-headline: bind_tools → LLM 推理 → 检查 tool_calls
Body:
- 调用前：bind_tools() 将工具 schema 序列化到 API 请求
- LLM 自主决定：基于对话历史 + 系统提示 + 工具 schema
- 调用后：框架检查 AIMessage.tool_calls 字段
- 框架只负责"问"和"执行"，不负责"决定"

// VISUAL
三步流程图：① 绑定工具 schema → ② LLM 大脑（决策中心）→ ③ 检查 tool_calls 结果。中间的 LLM 大脑用蓝色高亮强调。

// LAYOUT
Layout: linear-progression
水平三步，LLM 决策居中放大。

---

## Slide 11 of 15

**Type**: Content
**Filename**: 11-slide-subagent.png

// NARRATIVE GOAL
展示多 Agent 协作机制——主 Agent 如何委托子代理。

// KEY CONTENT
Headline: 子代理协作：task 工具驱动的后台执行
Sub-headline: 独立 ReAct 循环 + 三层并行控制
Body:
- 主 Agent 通过 task 工具委托，子代理在后台线程池运行
- 子代理：简化 middleware、无 checkpointer、thinking=False
- 三层控制：LLM 层截断(3) + 调度池 + 执行池
- 防递归：子代理工具列表不含 task

// VISUAL
蓝图风格的主从架构图。主 Agent 在上方，通过 task 工具向下分发到三个并行的子代理执行槽。每个槽内有独立的 ReAct 循环示意。

// LAYOUT
Layout: tree-branching
主 Agent 在顶部，向下分支出子代理。

---

## Slide 12 of 15

**Type**: Content
**Filename**: 12-slide-sandbox.png

// NARRATIVE GOAL
解释沙箱系统如何隔离代码执行环境。

// KEY CONTENT
Headline: Sandbox 执行隔离：虚拟路径 + Provider 模式
Sub-headline: 本地开发与生产环境的双轨方案
Body:
- LocalSandbox：subprocess 执行，路径校验隔离，默认禁用 bash
- AioSandbox：Docker 容器隔离，默认启用 bash
- 虚拟路径映射：/mnt/user-data/ → 真实文件系统
- 懒初始化 + SandboxMiddleware 管理生命周期

// VISUAL
蓝图风格的双层对比图。上层 LocalSandbox（开发环境），下层 AioSandbox（Docker 容器）。两层都显示虚拟路径到真实路径的映射箭头。

// LAYOUT
Layout: binary-comparison
上下对比两种 Provider 实现。

---

## Slide 13 of 15

**Type**: Content
**Filename**: 13-slide-streaming.png

// NARRATIVE GOAL
展示流式输出机制——从 astream 到 SSE。

// KEY CONTENT
Headline: 实时流式输出：astream → StreamBridge → SSE
Sub-headline: 每个 ReAct 节点执行即推送
Body:
- agent.astream() 每产生 chunk → bridge.publish()
- StreamBridge：内存 pub/sub（发布者=worker，消费者=SSE）
- 4 种 stream_mode：values / updates / messages / debug
- 支持中断（abort_event）

// VISUAL
蓝图风格的管道流图。从 agent.astream 到 StreamBridge 到 SSE Response 的三段管道。管道上标注不同的 stream_mode。

// LAYOUT
Layout: linear-progression
水平管道流，从源到终端。

---

## Slide 14 of 15

**Type**: Content
**Filename**: 14-slide-debugging.png

// NARRATIVE GOAL
提供实用的调试手段，让听众能立即上手。

// KEY CONTENT
Headline: 调试工具箱：5 种方式观察 Agent 行为
Sub-headline: 从日志到可视化，按场景选择最优方案
Body:
- [FLOW] 日志：13 个文件内置，搜索 [FLOW] 即可
- [STREAM] chunk 日志：追踪 ReAct 循环进度
- stream_mode="debug"：零配置，最详细的节点级信息
- LangSmith/Langfuse：完整链路追踪 + Web UI
- LangGraph Studio：可视化图执行过程

// VISUAL
蓝图风格的仪表板布局。5 个工具以图标+名称的方式排列，每个旁边标注信息详细度星级。

// LAYOUT
Layout: icon-grid
5 个调试工具均匀排列，图标+说明。

---

## Slide 15 of 15

**Type**: Back Cover
**Filename**: 15-slide-back-cover.png

// NARRATIVE GOAL
用一句核心总结收尾，留下深刻印象。

// KEY CONTENT
Headline: 工厂模式 + 框架运行时 = 可扩展的 Agent 架构
Body:
- 后端只负责"组装 Agent"（make_lead_agent）
- 框架驱动 model → tools → model → ... 直到结束
- 典型的声明式编排 + 命令式执行分离

// VISUAL
简洁的蓝图风格收尾图。中央是 make_lead_agent → StateGraph → ReAct Loop 的精简示意，四周留白，给人以完整闭合感。

// LAYOUT
Layout: title-hero
大号核心结论居中，简洁有力。
