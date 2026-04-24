# Skills 加载与使用机制

---

## 核心概念

**Skills 不是 LangChain Tool，而是通过系统提示词告诉 LLM 的"知识文档"。** LLM 在运行时通过 `read_file` 工具读取 `SKILL.md` 来获取技能的具体指令。

## 目录结构

### Python 包（代码层）

```
packages/harness/deerflow/skills/
├── __init__.py        # 导出 load_skills, get_skills_root_path, Skill
├── loader.py          # 扫描磁盘、聚合 Skill 列表、与扩展配置合并
├── parser.py          # 解析 SKILL.md 的 YAML front matter
├── types.py           # Skill 数据类、容器内路径计算
├── validation.py      # 安装/校验规则
└── installer.py       # 从 .skill ZIP 安全解压安装
```

### 技能内容（资产层）

```
skills/                       # 仓库根下，与 backend/ 同级
├── public/                   # 内置技能
│   ├── bootstrap/SKILL.md
│   ├── deep-research/SKILL.md
│   └── ...
└── custom/                   # 用户安装的技能
    └── <skill-name>/SKILL.md
```

## 加载链路

```
make_lead_agent(config)
  │
  ├→ apply_prompt_template(..., available_skills=...)    # agents/lead_agent/agent.py
  │     │
  │     └→ get_skills_prompt_section(available_skills)   # agents/lead_agent/prompt.py
  │           │
  │           └→ load_skills(enabled_only=True)          # skills/loader.py
  │                 │
  │                 ├→ get_skills_root_path()             # 定位仓库 skills/ 目录
  │                 ├→ os.walk(public/) + os.walk(custom/) # 扫描含 SKILL.md 的目录
  │                 ├→ parse_skill_file(path)              # 解析 YAML front matter
  │                 ├→ ExtensionsConfig.from_file()        # 读 extensions_config.json 获取启用状态
  │                 └→ 返回 [Skill(...), ...]              # 按 name 排序
  │
  │     生成的系统提示词中包含：
  │     <skill_system>
  │       <skill name="deep-research">
  │         <description>Deep research skill for...</description>
  │         <location>/mnt/skills/public/deep-research/SKILL.md</location>
  │       </skill>
  │     </skill_system>
  │
  └→ create_agent(system_prompt=..., tools=..., ...)
```

## Skills 与 Tools 的关系

| 维度 | Skills | Tools |
|------|--------|-------|
| **形态** | 磁盘上的 `SKILL.md` + 附属文件 | LangChain 的 `@tool` 函数对象 |
| **绑定方式** | 通过系统提示词文本告诉 LLM | 通过 `model.bind_tools()` 绑定到 LLM API |
| **运行时使用** | LLM 用 `read_file` 工具读取 `SKILL.md` | LLM 通过 `tool_calls` 直接调用 |
| **配置位置** | `extensions_config.json` 的 `skills` 字段 | `config.yaml` 的 `tools` 字段 |

**关键衔接**：Skills 依赖 **`read_file`** 工具来读取技能文档。系统提示词中给出了技能的 `location`（容器内路径如 `/mnt/skills/public/deep-research/SKILL.md`），LLM 需要时自行调用 `read_file` 读取。

## 运行时流程

1. **Agent 构建时**：`load_skills()` 扫描启用的技能，生成 `<skill_system>` 段落注入系统提示词
2. **LLM 推理时**：根据用户请求，LLM 决定是否需要某个技能，调用 `read_file` 读取 `SKILL.md`
3. **Progressive Loading**：SKILL.md 中可能引用同目录下的其他文件（如 `references/`），LLM 按需继续读取
4. **路径映射**：sandbox 把宿主 `skills/` 目录映射到容器内 `/mnt/skills/`

## 按 Agent 裁剪

- `AgentConfig.skills = None`：所有已启用技能都进 prompt（默认）
- `AgentConfig.skills = []`：无技能段
- `AgentConfig.skills = {"bootstrap"}`：仅 bootstrap 技能（最小化流程）
- 子 Agent：当前默认使用全部已启用技能

## 技能启用/禁用

通过 `extensions_config.json` 的 `skills` 字段控制：

```json
{
  "skills": {
    "deep-research": { "enabled": true },
    "my-custom-skill": { "enabled": false }
  }
}
```

支持热更新：修改后下次请求自动生效（`ExtensionsConfig.from_file()` 每次重新读取）。
