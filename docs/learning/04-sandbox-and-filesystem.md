# 04 - 沙箱与文件系统

## 整体架构

```
Agent 工具调用 (bash, ls, read_file, write_file, str_replace)
    ↓
tools.py 工具函数
    ↓ 判断沙箱类型
    ↓
┌───────────────────────────────────────────────────────────────┐
│  本地沙箱 (LocalSandbox)                                      │
│                                                               │
│  1. ensure_sandbox_initialized()  ← 懒初始化                 │
│  2. validate_local_tool_path()    ← 安全校验                  │
│  3. replace_virtual_path()        ← 虚拟路径 → 物理路径       │
│  4. sandbox.execute_command()     ← 执行                      │
│  5. mask_local_paths_in_output()  ← 输出脱敏                  │
│                                                               │
│  虚拟路径 /mnt/user-data/*  ←→  物理路径 .deer-flow/threads/* │
└───────────────────────────────────────────────────────────────┘
    或
┌───────────────────────────────────────────────────────────────┐
│  Docker 沙箱 (AioSandbox)                                     │
│                                                               │
│  /mnt/user-data 已 volume mount 到容器内                      │
│  直接执行，无需路径翻译                                       │
└───────────────────────────────────────────────────────────────┘
```

## Provider 模式

### 抽象接口

```python
class SandboxProvider(ABC):
    def acquire(thread_id) -> str      # 获取沙箱，返回 sandbox_id
    def get(sandbox_id) -> Sandbox     # 获取沙箱实例
    def release(sandbox_id)            # 释放沙箱

class Sandbox(ABC):
    def execute_command(command) -> str
    def read_file(path) -> str
    def write_file(path, content, append=False)
    def list_dir(path, max_depth=2) -> list[str]
    def update_file(path, content: bytes)
```

### 实现

| Provider | 说明 | 隔离级别 |
|----------|------|---------|
| `LocalSandboxProvider` | 本机文件系统执行 | 无隔离（需 `allow_host_bash` 才能执行命令） |
| `AioSandboxProvider` | Docker 容器 | 容器级隔离 |
| Provisioner | K8s Pod | Pod 级隔离 |

### 单例 + 反射加载

```python
def get_sandbox_provider():
    # 从 config.yaml 的 sandbox.use 路径反射加载
    cls = resolve_class(config.sandbox.use, SandboxProvider)
    return cls()  # 全局单例
```

## 虚拟路径系统

这是沙箱系统最核心的设计——让 Agent 看到统一的路径，后端自动翻译。

### 路径映射表

| Agent 看到的虚拟路径 | 物理路径（本地沙箱） |
|---------------------|---------------------|
| `/mnt/user-data/workspace` | `backend/.deer-flow/threads/{thread_id}/user-data/workspace` |
| `/mnt/user-data/uploads` | `backend/.deer-flow/threads/{thread_id}/user-data/uploads` |
| `/mnt/user-data/outputs` | `backend/.deer-flow/threads/{thread_id}/user-data/outputs` |
| `/mnt/skills` | `deer-flow/skills/` |
| `/mnt/acp-workspace` | `backend/.deer-flow/threads/{thread_id}/acp-workspace/` |

### 翻译流程（以 bash 命令为例）

```
Agent 调用: bash("ls /mnt/user-data/workspace")
    ↓
bash_tool():
    1. ensure_sandbox_initialized(runtime)   ← 确保沙箱可用
    2. is_local_sandbox(runtime)             ← 判断是否本地沙箱
    3. is_host_bash_allowed()                ← 检查是否允许 host bash
    4. ensure_thread_directories_exist()      ← 确保目录存在
    5. validate_local_bash_command_paths()    ← 校验命令中的所有路径
    6. replace_virtual_paths_in_command()     ← 翻译命令中所有虚拟路径
    7. _apply_cwd_prefix()                   ← 加 "cd workspace &&" 前缀
    8. sandbox.execute_command()              ← 执行翻译后的命令
    9. mask_local_paths_in_output()           ← 输出中物理路径替换回虚拟路径
    ↓
返回给 Agent: (翻译后的输出，Agent 看到虚拟路径)
```

### replace_virtual_path 核心实现

```python
def replace_virtual_path(path, thread_data):
    mappings = {
        "/mnt/user-data/workspace": thread_data["workspace_path"],
        "/mnt/user-data/uploads":   thread_data["uploads_path"],
        "/mnt/user-data/outputs":   thread_data["outputs_path"],
    }
    # 最长前缀优先匹配
    for virtual_base, actual_base in sorted(mappings, key=len, reverse=True):
        if path.startswith(virtual_base):
            rest = path[len(virtual_base):].lstrip("/")
            return join(actual_base, rest)
    return path
```

### mask_local_paths_in_output 输出脱敏

命令执行后的输出可能包含物理路径，需要替换回虚拟路径：

