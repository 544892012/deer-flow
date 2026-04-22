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

**Slide metadata**: Slide 3 of 15 · Type: Content

**Narrative (for composition)**: 展示请求从 HTTP 入口到 ReAct 循环的完整路径。

**On-slide text (render exactly, zh-CN)**:

- **Headline**: 一条主线贯穿全局：核心调用链
- **Sub-headline**: 从 HTTP 请求到 ReAct 循环的 6 步旅程

**Flow steps (vertical stack, each step = one compact line: 序号 + 动作 + 文件名/关键词)**:

1. HTTP 请求 → `thread_runs.py`
2. `start_run()` → `services.py`
3. `run_agent()` → `worker.py`
4. `make_lead_agent()` → `agent.py`
5. `graph.astream()` → ReAct 循环
6. 逐 chunk → SSE 实时响应

**Visual direction**:

- 垂直蓝图流程图：6 个步骤自上而下，工程蓝 (#2563EB) 竖向连接线，直角转折。
- 画面右侧竖向分界线（细虚线或双竖线），标注两列小号文字：**项目代码** | **框架代码**（按步骤大致划分左右或左右着色区分，保持示意清晰）。

**Layout**: linear-progression — 标题在顶，流程占中部主体，右侧分界线与图例不挤占主标题区。

---

Please use nano banana pro to generate the slide image based on the content provided above.
