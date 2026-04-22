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

**Slide metadata**: Slide 5 of 15 · Type: Content

**Narrative (for composition)**: 澄清 Agent 的生命周期。

**On-slide text (render exactly, zh-CN)**:

- **Headline**: 每请求新建 Agent，但不是所有东西都重建
- **Sub-headline**: 理解「按请求创建」与「共享缓存」的边界

**Two-tier content (compress into 2–3 visual group labels if needed for max text elements rule)**:

- **上层标题条**：请求级（每次新建）— 内含条目：`CompiledStateGraph`、`Middleware`、`LLM Model`（可用小号列表置于该层框内）
- **下层标题条**：共享级（跨请求复用）— 内含：`MCP 工具列表（mtime 热更新）`；`Checkpointer`、`Store`（进程级共享）；`Thread + Checkpointer` 重建对话上下文

**Visual direction**:

- 蓝图风格双层剖面：上区域「请求级」、下区域「共享级」，中间 **水平虚线分隔带**（dimension-style 或剖面线）。
- 上下层各用矩形分区 + 直角连线示意数据流；上层可略亮（Light Blue 淡填），下层 Navy / Slate 稳重线框对比。

**Layout**: binary-comparison — 左右对称可选，但核心是 **上下二分 + 虚线分界**；标题在顶部，两层结构占画面主体。

---

Please use nano banana pro to generate the slide image based on the content provided above.
