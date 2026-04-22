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

**Slide metadata**: Slide 10 of 15 · Type: Content · Layout: **linear-progression**

**Headline (zh)**: 决策权在 LLM：工具调用不是框架逻辑

**Sub-headline (zh)**: bind_tools → LLM 推理 → 检查 tool_calls

**Body (zh, three steps — align with visual)**:

- ① 调用前：bind_tools() 将工具 schema 序列化
- ② LLM 自主决策：历史 + 系统提示 + schema
- ③ 调用后：检查 AIMessage.tool_calls；框架只「问」与「执行」，不「决定」

**Visual direction**: 从左到右三步线性流程图（linear-progression）。步骤①：小框标注 bind_tools / schema。步骤②：中央节点显著放大，Engineering Blue 高亮， schematic「决策中心」可用几何化的「处理器/大脑」符号（纯矢量、非写实）。步骤③：输出检验框，标注 tool_calls。步骤间直角箭头连接。

**Composition**: 标题在上；三列或三段式横向布局；中文步骤序号 ①②③ 与主标题形成清晰层级，总主要文字块不超过 3–4 组。

---

Please use nano banana pro to generate the slide image based on the content provided above.
