# RFC：将共享的 Skill 安装器与 Upload 管理器抽取到 Harness

## 1. 问题

Gateway（`app/gateway/routers/skills.py`、`uploads.py`）与 Client（`deerflow/client.py`）各自独立实现了相同的业务逻辑：

### Skill 安装

| 逻辑 | Gateway（`skills.py`） | Client（`client.py`） |
|------|----------------------|---------------------|
| Zip 安全检查 | `_is_unsafe_zip_member()` | 内联 `Path(info.filename).is_absolute()` |
| 符号链接过滤 | `_is_symlink_member()` | `p.is_symlink()` 解压后删除 |
| Zip 炸弹防护 | `total_size += info.file_size`（声明大小） | `total_size > 100MB`（声明大小） |
| macOS 元数据过滤 | `_should_ignore_archive_entry()` | 无 |
| Frontmatter 校验 | `_validate_skill_frontmatter()` | `_validate_skill_frontmatter()` |
| 重复检测 | `HTTPException(409)` | `ValueError` |

**两套实现、行为不一致**：Gateway 流式写入并跟踪真实解压后大小；Client 对声明的 `file_size` 求和。Gateway 在解压时跳过符号链接；Client 先全部解压再遍历删除符号链接。

### Upload 管理

| 逻辑 | Gateway（`uploads.py`） | Client（`client.py`） |
|------|----------------------|---------------------|
| 目录访问 | `get_uploads_dir()` + `mkdir` | `_get_uploads_dir()` + `mkdir` |
| 文件名安全 | 内联 `Path(f).name` + 手工校验 | 无校验，直接使用 `src_path.name` |
| 重复处理 | 无（覆盖写入） | 无（覆盖写入） |
| 列表 | 内联 `iterdir()` | 内联 `os.scandir()` |
| 删除 | 内联 `unlink()` + 穿越校验 | 内联 `unlink()` + 穿越校验 |
| 路径穿越 | `resolve().relative_to()` | `resolve().relative_to()` |

**相同的穿越校验写了两遍** — 任何安全修复都必须在两处同时修改。

## 2. 设计原则

### 依赖方向

```
app.gateway.routers.skills  ──┐
app.gateway.routers.uploads ──┤── 调用 ──→  deerflow.skills.installer
deerflow.client             ──┘              deerflow.uploads.manager
```

- 共享模块位于 harness 层（`deerflow.*`），纯业务逻辑，不依赖 FastAPI
- Gateway 负责 HTTP 适配（`UploadFile` → bytes，异常 → `HTTPException`）
- Client 负责本地适配（`Path` → 拷贝，异常 → Python 异常）
- 满足 `test_harness_boundary.py` 约束：harness 永不 import `app`

### 异常策略

| 共享层异常 | Gateway 映射为 | Client |
|----------------------|-----------------|--------|
| `FileNotFoundError` | `HTTPException(404)` | 原样向上抛出 |
| `ValueError` | `HTTPException(400)` | 原样向上抛出 |
| `SkillAlreadyExistsError` | `HTTPException(409)` | 原样向上抛出 |
| `PermissionError` | `HTTPException(403)` | 原样向上抛出 |

用类型化异常匹配（`SkillAlreadyExistsError`）替代基于字符串的路由（`"already exists" in str(e)`）。

## 3. 新模块

### 3.1 `deerflow.skills.installer`

```python
# Safety checks
is_unsafe_zip_member(info: ZipInfo) -> bool     # Absolute path / .. traversal
is_symlink_member(info: ZipInfo) -> bool         # Unix symlink detection
should_ignore_archive_entry(path: Path) -> bool  # __MACOSX / dotfiles

# Extraction
safe_extract_skill_archive(zip_ref, dest_path, max_total_size=512MB)
  # Streaming write, accumulates real bytes (vs declared file_size)
  # Dual traversal check: member-level + resolve-level

# Directory resolution
resolve_skill_dir_from_archive(temp_path: Path) -> Path
  # Auto-enters single directory, filters macOS metadata

# Install entry point
install_skill_from_archive(zip_path, *, skills_root=None) -> dict
  # is_file() pre-check before extension validation
  # SkillAlreadyExistsError replaces ValueError

# Exception
class SkillAlreadyExistsError(ValueError)
```

### 3.2 `deerflow.uploads.manager`

```python
# Directory management
get_uploads_dir(thread_id: str) -> Path      # Pure path, no side effects
ensure_uploads_dir(thread_id: str) -> Path   # Creates directory (for write paths)

# Filename safety
normalize_filename(filename: str) -> str
  # Path.name extraction + rejects ".." / "." / backslash / >255 bytes
deduplicate_filename(name: str, seen: set) -> str
  # _N suffix increment for dedup, mutates seen in place

# Path safety
validate_path_traversal(path: Path, base: Path) -> None
  # resolve().relative_to(), raises PermissionError on failure

# File operations
list_files_in_dir(directory: Path) -> dict
  # scandir with stat inside context (no re-stat)
  # follow_symlinks=False to prevent metadata leakage
  # Non-existent directory returns empty list
delete_file_safe(base_dir: Path, filename: str) -> dict
  # Validates traversal first, then unlinks

# URL helpers
upload_artifact_url(thread_id, filename) -> str   # Percent-encoded for HTTP safety
upload_virtual_path(filename) -> str               # Sandbox-internal path
enrich_file_listing(result, thread_id) -> dict     # Adds URLs, stringifies sizes
```

