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

---

## SLIDE CONTENT

**Slide metadata**: Slide 12 of 15 | Type: Content

**Headline**: Sandbox 执行隔离：虚拟路径 + Provider 模式

**Sub-headline**: 本地开发与生产环境的双轨方案

**Body** (synthesize into 3–4 concise on-slide text elements in zh):
- LocalSandbox：subprocess 执行，路径校验隔离，默认禁用 bash
- AioSandbox：Docker 容器隔离，默认启用 bash
- 虚拟路径映射：/mnt/user-data/ → 真实文件系统
- 懒初始化 + SandboxMiddleware 管理生命周期

**Visual direction**: 蓝图风格的双层对比图。上层 LocalSandbox（开发环境），下层 AioSandbox（Docker 容器）。两层都显示虚拟路径到真实路径的映射箭头。

**Layout**: binary-comparison（上下双层对照，中间或两侧用对齐的映射箭头连接）

---

Please use nano banana pro to generate the slide image based on the content provided above.
