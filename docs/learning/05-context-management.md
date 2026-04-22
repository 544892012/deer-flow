# 05 - 上下文管理

## 5 层上下文管理体系

```
第1层：对话消息上下文（短期） ── ThreadState.messages
   ↓ 消息过多时
第2层：上下文压缩 ── SummarizationMiddleware
   ↓ 持久化
第3层：检查点 ── Checkpointer (memory/sqlite/postgres)
   ↓ 异步提取
第4层：长期记忆 ── MemoryMiddleware → Queue → LLM → memory.json
   ↓ 注入
第5层：系统提示注入 ── <memory> 标签注入 system prompt
```

详细内容请参考主文档 `docs/BACKEND_DEEP_DIVE.md` 的附录 C。

## 关键配置

```yaml
# 上下文压缩
summarization:
  enabled: true
  trigger:
    - type: "tokens"
      value: 40000
  keep:
    type: "messages"
    value: 20

# 长期记忆
memory:
  enabled: true
  debounce_seconds: 30
  max_facts: 100
  max_injection_tokens: 2000
```

## 关键源码文件

| 文件 | 内容 |
|------|------|
| `config/summarization_config.py` | 压缩配置 |
| `agents/middlewares/memory_middleware.py` | 记忆中间件 |
| `agents/memory/updater.py` | LLM 记忆提取 |
| `agents/memory/queue.py` | 防抖队列 |
| `agents/memory/prompt.py` | 记忆提示词 + 注入格式化 |
| `agents/memory/storage.py` | 文件存储 + mtime 缓存 |
| `agents/checkpointer/async_provider.py` | 检查点工厂 |
| `agents/lead_agent/prompt.py` | 系统提示词组装 |
