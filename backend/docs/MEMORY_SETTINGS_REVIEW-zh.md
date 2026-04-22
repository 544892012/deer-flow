# 记忆设置评审

在本地评审「记忆设置」新增/编辑流程时，可按本文用最少手工步骤操作。

## 快速评审

1. 使用你已有的任意可用开发方式在本地启动 DeerFlow。

   例如：

   ```bash
   make dev
   ```

   或

   ```bash
   make docker-start
   ```

   若本地已在运行 DeerFlow，可直接复用当前环境。

2. 加载示例记忆 fixture。

   ```bash
   python scripts/load_memory_sample.py
   ```

3. 打开 `设置 > 记忆`。

   默认本地 URL：
   - 应用：`http://localhost:2026`
   - 仅前端兜底：`http://localhost:3000`

## 最小手工测试

1. 点击 `Add fact`。
2. 新建一条事实，填写：
   - 内容：`Reviewer-added memory fact`
   - 类别：`testing`
   - 置信度：`0.88`
3. 确认新事实立即出现在列表中，且来源显示为 `Manual`。
4. 编辑示例事实 `This sample fact is intended for edit testing.`，改为：
   - 内容：`This sample fact was edited during manual review.`
   - 类别：`testing`
   - 置信度：`0.91`
5. 确认编辑后事实立即更新。
6. 刷新页面，确认新增与编辑后的事实仍然保留。

## 可选自检

- 搜索 `Reviewer-added`，确认能匹配到新事实。
- 搜索 `workflow`，确认类别文案可被搜索。
- 在 `All`、`Facts`、`Summaries` 之间切换。
- 删除可丢弃的示例事实 `Delete fact testing can target this disposable sample entry.`，确认列表立即更新。
- 清空全部记忆，确认页面进入空状态。

## Fixture 文件

- 示例 fixture：`backend/docs/memory-settings-sample.json`
- 默认本地运行时目标：`backend/.deer-flow/memory.json`

加载脚本在覆盖已有运行时记忆文件前会自动创建带时间戳的备份。
