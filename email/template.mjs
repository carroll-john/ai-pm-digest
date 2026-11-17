// Email template for the AI × PM Daily digest. Edit this file to restyle the
// email — content is supplied by Claude via the submit_digest tool (schema in
// scripts/send-digest.mjs). Exports `render(digest) → { html, text }`.

// ─── Style tokens — tweak these first ──────────────────────────────────────
const T = {
  bodyFont: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif",
  bodyColor: "#1a1a1a",
  mutedColor: "#6b6b6b",
  accentColor: "#7a1e1e", // deep maroon, a16z-style
  bgColor: "#ffffff",
  panelBg: "#f7f7f5",
  maxWidth: "620px",
  fontSizeMasthead: "36px",
  fontSizeDeck: "20px",
  fontSizeByline: "13px",
  fontSizeBody: "18px",
  fontSizeSmall: "14px",
  fontSizeHeadline: "26px",
  lineHeight: "1.65",
  storyGap: "44px",
  ruleColor: "#d9d9d9",
  ruleColorStrong: "#1a1a1a",
};

const BYLINE_STYLE = `font-size: ${T.fontSizeByline}; letter-spacing: 0.08em; text-transform: uppercase; color: ${T.mutedColor}; font-weight: 600;`;
const PANEL_STYLE = `background: ${T.panelBg}; border-left: 3px solid ${T.accentColor};`;
const BODY_TEXT_STYLE = `font-size: ${T.fontSizeBody}; line-height: ${T.lineHeight};`;

// ─── HTML rendering ────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The model is instructed to use only inline tags inside body_html. If anything
// else appears (a stray <p>, a script tag, an unclosed tag), escape the whole
// fragment to plain text rather than breaking the surrounding email layout.
const ALLOWED_BODY_TAGS = new Set(["strong", "em", "a", "code"]);