```python
def mask_local_paths_in_output(output, thread_data):
    # 反向映射：物理路径 → 虚拟路径
    for actual_base, virtual_base in reverse_mappings:
        output = regex_replace(output, actual_base, virtual_base)
    return output
```

## 安全机制

### 路径校验

```python
def validate_local_tool_path(path, thread_data, read_only=False):
    # 1. 拒绝路径穿越（..）
    _reject_path_traversal(path)
    
    # 2. 检查路径权限
    if is_skills_path(path):
        if not read_only: raise PermissionError  # Skills 只读
    elif is_acp_workspace_path(path):
        if not read_only: raise PermissionError  # ACP 只读
    elif path.startswith("/mnt/user-data/"):
        return  # 用户数据目录允许读写
    else:
        raise PermissionError  # 其他路径禁止
```

### Host Bash 安全控制

```python
def is_host_bash_allowed(config=None):
    # 本地沙箱默认禁止 host bash
    if uses_local_sandbox_provider(config):
        return config.sandbox.allow_host_bash  # 默认 False
    return True  # 非本地沙箱（Docker/K8s）允许
```

### Bash 命令路径校验

```python
def validate_local_bash_command_paths(command, thread_data):
    # 扫描命令中的所有绝对路径
    for path in regex_find_all_absolute_paths(command):
        if path.startswith("/mnt/user-data/"): continue  # 允许
        if path.startswith("/mnt/skills/"): continue      # 允许
        if path.startswith("/bin/"): continue              # 系统路径允许
        unsafe_paths.append(path)                          # 其他拒绝
    
    if unsafe_paths:
        raise PermissionError(f"Unsafe paths: {unsafe_paths}")
```

## SandboxMiddleware 生命周期

```python
class SandboxMiddleware(AgentMiddleware):
    def __init__(self, lazy_init=True):
        self._lazy_init = lazy_init

    def before_agent(self, state, runtime):
        if self._lazy_init:
            return  # 延迟到首次工具调用时初始化
        # 非懒加载：立即获取沙箱
        sandbox_id = provider.acquire(thread_id)
        return {"sandbox": {"sandbox_id": sandbox_id}}

    def after_agent(self, state, runtime):
        # 释放沙箱
        sandbox_id = state["sandbox"]["sandbox_id"]
        provider.release(sandbox_id)
```

### 懒初始化（ensure_sandbox_initialized）

```python
def ensure_sandbox_initialized(runtime):
    # 1. 检查状态中是否已有沙箱
    sandbox_state = runtime.state.get("sandbox")
    if sandbox_state:
        sandbox = provider.get(sandbox_state["sandbox_id"])
        if sandbox: return sandbox
    
    # 2. 首次调用，懒获取
    thread_id = runtime.context.get("thread_id")
    sandbox_id = provider.acquire(thread_id)
    runtime.state["sandbox"] = {"sandbox_id": sandbox_id}
    return provider.get(sandbox_id)
```

## LocalSandbox 实现

```python
class LocalSandbox(Sandbox):
    def execute_command(self, command):
        # 解析容器路径为本地路径
        resolved = self._resolve_paths_in_command(command)
        # 找到可用 shell
        shell = self._get_shell()  # /bin/zsh > /bin/bash > /bin/sh
        # subprocess 执行
        result = subprocess.run(resolved, shell=True, executable=shell, timeout=600)
        # 输出中本地路径替换回容器路径
        return self._reverse_resolve_paths_in_output(output)

    def read_file(self, path):
        resolved = self._resolve_path(path)
        with open(resolved) as f: return f.read()

    def write_file(self, path, content, append=False):
        resolved = self._resolve_path(path)
        os.makedirs(os.path.dirname(resolved), exist_ok=True)
        with open(resolved, "a" if append else "w") as f:
            f.write(content)
```

## 线程目录结构

```
backend/.deer-flow/
├── threads/
│   └── {thread_id}/
│       ├── user-data/
│       │   ├── workspace/    # Agent 工作区，存放临时文件
│       │   ├── uploads/      # 用户上传文件
│       │   └── outputs/      # Agent 产出的最终交付物
│       └── acp-workspace/    # ACP Agent 独立工作区
├── memory.json               # 全局长期记忆
└── agents/
    └── {agent_name}/
        └── memory.json       # per-Agent 记忆
```

## 关键源码文件

| 文件 | 核心内容 |
|------|---------|
| `sandbox/sandbox.py` | `Sandbox` 抽象基类 |
| `sandbox/sandbox_provider.py` | `SandboxProvider` 抽象 + 全局单例 |
| `sandbox/local/local_sandbox.py` | `LocalSandbox` 本地实现 |
| `sandbox/tools.py` | 沙箱工具 + 虚拟路径翻译 + 安全校验 |
| `sandbox/middleware.py` | `SandboxMiddleware` 生命周期管理 |
| `sandbox/security.py` | Host bash 安全策略 |
| `sandbox/exceptions.py` | 沙箱异常类 |
| `config/paths.py` | `VIRTUAL_PATH_PREFIX` + 路径配置 |
