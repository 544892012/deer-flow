# 记忆系统改进

本文档记录记忆注入行为与路线图状态。

## 状态（截至 2026-03-10）

已在 `main` 中实现：
- 在 `format_memory_for_injection` 中通过 `tiktoken` 进行准确 token 计数。
- 事实（facts）注入到提示中的记忆上下文。
- 事实按置信度（降序）排序。
- 注入遵守 `max_injection_tokens` 预算。

计划中 / 尚未合并：
- 基于 TF-IDF 相似度的事实检索。
- 用于上下文感知打分的 `current_context` 输入。
- 可配置的相似度/置信度权重（`similarity_weight`、`confidence_weight`）。
- 在每次模型调用前进行上下文感知检索的中间件/运行时接线。

## 当前行为

当前函数：

```python
def format_memory_for_injection(memory_data: dict[str, Any], max_tokens: int = 2000) -> str:
```

当前注入格式：
- 来自 `user.*.summary` 的 `User Context` 小节
- 来自 `history.*.summary` 的 `History` 小节
- 来自 `facts[]` 的 `Facts` 小节，按置信度排序，在 token 预算内依次追加

Token 计数：
- 在可用时使用 `tiktoken`（`cl100k_base`）
- 若 tokenizer 导入失败则回退为 `len(text) // 4`

## 已知缺口

本文档早期版本曾把 TF-IDF/上下文感知检索描述为已上线能力。
这与 `main` 实际情况不符，容易造成误解。

相关 issue：`#1059`

## 路线图（计划）

计划中的打分策略：

```text
final_score = (similarity * 0.6) + (confidence * 0.4)
```

计划中的集成形态：
1. 从过滤后的用户/最终助手轮次中提取近期对话上下文。
2. 计算每条事实与当前上下文之间的 TF-IDF 余弦相似度。
3. 按加权分数排序，在 token 预算内注入。
4. 若上下文不可用，则回退为仅按置信度排序。

## 校验

当前回归覆盖包括：
- 记忆注入输出中包含 facts
- 按置信度排序
- 在 token 预算限制下包含 facts

测试：
- `backend/tests/test_memory_prompt_injection.py`
