Create a presentation slide image following these guidelines:

## Image Specifications

- **Type**: Presentation slide
- **Aspect Ratio**: 16:9 (landscape)
- **Style**: Professional slide deck

## Core Principles

- Hand-drawn quality throughout - NO realistic or photographic elements
- NO slide numbers, page numbers, footers, headers, or logos
- Clean, uncluttered layouts with clear visual hierarchy
- Each slide conveys ONE clear message

## Text Style (CRITICAL)

- **ALL text MUST match the designated style exactly**
- Title text: Large, bold, immediately readable
- Body text: Clear, legible, appropriate sizing
- Max 3-4 text elements per slide
- Font rendering must match the style aesthetic

## Language

- Use Chinese Simplified (zh) for all text elements

---

## STYLE_INSTRUCTIONS

```
Design Aesthetic: Clean, structured visual metaphors using blueprints, diagrams, and schematics. Precise, analytical and aesthetically refined. Information presented in triptych or grid-based layouts with engineering precision. Technical grid overlay with cool analytical blues and grays.

Background:
  Texture: Subtle grid overlay, light engineering paper feel
  Base Color: Blueprint Off-White (#FAF8F5)

Typography:
  Headlines: Bold, precise clean sans-serif with technical, authoritative presence. Perfect geometric letterforms with consistent spacing.
  Body: Elegant serif for body explanations. Clean, readable at smaller sizes. Professional editorial quality.

Color Palette:
  Primary Text: Deep Slate (#334155) - Headlines, body text
  Background: Blueprint Paper (#FAF8F5) - Primary background
  Grid: Light Gray (#E5E5E5) - Background grid lines
  Accent 1: Engineering Blue (#2563EB) - Key elements, highlights
  Accent 2: Navy Blue (#1E3A5F) - Supporting elements
  Accent 3: Light Blue (#BFDBFE) - Backgrounds, fills
  Warning: Amber (#F59E0B) - Warnings, emphasis points

Visual Elements:
  - Precise lines with consistent stroke weights
  - Technical schematics and clean vector graphics
  - Thin line work in technical drawing style
  - Connection lines use straight lines or 90-degree angles only
  - Data visualization with clean, minimal charts
  - Dimension lines and measurement indicators
  - Cross-section style diagrams

Density Guidelines:
  - Content per slide: 2-3 key points, moderate detail
  - Whitespace: Generous margins, balanced visual weight
  - Element count: 3-5 visual elements per slide

Style Rules:
  Do: Maintain consistent line weights, use grid alignment, keep color palette restrained, create clear visual hierarchy through scale, use geometric precision for all shapes
  Don't: Use hand-drawn or organic shapes, add decorative flourishes, use curved connection lines, include photographic elements, add slide numbers, footers, or logos
```

---

## SLIDE CONTENT

**Slide metadata**: Slide 4 of 15 · Type: Content

**Narrative (for composition)**: 解释 `make_lead_agent` 工厂模式。

**On-slide text (render exactly, zh-CN)**:

- **Headline**: 工厂函数：make_lead_agent 的 5 步组装
- **Sub-headline**: 每次请求动态构建全新 Agent 实例

**Five assembly steps (left-to-right or top-to-bottom pipeline, each step one short label + tiny icon area)**:

1. 解析配置 → `model_name`，`thinking_enabled`
2. 构建 Middleware 链 → 12–17 个
3. 加载工具 → Config + 内置 + MCP + ACP
4. 生成系统提示词
5. `create_agent()` → **CompiledStateGraph**（成品输出框内突出显示）

**Visual direction**:

- 蓝图风格装配流水线：5 个工位依次排列，带传送/连接示意（直线、直角）；每步配简约技术符号（齿轮、层叠方块、接口插头、文档页、`→` 箭头等几何化图标，非写实）。
- 末端输出：大号标注框 **CompiledStateGraph**（Engineering Blue 边框或填充浅蓝 #BFDBFE）。

**Layout**: linear-progression — 标题区 + 横向或纵向五段流水线，视觉终点为 CompiledStateGraph。

---

Please use nano banana pro to generate the slide image based on the content provided above.
