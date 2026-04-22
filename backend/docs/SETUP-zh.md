# 安装与配置指南

DeerFlow 的快速安装与配置说明。

## 配置准备

DeerFlow 使用 YAML 配置文件，应放在**项目根目录**。

### 步骤

1. **进入项目根目录**：
   ```bash
   cd /path/to/deer-flow
   ```

2. **复制示例配置**：
   ```bash
   cp config.example.yaml config.yaml
   ```

3. **编辑配置**：
   ```bash
   # Option A: Set environment variables (recommended)
   export OPENAI_API_KEY="your-key-here"

   # Option B: Edit config.yaml directly
   vim config.yaml  # or your preferred editor
   ```

4. **校验配置**：
   ```bash
   cd backend
   python -c "from deerflow.config import get_app_config; print('✓ Config loaded:', get_app_config().models[0].name)"
   ```

## 重要说明

- **位置**：`config.yaml` 应位于 `deer-flow/`（项目根），而非 `deer-flow/backend/`
- **Git**：`config.yaml` 默认已被 git 忽略（含敏感信息）
- **优先级**：若同时存在 `backend/config.yaml` 与 `../config.yaml`，以 backend 目录下的为准

## 配置文件查找顺序

后端按以下顺序查找 `config.yaml`：

1. 环境变量 `DEER_FLOW_CONFIG_PATH`（若已设置）
2. `backend/config.yaml`（从 `backend/` 目录运行时即为当前目录）
3. `deer-flow/config.yaml`（上一级目录，**推荐位置**）

**推荐**：将 `config.yaml` 放在项目根目录（`deer-flow/config.yaml`）。

## 沙箱准备（可选，但建议执行）

若计划使用基于 Docker/容器的沙箱（在 `config.yaml` 中配置 `sandbox.use: deerflow.community.aio_sandbox:AioSandboxProvider`），强烈建议预先拉取镜像：

```bash
# From project root
make setup-sandbox
```

**为何要预拉取？**
- 沙箱镜像（约 500MB+）会在首次使用时拉取，等待时间较长
- 预拉取时进度明确
- 避免首次使用 agent 时误以为卡住

若跳过此步骤，镜像会在首次执行 agent 时自动拉取，视网络情况可能需数分钟。

## 故障排查

### 找不到配置文件

```bash
# Check where the backend is looking
cd deer-flow/backend
python -c "from deerflow.config.app_config import AppConfig; print(AppConfig.resolve_config_path())"
```

若仍找不到：
1. 确认已将 `config.example.yaml` 复制为 `config.yaml`
2. 确认当前工作目录正确
3. 检查文件是否存在：`ls -la ../config.yaml`

### 权限被拒绝

```bash
chmod 600 ../config.yaml  # Protect sensitive configuration
```

## 另请参阅

- [配置指南](CONFIGURATION-zh.md) — 详细配置项说明
- [架构概览](../CLAUDE.md) — 系统架构（英文）
