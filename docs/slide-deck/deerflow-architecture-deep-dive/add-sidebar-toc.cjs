#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const htmlPath =
  process.argv[2] ||
  path.join(__dirname, "deerflow-architecture-deep-dive.html");

const startMarker = "<!-- df-sidebar-toc:start -->";
const endMarker = "<!-- df-sidebar-toc:end -->";
const cssStartMarker = "/* df-sidebar-toc:start */";
const cssEndMarker = "/* df-sidebar-toc:end */";

function stripExisting(markup) {
  const blockPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\n?`,
    "g",
  );
  const styleBlockPattern = new RegExp(
    `<style>\\s*${escapeRegExp(cssStartMarker)}[\\s\\S]*?${escapeRegExp(cssEndMarker)}\\s*</style>\\n?`,
    "g",
  );
  const cssPattern = new RegExp(
    `${escapeRegExp(cssStartMarker)}[\\s\\S]*?${escapeRegExp(cssEndMarker)}\\n?`,
    "g",
  );
  return markup
    .replace(blockPattern, "")
    .replace(styleBlockPattern, "")
    .replace(cssPattern, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textFromHeading(innerHtml) {
  return innerHtml
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectHeadingIds(markup) {
  const headings = [];
  let index = 0;

  const nextMarkup = markup.replace(
    /<h([1-3])\b([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (match, level, attrs, innerHtml) => {
      if (!/\bdata-heading=["']true["']/i.test(attrs)) {
        return match;
      }

      const title = textFromHeading(innerHtml);
      if (!title) {
        return match;
      }

      const existingId = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
      const id = existingId || `toc-${index}`;
      const nextAttrs = existingId ? attrs : `${attrs} id="${id}"`;

      headings.push({
        id,
        level: Number(level),
        title,
      });
      index += 1;

      return `<h${level}${nextAttrs}>${innerHtml}</h${level}>`;
    },
  );

  return { markup: nextMarkup, headings };
}

function buildCss() {
  return `${cssStartMarker}
.df-sidebar-toc {
  box-sizing: border-box;
  width: 280px;
  padding: 18px 16px;
  border: 1px solid rgba(15, 76, 129, 0.16);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 8px 28px rgba(15, 76, 129, 0.08);
  color: #2d3748;
  font-family: -apple-system-font, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif;
}
.df-sidebar-toc__title {
  margin: 0 0 12px;
  color: #0F4C81;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}
.df-sidebar-toc__list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.df-sidebar-toc__link {
  display: block;
  padding: 5px 8px;
  border-radius: 6px;
  color: #344054;
  font-size: 13px;
  line-height: 1.45;
  text-decoration: none;
}
.df-sidebar-toc__link:hover {
  background: rgba(15, 76, 129, 0.08);
  color: #0F4C81;
}
.df-sidebar-toc__item--level-1 .df-sidebar-toc__link {
  font-weight: 700;
}
.df-sidebar-toc__item--level-3 .df-sidebar-toc__link {
  padding-left: 20px;
  color: #667085;
}
html {
  scroll-behavior: smooth;
}
[data-heading="true"] {
  scroll-margin-top: 24px;
}
@media (min-width: 1280px) {
  .df-sidebar-toc {
    position: fixed;
    z-index: 20;
    top: 24px;
    bottom: 24px;
    left: 24px;
    overflow-y: auto;
  }
  body {
    box-sizing: border-box;
    width: calc(100vw - 388px) !important;
    max-width: none !important;
    margin-left: 340px !important;
    margin-right: 48px !important;
    padding-left: 24px !important;
    padding-right: 48px !important;
  }
  #output {
    width: 100%;
  }
  #output > .container {
    width: 100%;
    max-width: none;
  }
}
@media (max-width: 1279px) {
  .df-sidebar-toc {
    width: auto;
    max-width: 860px;
    margin: 0 auto 24px;
  }
}
${cssEndMarker}
`;
}

function buildToc(headings) {
  const items = headings
    .map(
      (heading) =>
        `<li class="df-sidebar-toc__item df-sidebar-toc__item--level-${heading.level}"><a class="df-sidebar-toc__link" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.title)}</a></li>`,
    )
    .join("\n");

  return `${startMarker}
<nav class="df-sidebar-toc" aria-label="文章目录">
  <div class="df-sidebar-toc__title">目录</div>
  <ol class="df-sidebar-toc__list">
${items}
  </ol>
</nav>
${endMarker}
`;
}

let html = fs.readFileSync(htmlPath, "utf8");
html = stripExisting(html);

const { markup, headings } = injectHeadingIds(html);
if (headings.length === 0) {
  throw new Error(`No data-heading h1-h3 headings found in ${htmlPath}`);
}

html = markup;
html = html.replace("</head>", `<style>\n${buildCss()}</style>\n</head>`);
html = html.replace(/(<body\b[^>]*>\s*)/i, `$1\n${buildToc(headings)}`);

fs.writeFileSync(htmlPath, html);
console.log(`Injected sidebar TOC with ${headings.length} headings: ${htmlPath}`);