## 4. 变更

### 4.1 Gateway 瘦身

**`app/gateway/routers/skills.py`**：

- 移除 `_is_unsafe_zip_member`、`_is_symlink_member`、`_safe_extract_skill_archive`、`_should_ignore_archive_entry`、`_resolve_skill_dir_from_archive_root`（约 80 行）
- `install_skill` 路由改为单次调用 `install_skill_from_archive(path)`
- 异常映射：`SkillAlreadyExistsError → 409`，`ValueError → 400`，`FileNotFoundError → 404`

**`app/gateway/routers/uploads.py`**：

- 移除内联 `get_uploads_dir`（由 `ensure_uploads_dir` / `get_uploads_dir` 替代）
- `upload_files` 使用 `normalize_filename()` 替代内联安全检查
- `list_uploaded_files` 使用 `list_files_in_dir()` + 富化逻辑
- `delete_uploaded_file` 使用 `delete_file_safe()` + 配套 markdown 清理

### 4.2 Client 瘦身

**`deerflow/client.py`**：

- 移除 `_get_uploads_dir` 静态方法
- 移除 `install_skill` 中约 50 行内联 zip 处理
- `install_skill` 委托给 `install_skill_from_archive()`
- `upload_files` 使用 `deduplicate_filename()` + `ensure_uploads_dir()`
- `list_uploads` 使用 `get_uploads_dir()` + `list_files_in_dir()`
- `delete_upload` 使用 `get_uploads_dir()` + `delete_file_safe()`
- `update_mcp_config` / `update_skill` 现会将 `_agent_config_key = None` 重置

### 4.3 读写路径分离

| 操作 | 函数 | 是否创建目录？ |
|------|------|:------------:|
| upload（写） | `ensure_uploads_dir()` | 是 |
| list（读） | `get_uploads_dir()` | 否 |
| delete（读） | `get_uploads_dir()` | 否 |

读路径不再带有 `mkdir` 副作用 — 目录不存在时返回空列表。

## 5. 安全改进

| 改进项 | 之前 | 之后 |
|-------------|--------|-------|
| Zip 炸弹检测 | 声明的 `file_size` 求和 | 流式写入，累计真实字节 |
| 符号链接处理 | Gateway 跳过 / Client 解压后删 | 统一跳过 + 日志 |
| 穿越校验 | 仅成员级 | 成员级 + `resolve().is_relative_to()` |
| 文件名反斜杠 | Gateway 校验 / Client 不校验 | 统一拒绝 |
| 文件名长度 | 无校验 | 拒绝 > 255 字节（OS 限制） |
| thread_id 校验 | 无 | 拒绝不安全的文件系统字符 |
| 列表符号链接泄露 | `follow_symlinks=True`（默认） | `follow_symlinks=False` |
| 409 状态路由 | `"already exists" in str(e)` | `SkillAlreadyExistsError` 类型匹配 |
| Artifact URL 编码 | 原始文件名在 URL 中 | `urllib.parse.quote()` |

## 6. 备选方案

| 备选方案 | 未采纳原因 |
|-------------|---------|
| 逻辑保留在 Gateway，Client 经 HTTP 调 Gateway | 嵌入式 Client 增加网络依赖；违背 `DeerFlowClient` 作为进程内 API 的定位 |
| 抽象基类 + Gateway/Client 子类 | 对纯函数而言过度设计；无需多态 |
| 全部移入 `client.py` 并由 Gateway import | 违反 harness/app 边界 — Client 在 harness 中，但 Gateway 专用模型（Pydantic 响应类型）应留在 app 层 |
| 合并 Gateway 与 Client 为单模块 | 二者服务不同消费者（HTTP vs 进程内），适配需求不同 |

## 7. 破坏性变更

**无。** 所有公开 API（Gateway HTTP 端点、`DeerFlowClient` 方法）保持原有签名与返回格式。`SkillAlreadyExistsError` 为 `ValueError` 子类，现有 `except ValueError` 仍可捕获。

## 8. 测试

| 模块 | 测试文件 | 数量 |
|--------|-----------|:-----:|
| `skills.installer` | `tests/test_skills_installer.py` | 22 |
| `uploads.manager` | `tests/test_uploads_manager.py` | 20 |
| `client` 加固 | `tests/test_client.py`（新用例） | ~40 |
| `client` e2e | `tests/test_client_e2e.py`（新文件） | ~20 |

覆盖：不安全 zip / 符号链接 / zip bomb / frontmatter / 重复 / 扩展名 / macOS 过滤 / normalize / deduplicate / 穿越 / 列表 / 删除 / agent 失效 / upload 生命周期 / 线程隔离 / URL 编码 / 配置污染。
