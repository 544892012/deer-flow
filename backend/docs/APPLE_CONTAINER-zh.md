# Apple Container 支持

DeerFlow 现已支持将 Apple Container 作为 macOS 上的首选容器运行时，并在不可用时自动回退到 Docker。

## 概述

从本版本起，DeerFlow 会在 macOS 上自动检测并使用 Apple Container（若可用），并在以下情况回退到 Docker：

- 未安装 Apple Container
- 运行在非 macOS 平台

这样在 Apple 芯片 Mac 上可获得更好性能，同时保持各平台兼容。

## 优势

### 在配备 Apple Container 的 Apple 芯片 Mac 上：

- **更好性能**：原生 ARM64 执行，无需 Rosetta 2 转译
- **更低资源占用**：比 Docker Desktop 更轻量
- **原生集成**：使用 macOS Virtualization.framework

### 回退到 Docker 时：

- 完全向后兼容
- 适用于所有平台（macOS、Linux、Windows）
- 无需修改配置

## 环境要求

### Apple Container（仅 macOS）：

- macOS 15.0 或更高版本
- Apple 芯片（M1/M2/M3/M4）
- 已安装 Apple Container CLI

### 安装：

```bash
# 从 GitHub releases 下载
# https://github.com/apple/container/releases

# 验证安装
container --version

# 启动服务
container system start
```

### Docker（全平台）：

- Docker Desktop 或 Docker Engine

## 工作原理

### 自动检测

`AioSandboxProvider` 会在启动时自动检测可用的容器运行时：

1. 在 macOS 上：尝试执行 `container --version`
   - 成功 → 使用 Apple Container
   - 失败 → 回退到 Docker

2. 在其他平台：直接使用 Docker

### 运行时差异

两种运行时的命令语法几乎一致：

**启动容器：**
```bash
# Apple Container
container run --rm -d -p 8080:8080 -v /host:/container -e KEY=value image

# Docker
docker run --rm -d -p 8080:8080 -v /host:/container -e KEY=value image
```

**清理容器：**
```bash
# Apple Container（带 --rm）
container stop <id>  # 因 --rm 会自动删除

# Docker（带 --rm）
docker stop <id>     # 因 --rm 会自动删除
```

### 实现细节

实现位于 `backend/packages/harness/deerflow/community/aio_sandbox/aio_sandbox_provider.py`：

- `_detect_container_runtime()`：启动时检测可用运行时
- `_start_container()`：使用检测到的运行时；对 Apple Container 跳过 Docker 专有选项
- `_stop_container()`：使用对应运行时的停止命令

## 配置

无需修改配置，系统会自动工作。

可通过日志确认当前使用的运行时：

```
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Detected Apple Container: container version 0.1.0
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Starting sandbox container using container: ...
```

若使用 Docker：

```
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Apple Container not available, falling back to Docker
INFO:deerflow.community.aio_sandbox.aio_sandbox_provider:Starting sandbox container using docker: ...
```

## 容器镜像

两种运行时均使用 OCI 兼容镜像。默认镜像对两者均适用：

```yaml
sandbox:
  use: deerflow.community.aio_sandbox:AioSandboxProvider
  image: enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest  # 默认镜像
```

请确保镜像在对应架构上可用：

- Apple 芯片上的 Apple Container 使用 ARM64
- Intel Mac 上的 Docker 使用 AMD64
- 多架构镜像可在两者上使用

### 预拉取镜像（推荐）

**重要**：容器镜像通常较大（500MB+），首次使用时会拉取，可能造成长时间等待且缺少明确反馈。

**建议**：在环境准备阶段预拉取镜像：

```bash
# 在项目根目录
make setup-sandbox
```

该命令将：

1. 从 `config.yaml` 读取配置的镜像（或使用默认）
2. 检测可用运行时（Apple Container 或 Docker）
3. 拉取镜像并显示进度
4. 验证镜像已就绪

**手动预拉取**：

```bash
# 使用 Apple Container
container image pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest

# 使用 Docker
docker pull enterprise-public-cn-beijing.cr.volces.com/vefaas-public/all-in-one-sandbox:latest
```

若不预拉取，镜像会在首次执行 agent 时自动拉取，根据网络情况可能需数分钟。

## 清理脚本

项目提供统一清理脚本，同时支持两种运行时：

**脚本：** `scripts/cleanup-containers.sh`

**用法：**
```bash
# 清理所有 DeerFlow 沙箱容器
./scripts/cleanup-containers.sh deer-flow-sandbox

# 自定义前缀
./scripts/cleanup-containers.sh my-prefix
```

**Makefile 集成：**

`Makefile` 中的清理命令会自动处理两种运行时：

```bash
make stop   # 停止所有服务并清理容器
make clean  # 完整清理（含日志）
```

## 测试

测试容器运行时检测：

```bash
cd backend
python test_container_runtime.py
```

将执行：

1. 检测可用运行时
2. 可选启动测试容器
3. 验证连通性
4. 清理

## 故障排查

### macOS 上未检测到 Apple Container

1. 检查是否已安装：
   ```bash
   which container
   container --version
   ```

2. 检查服务是否运行：
   ```bash
   container system start
   ```

3. 在应用日志中查看检测信息：
   ```bash
   # 在应用日志中查找检测相关输出
   grep "container runtime" logs/*.log
   ```

### 容器未正确清理

1. 手动查看运行中的容器：
   ```bash
   # Apple Container
   container list

   # Docker
   docker ps
   ```

2. 手动运行清理脚本：
   ```bash
   ./scripts/cleanup-containers.sh deer-flow-sandbox
   ```

### 性能问题

- 在 Apple 芯片上 Apple Container 通常更快
- 若需临时强制使用 Docker，可暂时重命名 `container` 命令：
   ```bash
   # 临时变通，不建议长期使用
   sudo mv /opt/homebrew/bin/container /opt/homebrew/bin/container.bak
   ```

## 参考

- [Apple Container GitHub](https://github.com/apple/container)
- [Apple Container 文档](https://github.com/apple/container/blob/main/docs/)
- [OCI 镜像规范](https://github.com/opencontainers/image-spec)