// javascript:, data:, vbscript:, and protocol-relative URLs are XSS vectors
// if a model ever emits them. Gmail-class clients often neutralize them, but
// the trust boundary belongs here — including source URLs interpolated into
// href, not just body_html. Decode entities / strip C0 controls first so
// `javascript&colon;…` and `java\nscript:` don't slip past the scheme check.
function isSafeHref(href) {
  const decoded = decodeEntities(String(href ?? ""))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  try {
    const protocol = new URL(decoded).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

function rejectBodyHtml(html, reason) {
  console.warn(`template: ${reason} — escaping fragment to plain text.`);
  return escapeHtml(html);
}

function safeBodyHtml(html) {
  const source = String(html);
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  const attrRe = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let tagMatch;
  while ((tagMatch = tagRe.exec(source))) {
    const name = tagMatch[1].toLowerCase();
    const isClose = tagMatch[0].startsWith("</");
    const rawAttrs = tagMatch[2].trim().replace(/\/$/, "").trim();
    if (!ALLOWED_BODY_TAGS.has(name)) {
      return rejectBodyHtml(html, `disallowed tag <${name}> in body_html`);
    }
    if (isClose) {
      if (rawAttrs) return rejectBodyHtml(html, `attributes on closing </${name}> in body_html`);
      continue;
    }
    // <strong>/<em>/<code> carry no attributes — an onclick/style on any of
    // them is an XSS vector the previous tag-name-only check would miss.
    if (name !== "a") {
      if (rawAttrs) return rejectBodyHtml(html, `attributes on <${name}> in body_html`);
      continue;
    }
    attrRe.lastIndex = 0;
    const attrs = [];
    let attrMatch;
    while ((attrMatch = attrRe.exec(rawAttrs))) {
      attrs.push({ name: attrMatch[1].toLowerCase(), value: attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? "" });
    }
    if (attrs.length !== 1 || attrs[0].name !== "href") {
      const extra = attrs.find((a) => a.name !== "href");
      return rejectBodyHtml(html, extra
        ? `disallowed <a> attribute ${extra.name} in body_html`
        : "missing href on <a> in body_html");
    }
    if (!isSafeHref(attrs[0].value)) {
      return rejectBodyHtml(html, `disallowed href "${attrs[0].value}" in body_html`);
    }
  }
  return source;
}

function formatSourceDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(d);
}

function renderSources(sources) {
  if (!sources?.length) return "";
  const links = sources
    .map((s) => {
      const label = escapeHtml(s.label);
      const date = formatSourceDate(s.published_date);
      const dated = date ? `${label}, ${escapeHtml(date)}` : label;
      // Same scheme allowlist as body_html. escapeHtml does not neutralize
      // javascript: (no special characters), so a model-supplied source URL
      // must be rejected before it is placed in href.
      if (!isSafeHref(s.url)) {
        console.warn(`template: disallowed source URL "${s.url}" — rendering label only.`);
        return dated;
      }
      const link = `<a href="${escapeHtml(s.url)}" style="color: ${T.accentColor}; text-decoration: underline;">${label}</a>`;
      return date ? `${link}, ${escapeHtml(date)}` : link;
    })
    .join(" &nbsp;·&nbsp; ");
  return `<p style="font-size: ${T.fontSizeSmall}; color: ${T.mutedColor}; margin: 8px 0 0;"><strong>Source:</strong> ${links}</p>`;
}

function renderHtml(d) {
  const stories = d.stories
    .map((s, i) => {
      const rule = i === d.stories.length - 1
        ? ""
        : `<hr style="border: none; border-top: 1px solid ${T.ruleColor}; margin: 0 0 ${T.storyGap};">`;
      return `
    <section style="margin-bottom: ${T.storyGap};">
      <h2 style="font-size: ${T.fontSizeHeadline}; font-weight: 700; margin: 0 0 16px; line-height: 1.25; letter-spacing: -0.01em;">${escapeHtml(s.headline)}</h2>
      <div style="${BODY_TEXT_STYLE} margin: 0 0 16px;">${safeBodyHtml(s.body_html)}</div>
      ${renderSources(s.sources)}
      <div style="${PANEL_STYLE} margin: 24px 0 0; padding: 16px 20px;">
        <p style="${BYLINE_STYLE} margin: 0 0 6px;">Try it</p>
        <p style="${BODY_TEXT_STYLE} margin: 0;">${escapeHtml(s.try_it)}</p>
      </div>
    </section>
    ${rule}`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 32px 24px; background: ${T.bgColor}; font-family: ${T.bodyFont}; color: ${T.bodyColor}; -webkit-font-smoothing: antialiased;">
  <div style="max-width: ${T.maxWidth}; margin: 0 auto;">
    <header style="margin-bottom: ${T.storyGap};">
      <h1 style="font-size: ${T.fontSizeMasthead}; font-weight: 800; margin: 0 0 12px; line-height: 1.15; letter-spacing: -0.02em;">${escapeHtml(d.greeting)}</h1>
      <p style="font-size: ${T.fontSizeDeck}; line-height: 1.4; color: ${T.mutedColor}; margin: 0 0 24px; font-weight: 400;">${escapeHtml(d.intro)}</p>
      <p style="${BYLINE_STYLE} margin: 0;">AI × PM Daily &nbsp;·&nbsp; ${escapeHtml(d.date_label)}</p>
    </header>
    <hr style="border: none; border-top: 2px solid ${T.ruleColorStrong}; margin: 0 0 ${T.storyGap};">
    ${stories}
    <div style="${PANEL_STYLE} padding: 20px 24px; margin: 0 0 ${T.storyGap};">
      <p style="${BYLINE_STYLE} margin: 0 0 8px;">Worth sitting with</p>
      <p style="${BODY_TEXT_STYLE} margin: 0;">${escapeHtml(d.reflection)}</p>
    </div>
    <p style="${BODY_TEXT_STYLE} color: ${T.mutedColor}; margin: 0; white-space: pre-line;">${escapeHtml(d.sign_off)}</p>
  </div>
</body>
</html>`;
}

// ─── Plain-text rendering ──────────────────────────────────────────────────
// Only the 6 entities escapeHtml emits — the model writes prose using Unicode
// chars directly (— … ’ etc), so we don't need a wider table.
const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", colon: ":" };

function codePoint(n, radix) {
  try {
    return String.fromCodePoint(parseInt(n, radix));
  } catch {
    return "";
  }
}

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => codePoint(n, 16))
    .replace(/&#(\d+);/g, (_, n) => codePoint(n, 10))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function stripTags(html) {
  return decodeEntities(
    String(html).replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gis, "$2 ($1)").replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
}

function renderText(d) {
  const stories = d.stories
    .map((s) => {
      const sources = (s.sources || [])
        .map((src) => {
          const date = formatSourceDate(src.published_date);
          return `${date ? `${src.label}, ${date}` : src.label} (${src.url})`;
        })
        .join(" · ");
      return [s.headline, "", stripTags(s.body_html), sources && `Source: ${sources}`, `TRY IT: ${s.try_it}`]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  return [d.greeting, "", d.intro, "", "---", "", stories, "", "---", "", `Worth sitting with: ${d.reflection}`, "", d.sign_off].join("\n");
}

export function render(digest) {
  return { html: renderHtml(digest), text: renderText(digest) };
}
