#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const mdPath =
  process.argv[2] ||
  path.join(__dirname, "deerflow-architecture-deep-dive.md");
const htmlPath =
  process.argv[3] ||
  path.join(__dirname, "deerflow-architecture-deep-dive.html");

const cssStartMarker = "/* df-mermaid-inline:start */";
const cssEndMarker = "/* df-mermaid-inline:end */";

function extractMermaidBlocks(markdown) {
  const blocks = [];
  const pattern = /```mermaid\r?\n([\s\S]*?)\r?\n```/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    blocks.push(match[1].trim());
  }
  return blocks;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripExistingCss(html) {
  const styleBlockPattern = new RegExp(
    `<style>\\s*${escapeRegExp(cssStartMarker)}[\\s\\S]*?${escapeRegExp(cssEndMarker)}\\s*</style>\\n?`,
    "g",
  );
  const cssPattern = new RegExp(
    `${escapeRegExp(cssStartMarker)}[\\s\\S]*?${escapeRegExp(cssEndMarker)}\\n?`,
    "g",
  );
  return html.replace(styleBlockPattern, "").replace(cssPattern, "");
}

function buildCss() {
  return `${cssStartMarker}
.df-mermaid-svg {
  margin: 28px 8px;
  padding: 18px;
  overflow-x: auto;
  border: 1px solid rgba(15, 76, 129, 0.12);
  border-radius: 10px;
  background: #ffffff;
  box-shadow: 0 8px 24px rgba(15, 76, 129, 0.06);
}
.df-mermaid-svg svg {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}
${cssEndMarker}
`;
}

function renderSvg(source, index, tmpDir) {
  const input = path.join(tmpDir, `diagram-${index}.mmd`);
  const output = path.join(tmpDir, `diagram-${index}.svg`);
  fs.writeFileSync(input, source);
  execFileSync(
    "npx",
    [
      "-y",
      "@mermaid-js/mermaid-cli",
      "-i",
      input,
      "-o",
      output,
      "-b",
      "transparent",
    ],
    {
      stdio: "pipe",
      cwd: path.dirname(mdPath),
    },
  );
  return fs.readFileSync(output, "utf8").trim();
}

function replaceMermaidPreBlocks(html, svgs) {
  let index = 0;
  return html.replace(/<pre class="mermaid">[\s\S]*?<\/pre>/g, () => {
    const svg = svgs[index];
    if (!svg) {
      throw new Error(`Missing rendered SVG for Mermaid block ${index}`);
    }
    index += 1;
    return `<div class="df-mermaid-svg" data-mermaid-index="${index}">\n${svg}\n</div>`;
  });
}

const markdown = fs.readFileSync(mdPath, "utf8");
let html = fs.readFileSync(htmlPath, "utf8");

const blocks = extractMermaidBlocks(markdown);
if (blocks.length === 0) {
  throw new Error(`No Mermaid blocks found in ${mdPath}`);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "deerflow-mermaid-"));
try {
  const svgs = blocks.map((block, index) => renderSvg(block, index, tmpDir));
  html = stripExistingCss(html);
  html = html.replace("</head>", `<style>\n${buildCss()}</style>\n</head>`);
  html = replaceMermaidPreBlocks(html, svgs);
  fs.writeFileSync(htmlPath, html);
  console.log(`Rendered ${svgs.length} Mermaid diagrams inline: ${htmlPath}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
