# 对话摘要

DeerFlow 包含自动对话摘要功能，用于处理接近模型 token 上限的长对话。启用后，系统会自动压缩较早的消息，同时保留近期上下文。

## 概述

摘要功能使用 LangChain 的 `SummarizationMiddleware` 监控对话历史，并在达到可配置阈值时触发摘要。激活后会：

1. 实时监控消息的 token 数量
2. 在达到阈值时触发摘要
3. 保留近期消息，对较早的对话进行摘要
4. 将 AI/Tool 消息成对保持在一起，以维持上下文连贯
5. 将摘要重新注入对话

## 配置

摘要在 `config.yaml` 的 `summarization` 键下配置：

```yaml
summarization:
  enabled: true
  model_name: null  # Use default model or specify a lightweight model

  # Trigger conditions (OR logic - any condition triggers summarization)
  trigger:
    - type: tokens
      value: 4000
    # Additional triggers (optional)
    # - type: messages
    #   value: 50
    # - type: fraction
    #   value: 0.8  # 80% of model's max input tokens

  # Context retention policy
  keep:
    type: messages
    value: 20

  # Token trimming for summarization call
  trim_tokens_to_summarize: 4000

  # Custom summary prompt (optional)
  summary_prompt: null
```

### 配置项说明

#### `enabled`
- **类型**：布尔值
- **默认值**：`false`
- **说明**：是否启用自动摘要

#### `model_name`
- **类型**：字符串或 null
- **默认值**：`null`（使用默认模型）
- **说明**：用于生成摘要的模型。建议使用轻量、成本较低的模型，如 `gpt-4o-mini` 或同等能力模型。

#### `trigger`
- **类型**：单个 `ContextSize` 或 `ContextSize` 对象列表
- **必填**：启用时至少需指定一个触发条件
- **说明**：触发摘要的阈值。采用 **或** 逻辑——**任意** 一个阈值满足即会执行摘要。

**ContextSize 类型：**

1. **基于 token 的触发**：token 数达到指定值时激活
   ```yaml
   trigger:
     type: tokens
     value: 4000
   ```

2. **基于消息条数的触发**：消息条数达到指定值时激活
   ```yaml
   trigger:
     type: messages
     value: 50
   ```

3. **基于比例的触发**：token 用量达到模型最大输入 token 的某百分比时激活
   ```yaml
   trigger:
     type: fraction
     value: 0.8  # 80% of max input tokens
   ```

**多个触发条件：**
```yaml
trigger:
  - type: tokens
    value: 4000
  - type: messages
    value: 50
```

#### `keep`
- **类型**：`ContextSize` 对象
- **默认值**：`{type: messages, value: 20}`
- **说明**：指定摘要后保留多少近期对话历史。

**示例：**
```yaml
# Keep most recent 20 messages
keep:
  type: messages
  value: 20

# Keep most recent 3000 tokens
keep:
  type: tokens
  value: 3000

# Keep most recent 30% of model's max input tokens
keep:
  type: fraction
  value: 0.3
```

#### `trim_tokens_to_summarize`
- **类型**：整数或 null
- **默认值**：`4000`
- **说明**：调用摘要模型时，参与摘要的消息最多包含的 token 数。设为 `null` 表示不截断（极长对话不推荐）。

#### `summary_prompt`
- **类型**：字符串或 null
- **默认值**：`null`（使用 LangChain 默认提示词）
- **说明**：生成摘要的自定义提示模板。提示应引导模型提取最重要的上下文。

**默认提示行为：**
默认 LangChain 提示会要求模型：
- 提取质量最高、最相关的上下文
- 聚焦对整体目标关键的信息
- 避免重复已完成的动作
- 仅返回提取出的上下文

## 工作原理

### 摘要流程

1. **监控**：每次调用模型前，中间件统计消息历史中的 token
2. **触发检查**：若任一配置的阈值满足，则触发摘要
3. **消息划分**：消息被分为：
   - 待摘要（超出 `keep` 阈值的较早消息）
   - 待保留（`keep` 阈值内的近期消息）
4. **生成摘要**：模型对较早消息生成简洁摘要
5. **替换上下文**：更新消息历史：
   - 移除所有旧消息
   - 添加一条摘要消息
   - 保留近期消息
6. **AI/Tool 成对保护**：确保 AI 消息及其对应的 tool 消息不会被拆开

### Token 计数

- 基于字符数做近似 token 计数
- Anthropic 模型：约每 token 3.3 个字符
- 其他模型：使用 LangChain 默认估算
- 可通过自定义 `token_counter` 函数覆盖

### 消息保留

中间件会智能保留消息上下文：

- **近期消息**：按 `keep` 配置始终完整保留
- **AI/Tool 成对**：绝不拆分——若切分点落在 tool 消息中间，系统会调整以保留整条 AI + Tool 序列
- **摘要格式**：摘要以 HumanMessage 注入，格式为：
  ```
  Here is a summary of the conversation to date:

  [Generated summary text]
  ```

