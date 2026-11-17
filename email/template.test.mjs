import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "./template.mjs";

const sample = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "sample-digest.json"), "utf8"),
);

function digestWith(overrides) {
  return {
    ...sample,
    stories: [
      {
        ...sample.stories[0],
        ...overrides,
      },
      ...sample.stories.slice(1),
    ],
  };
}

function renderQuiet(input) {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  try {
    return { ...render(input), warnings };
  } finally {
    console.warn = warn;
  }
}

test("sample digest keeps allowed inline tags", () => {
  const { html, text } = renderQuiet(sample);
  assert.match(html, /<em>prompt injection<\/em>/);
  assert.match(html, /<strong>what<\/strong>/);
  assert.match(html, /<code>\$5<\/code>/);
  assert.match(html, /href="https:\/\/www\.youtube\.com\/watch\?v=wc8FBhQtdsA"/);
  assert.match(text, /prompt injection/);
  assert.equal(html.includes("<script"), false);
});

test("unterminated disallowed tag is escaped in the fully rendered document", () => {
  // Regression: tagRe required a closing `>`, so `<img …` with no `>` was
  // returned unchanged and the template's following `</div>` completed it.
  const { html } = renderQuiet(digestWith({
    body_html: 'Hello <img src=x onerror="alert(1)"',
  }));
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes('onerror="'), false);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;/);
});

test("body_html with a disallowed tag is escaped to text", () => {
  const { html, warnings } = renderQuiet(digestWith({
    body_html: 'Hello <script>alert(1)</script> world',
  }));
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt; world/);
  assert.equal(html.includes("<script>"), false);
  assert.equal(warnings.length > 0, true);
});

test("body_html event-handler attributes are escaped", () => {
  const { html } = renderQuiet(digestWith({
    body_html: 'Click <a href="https://example.com" onclick="alert(1)">here</a>',
  }));
  assert.equal(html.includes('onclick="'), false);
  assert.match(html, /&lt;a href=/);
});

test("body_html javascript href is escaped", () => {
  const { html } = renderQuiet(digestWith({
    body_html: 'Click <a href="javascript:alert(1)">here</a>',
  }));
  assert.equal(html.includes('href="javascript:'), false);
  assert.match(html, /&lt;a href=/);
});

test("body_html javascript href with HTML entity colon is escaped", () => {
  const { html } = renderQuiet(digestWith({
    body_html: 'Click <a href="javascript&colon;alert(1)">here</a>',
  }));
  assert.equal(html.includes('href="javascript'), false);
  assert.match(html, /&lt;a href=/);
});

test("body_html with a safe https link is preserved", () => {
  const { html, warnings } = renderQuiet(digestWith({
    body_html: 'See <a href="https://example.com/post">the post</a>.',
  }));
  assert.match(html, /<a href="https:\/\/example.com\/post">the post<\/a>/);
  assert.equal(warnings.length, 0);
});

test("source javascript URL is not placed in href", () => {
  const { html, warnings } = renderQuiet(digestWith({
    sources: [{ url: "javascript:alert(1)", label: "Evil", published_date: "2026-05-08" }],
  }));
  assert.equal(html.includes('href="javascript:'), false);
  assert.match(html, /Evil, 8 May 2026/);
  assert.equal(warnings.length > 0, true);
});

test("source URL quote breakout cannot inject attributes", () => {
  const { html } = renderQuiet(digestWith({
    sources: [{ url: 'https://example.com" onclick="alert(1)', label: "Breakout", published_date: "2026-05-08" }],
  }));
  assert.equal(html.includes('onclick="'), false);
  assert.match(html, /Breakout/);
});
