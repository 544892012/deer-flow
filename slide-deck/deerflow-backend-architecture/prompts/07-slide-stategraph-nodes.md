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

**Slide metadata**: Slide 7 of 15 · Type: Content · Layout: **linear-progression**

**Headline (zh)**: StateGraph 完整节点图：15 个节点的精密编排

**Sub-headline (zh)**: Middleware 作为图节点参与 ReAct 循环

**Body (zh, schematic labels — group as 3–4 visual zones to respect text limits)**:

- 入口（一次）：ThreadData → Uploads → Sandbox
- 循环前：Summarization → ViewImage → model；循环后：Title → LoopDetection → 条件边
- 出口（一次）：Memory → Sandbox → END
- 内联：wrap_model_call / wrap_tool_call

**Visual direction**: 完整蓝图风格 StateGraph：约 15 个矩形/圆角工程节点，直线或直角连线。左侧浅蓝区块标注「入口」，中央较深蓝为「循环体」，右侧 Navy 区块为「出口」。内联包裹以附注或小框表示。整体从左到右线性推进感（linear-progression），节点名可读但保持 schematic 密度适中。

**Composition**: 标题在上；主图为横向流程蓝图；中文分区标题（入口 / 循环 / 出口）可用小号标签，避免超过 3–4 个主要文字层级。

---

Please use nano banana pro to generate the slide image based on the content provided above.
