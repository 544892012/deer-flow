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

**Slide metadata**: Slide 8 of 15 · Type: Content · Layout: **split-screen**

**Headline (zh)**: Middleware 双模式：图节点 vs 洋葱包裹

**Sub-headline (zh)**: 17 个中间件的精密协作机制

**Body (zh, left/right panels — summarize to fit max text elements)**:

- 左：图节点模式 — before_agent / before_model / after_model / after_agent（独立步骤链）
- 右：内联模式 — wrap_model_call / wrap_tool_call（同心洋葱层）
- 执行：Dangling → LLMError → Todo → Deferred → base；返回：反向传播

**Visual direction**: 左右分屏（split-screen）。左侧：水平链式蓝图节点，表示钩子作为图中独立步骤。右侧：wrap_model_call 洋葱剖面示意图 — 多层嵌套矩形，直线连接，由外向内或由内向外箭头表示调用与返回。中间可有一条细竖线分隔两区。配色：Engineering Blue 与 Navy 区分两模式。

**Composition**: 标题跨全宽；左右视觉重量平衡；中文标签精简，避免单屏文字块超过 3–4 个主要层级。

---

Please use nano banana pro to generate the slide image based on the content provided above.
