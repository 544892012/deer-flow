# Sandbox 机制：代码执行环境隔离

---

## 核心概念

**Sandbox 提供了 Agent 工具（bash、read_file、write_file 等）的执行环境。** 它把 Agent 看到的虚拟路径（如 `/mnt/user-data/`）映射到真实文件系统路径，并通过路径校验防止越权访问。

## 目录结构

```
packages/harness/deerflow/sandbox/
├── __init__.py              # 导出 Sandbox, SandboxProvider, get_sandbox_provider
├── sandbox.py               # Sandbox 抽象基类（5 种 IO 接口）
├── sandbox_provider.py      # Provider 单例工厂 + acquire/release 生命周期
├── middleware.py             # SandboxMiddleware（before_agent / after_agent）
├── tools.py                 # LangChain @tool 实现（bash, ls, read_file, write_file, str_replace）
├── security.py              # 安全策略（是否允许 host bash）
├── file_operation_lock.py   # 文件操作线程锁（按 sandbox_id + path）
├── exceptions.py            # SandboxError 异常
└── local/
    ├── __init__.py
    ├── local_sandbox.py     # LocalSandbox：路径映射 + subprocess 执行
    ├── local_sandbox_provider.py  # LocalSandboxProvider：单例管理
    └── list_dir.py          # 目录树列举（忽略 node_modules、.git 等）
```

## 两种 Provider 对比

| 维度 | LocalSandboxProvider | AioSandboxProvider |
|------|---------------------|-------------------|
| 隔离级别 | 宿主机 subprocess，路径校验隔离 | Docker 容器隔离 |
| 适用场景 | 本地开发 | 生产环境 |
| bash 工具 | 默认**禁用**（`allow_host_bash: false`） | 默认启用（容器内安全） |
| acquire | 返回全局单例 LocalSandbox | 创建/复用 Docker 容器 |
| release | 空操作 | 容器进入 warm pool 等待复用 |
| 配置 | `sandbox.use: deerflow.sandbox.local:LocalSandboxProvider` | `sandbox.use: deerflow.community.aio_sandbox:AioSandboxProvider` |

## 初始化链路

```
进程启动
  │
  └→ AppConfig.sandbox.use = "deerflow.sandbox.local:LocalSandboxProvider"
                                        （或 AioSandboxProvider）

首次工具调用（懒加载）
  │
  └→ ensure_sandbox_initialized(runtime)          # sandbox/tools.py
       │
       ├→ runtime.state["sandbox"] 已有 sandbox_id?
       │     是 → provider.get(sandbox_id) → 返回 Sandbox 实例
       │
       └→ 否 → get_sandbox_provider()              # sandbox_provider.py（首次创建）
                  │
                  ├→ get_app_config().sandbox.use
                  ├→ resolve_class(use, SandboxProvider)  # 动态导入
                  └→ cls()  → 实例化 Provider（缓存到模块级变量）
                       │
                       └→ provider.acquire(thread_id)
                            │
                            ├→ Local: 返回全局单例 LocalSandbox
                            └→ Aio: 创建/从 warm pool 取 Docker 容器
                                 返回 sandbox_id
```

## SandboxMiddleware 的作用

SandboxMiddleware 是 LangGraph 图中的节点，管理 sandbox 的生命周期：

```
before_agent:
  - lazy_init=True（默认）→ 跳过（等工具首次调用时才 acquire）
  - lazy_init=False → 立即 acquire sandbox
  - 将 sandbox_id 写入 state["sandbox"]

after_agent:
  - 从 state 或 context 取 sandbox_id
  - 调用 provider.release(sandbox_id)
  - Local: 空操作
  - Aio: 容器进 warm pool（不立即销毁）
```

## 哪些工具使用 Sandbox

所有文件操作和命令执行工具都通过 sandbox 执行：

| 工具 | 调用的 Sandbox 方法 | 说明 |
|------|-------------------|------|
| `bash_tool` | `sandbox.execute_command()` | 执行 shell 命令 |
| `ls_tool` | `sandbox.list_dir()` | 列出目录结构 |
| `read_file_tool` | `sandbox.read_file()` | 读取文件内容 |
| `write_file_tool` | `sandbox.write_file()` | 写入文件 |
| `str_replace_tool` | `sandbox.read_file()` + `sandbox.write_file()` | 字符串替换 |

每个工具调用前都会先 `ensure_sandbox_initialized(runtime)` 确保 sandbox 已就绪。

## 虚拟路径映射

Agent 看到的路径（虚拟路径）和宿主机路径的映射关系：

| 虚拟路径 | 映射目标 | 权限 |
|---------|---------|------|
| `/mnt/user-data/` | 线程数据目录（`thread_data_dir`） | 读写 |
| `/mnt/skills/` | 仓库 `skills/` 目录 | 只读 |

### Local 模式的路径安全

`tools.py` 中的路径校验逻辑：

1. **`validate_local_tool_path`**：确保路径在允许的前缀范围内
2. **`validate_local_bash_command_paths`**：bash 命令中引用的路径必须合法
3. **Skills 只读**：`/mnt/skills/` 下的文件不允许写入
4. **前缀限制**：`/mnt/user-data/` 前缀限制防止访问宿主机任意路径

## bash 工具的安全策略

```
is_host_bash_allowed()                # security.py
  │
  ├→ 不是 LocalSandboxProvider → True（容器内 bash 安全）
  │
  └→ 是 LocalSandboxProvider
       │
       ├→ config.sandbox.allow_host_bash == True → True（用户显式允许）
       └→ False → bash 工具从可用工具列表中移除
```

本地开发时，如果不设置 `allow_host_bash: true`，`get_available_tools()` 会过滤掉 `bash_tool`，防止 Agent 在宿主机上执行任意命令。

## 端到端调用示例

用户请求 "帮我创建一个 hello.py 文件"：

```
LLM 返回 tool_calls: [{name: "write_file", args: {path: "/mnt/user-data/hello.py", content: "print('hello')"}}]
  │
  └→ ToolNode 执行 write_file_tool
       │
       ├→ ensure_sandbox_initialized(runtime)
       │     └→ get_sandbox_provider().acquire(thread_id) → LocalSandbox
       │
       ├→ replace_virtual_path("/mnt/user-data/hello.py")
       │     └→ 映射为 "/path/to/thread_data/hello.py"
       │
       ├→ validate_local_tool_path(real_path)
       │     └→ 检查是否在允许的目录范围内
       │
       ├→ get_file_operation_lock(sandbox_id, path)
       │     └→ 获取文件操作线程锁
       │
       └→ sandbox.write_file(real_path, content)
             └→ 写入文件到宿主机（LocalSandbox）或容器内（AioSandbox）
```

## 关键设计要点

1. **懒加载**：默认 `lazy_init=True`，sandbox 在首次工具调用时才创建，避免不需要工具的对话浪费资源
2. **路径隔离**：Agent 只能通过虚拟路径访问文件，由 sandbox 层做映射和校验
3. **Skills 只读**：技能文件目录映射为只读，防止 Agent 修改系统技能
4. **线程锁**：`file_operation_lock.py` 按 `(sandbox_id, path)` 粒度加锁，防止并发写同一文件
5. **Warm Pool**（Aio 模式）：容器 release 后不立即销毁，保持在 warm pool 中供同线程下次快速复用