## 最佳实践

### 选择触发阈值

1. **基于 token**：多数场景推荐
   - 设为模型上下文窗口的 60%–80%
   - 例如 8K 上下文可用 4000–6000 token

2. **基于消息条数**：适合控制对话长度
   - 适合短消息很多的应用
   - 例如 50–100 条，视平均消息长度而定

3. **基于比例**：多模型场景较合适
   - 随各模型容量自动适配
   - 例如 0.8（最大输入 token 的 80%）

### 选择保留策略（`keep`）

1. **按消息条数保留**：多数场景首选
   - 保持自然对话流
   - 建议 15–25 条

2. **按 token 保留**：需要精确控制预算时
   - 便于管理固定 token 预算
   - 建议 2000–4000 token

3. **按比例保留**：多模型部署
   - 随模型容量缩放
   - 建议 0.2–0.4（最大输入的 20%–40%）

### 模型选择

- **推荐**：摘要用轻量、低成本模型
  - 例如：`gpt-4o-mini`、`claude-haiku` 或同级
  - 摘要对最强模型依赖低
  - 高流量场景可明显节省成本

- **默认**：`model_name` 为 `null` 时使用默认模型
  - 可能更贵，但行为一致
  - 适合简单部署

### 调优建议

1. **组合触发**：同时使用 token 与消息触发，更稳健
   ```yaml
   trigger:
     - type: tokens
       value: 4000
     - type: messages
       value: 50
   ```

2. **保守保留**：初期多保留消息，再按效果收紧
   ```yaml
   keep:
     type: messages
     value: 25  # Start higher, reduce if needed
   ```

3. **策略性截断**：限制送给摘要模型的 token
   ```yaml
   trim_tokens_to_summarize: 4000  # Prevents expensive summarization calls
   ```

4. **监控迭代**：关注摘要质量并调整配置

## 故障排查

### 摘要质量差

**现象**：摘要丢失重要上下文

**处理**：
1. 增大 `keep`，多保留消息
2. 降低触发阈值，更早触发摘要
3. 自定义 `summary_prompt`，强调关键信息
4. 换用能力更强的摘要模型

### 性能问题

**现象**：摘要调用耗时过长

**处理**：
1. 使用更快的摘要模型（如 `gpt-4o-mini`）
2. 减小 `trim_tokens_to_summarize`，减少送入上下文
3. 提高触发阈值，降低摘要频率

### 仍报 token 上限

**现象**：已开摘要仍触及 token 限制

**处理**：
1. 降低触发阈值，更早摘要
2. 减小 `keep`，少保留消息
3. 检查是否有单条消息特别大
4. 考虑使用基于比例的触发

## 实现细节

### 代码结构

- **配置**：`packages/harness/deerflow/config/summarization_config.py`
- **接入**：`packages/harness/deerflow/agents/lead_agent/agent.py`
- **中间件**：使用 `langchain.agents.middleware.SummarizationMiddleware`

### 中间件顺序

摘要在 ThreadData 与 Sandbox 初始化之后、Title 与 Clarification 之前执行：

1. ThreadDataMiddleware
2. SandboxMiddleware
3. **SummarizationMiddleware** ← 在此执行
4. TitleMiddleware
5. ClarificationMiddleware

### 状态管理

- 摘要是无状态的——配置在启动时加载一次
- 摘要作为普通消息加入对话历史
- checkpointer 会自动持久化摘要后的历史

## 配置示例

### 最小配置
```yaml
summarization:
  enabled: true
  trigger:
    type: tokens
    value: 4000
  keep:
    type: messages
    value: 20
```

### 生产配置
```yaml
summarization:
  enabled: true
  model_name: gpt-4o-mini  # Lightweight model for cost efficiency
  trigger:
    - type: tokens
      value: 6000
    - type: messages
      value: 75
  keep:
    type: messages
    value: 25
  trim_tokens_to_summarize: 5000
```

### 多模型配置
```yaml
summarization:
  enabled: true
  model_name: gpt-4o-mini
  trigger:
    type: fraction
    value: 0.7  # 70% of model's max input
  keep:
    type: fraction
    value: 0.3  # Keep 30% of max input
  trim_tokens_to_summarize: 4000
```

### 保守配置（偏质量）
```yaml
summarization:
  enabled: true
  model_name: gpt-4  # Use full model for high-quality summaries
  trigger:
    type: tokens
    value: 8000
  keep:
    type: messages
    value: 40  # Keep more context
  trim_tokens_to_summarize: null  # No trimming
```

## 参考

- [LangChain Summarization Middleware Documentation](https://docs.langchain.com/oss/python/langchain/middleware/built-in#summarization)
- [LangChain Source Code](https://github.com/langchain-ai/langchain)
