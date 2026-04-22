# 记忆系统改进 — 摘要

## 同步说明（2026-03-10）

本摘要与 `main` 分支实现保持一致。  
基于 TF-IDF / 上下文感知的检索为 **计划中**，尚未合入。

## 已实现

- 在记忆注入中使用 `tiktoken` 进行准确 token 计数。
- 事实（facts）注入到 `<memory>` 提示内容中。
- 事实按置信度排序，并受 `max_injection_tokens` 限制。

## 计划中（尚未合入）

- 基于近期对话上下文的 TF-IDF 余弦相似度召回。
- `format_memory_for_injection` 的 `current_context` 参数。
- 加权排序（`similarity` + `confidence`）。
- 上下文感知事实筛选的运行时抽取/注入流程。

## 为何需要本次同步

此前文档将 TF-IDF 行为描述为已实现，与 `main` 上的代码不符。  
该不一致记录在 issue `#1059`。

## 当前 API 形态

```python
def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
```

`main` 上目前 **没有** `current_context` 参数。

## 验证入口

- 实现：`packages/harness/deerflow/agents/memory/prompt.py`
- 提示组装：`packages/harness/deerflow/agents/lead_agent/prompt.py`
- 回归测试：`backend/tests/test_memory_prompt_injection.py`
