# DeerFlow 后端学习文档

> 基于 DeerFlow 2.0 源码的系统性学习资料，适合团队快速上手和二次开发。

## 正式学习路径

| 文档 | 内容 | 适合谁 |
|------|------|--------|
| [01-架构总览](./01-architecture-overview.md) | 整体架构图、技术栈、目录结构、Harness/App 分层 | 所有人，首先阅读 |
| [02-Agent 系统与中间件](./02-agent-and-middleware.md) | Lead Agent 构建、ThreadState、中间件链、工具系统 | 后端开发者 |
| [03-Sub-Agents 多代理协作](./03-sub-agents.md) | 子代理调用全流程、并发模型、SSE 事件、源码级解析 | 重点学习 |
| [04-沙箱与文件系统](./04-sandbox-and-filesystem.md) | 沙箱抽象、Provider 模式、虚拟路径翻译、安全策略 | 重点学习 |
| [05-上下文管理](./05-context-management.md) | 5 层上下文体系、压缩、检查点、长期记忆、注入 | 后端开发者 |
| [06-多Agent架构落地借鉴](./06-multi-agent-reference.md) | 可借鉴的技术细节、设计模式、架构决策清单 | 架构师/Tech Lead |
| [07-请求生命周期](./07-request-lifecycle.md) | 从 HTTP 请求到 Agent Loop 的完整调用链路 | 所有人 |
| [08-技术分享提纲](./08-deerflow-tech-sharing-outline.md) | 面向团队技术分享的主题定位、逐页提纲、讲稿骨架、Demo 脚本 | 分享者/Tech Lead |

## 源码深读笔记

`backend-notes/` 收纳从后端源码阅读过程中拆出的专题笔记，适合在读完正式学习路径后按问题深入追踪。

| 专题 | 内容 |
|------|------|
| [后端学习笔记索引](./backend-notes/README.md) | 调用链路、启动流程、MCP、Agent 生命周期、ReAct、Subagent、Skills、Sandbox、API、System Prompt |

## 快速开始

1. 先读 [01-架构总览](./01-architecture-overview.md) 建立全局认知
2. 再读 [02-Agent 系统与中间件](./02-agent-and-middleware.md) 理解核心执行流
3. 重点学习 [03-Sub-Agents](./03-sub-agents.md) 和 [04-沙箱](./04-sandbox-and-filesystem.md)
4. 准备做项目时阅读 [06-多Agent架构落地借鉴](./06-multi-agent-reference.md)
5. 准备团队分享时使用 [08-技术分享提纲](./08-deerflow-tech-sharing-outline.md)
6. 需要源码级排查时进入 [backend-notes](./backend-notes/README.md) 按专题查阅
