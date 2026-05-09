/**
 * Email template for the AI × PM Daily digest.
 *
 * Edit this file to change the email's look and feel.
 * The content (stories, sources, try-it tasks) is supplied by Claude via
 * the submit_digest tool — you don't need to touch prompts or scripts to
 * restyle the email.
 *
 * Exports a single function: render(digest) → { html, text }
 *
 * `digest` shape (matches the submit_digest tool schema):
 *   {
 *     subject:     string,
 *     date_label:  string,                  // e.g. "Sat 9 May"
 *     greeting:    string,                  // e.g. "Good morning John,"
 *     intro:       string,                  // one-line scene-setter
 *     stories:     Array<{
 *       headline:  string,                  // may include emoji + author/medium
 *       body_html: string,                  // inline-formatted HTML fragment
 *       sources:   Array<{ url, label }>,
 *       try_it:    string,                  // one sentence
 *     }>,
 *     reflection:  string,                  // closing prompt
 *     sign_off:    string,                  // e.g. "Stay curious,\nYour AI Digest"
 *   }
 */

// ─── Style tokens — tweak these first ──────────────────────────────────────
const TOKENS = {
  bodyFont:
    "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Segoe UI', Roboto, sans-serif",
  bodyColor: "#1a1a1a",
  mutedColor: "#6b6b6b",
  accentColor: "#7a1e1e", // deep maroon, a16z-style
  bgColor: "#ffffff",
  maxWidth: "620px",

  // Masthead
  fontSizeMasthead: "36px",
  fontSizeDeck: "20px",
  fontSizeByline: "13px", // small caps label

  // Body
  fontSizeBody: "18px",
  fontSizeSmall: "14px",
  fontSizeHeadline: "26px",
  lineHeight: "1.65",
  storyGap: "44px",
  ruleColor: "#d9d9d9",
  ruleColorStrong: "#1a1a1a",
};

// ─── HTML rendering ────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSources(sources) {
  if (!sources || sources.length === 0) return "";
  const links = sources
    .map(
      (s) =>
        `<a href="${escapeHtml(s.url)}" style="color: ${TOKENS.accentColor}; text-decoration: underline;">${escapeHtml(s.label)}</a>`,
    )
    .join(" · ");
  return `<p style="font-size: ${TOKENS.fontSizeSmall}; color: ${TOKENS.mutedColor}; margin: 8px 0 0;"><strong>Source:</strong> ${links}</p>`;
}

function renderStory(story, isLast) {
  const trailingRule = isLast
    ? ""
    : `<hr style="border: none; border-top: 1px solid ${TOKENS.ruleColor}; margin: 0 0 ${TOKENS.storyGap};">`;
  return `
    <section style="margin-bottom: ${TOKENS.storyGap};">
      <h2 style="font-size: ${TOKENS.fontSizeHeadline}; font-weight: 700; margin: 0 0 16px; line-height: 1.25; letter-spacing: -0.01em;">${escapeHtml(story.headline)}</h2>
      <div style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; margin: 0 0 16px;">${story.body_html}</div>
      ${renderSources(story.sources)}
      <div style="margin: 24px 0 0; padding: 16px 20px; background: #f7f7f5; border-left: 3px solid ${TOKENS.accentColor};">
        <p style="font-size: ${TOKENS.fontSizeByline}; letter-spacing: 0.08em; text-transform: uppercase; color: ${TOKENS.mutedColor}; margin: 0 0 6px; font-weight: 600;">Try it</p>
        <p style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; margin: 0;">${escapeHtml(story.try_it)}</p>
      </div>
    </section>
    ${trailingRule}
  `;
}

function renderMasthead(d) {
  return `
    <header style="margin-bottom: ${TOKENS.storyGap};">
      <h1 style="font-size: ${TOKENS.fontSizeMasthead}; font-weight: 800; margin: 0 0 12px; line-height: 1.15; letter-spacing: -0.02em;">${escapeHtml(d.greeting)}</h1>
      <p style="font-size: ${TOKENS.fontSizeDeck}; line-height: 1.4; color: ${TOKENS.mutedColor}; margin: 0 0 24px; font-weight: 400;">${escapeHtml(d.intro)}</p>
      <p style="font-size: ${TOKENS.fontSizeByline}; letter-spacing: 0.08em; text-transform: uppercase; color: ${TOKENS.mutedColor}; margin: 0; font-weight: 600;">AI × PM Daily &nbsp;·&nbsp; ${escapeHtml(d.date_label)}</p>
    </header>
    <hr style="border: none; border-top: 2px solid ${TOKENS.ruleColorStrong}; margin: 0 0 ${TOKENS.storyGap};">
  `;
}

function renderHtml(d) {
  const stories = d.stories
    .map((s, i) => renderStory(s, i === d.stories.length - 1))
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 32px 24px; background: ${TOKENS.bgColor}; font-family: ${TOKENS.bodyFont}; color: ${TOKENS.bodyColor}; -webkit-font-smoothing: antialiased;">
  <div style="max-width: ${TOKENS.maxWidth}; margin: 0 auto;">
    ${renderMasthead(d)}
    ${stories}
    <div style="background: #f7f7f5; border-left: 3px solid ${TOKENS.accentColor}; padding: 20px 24px; margin: 0 0 ${TOKENS.storyGap};">
      <p style="font-size: ${TOKENS.fontSizeByline}; letter-spacing: 0.08em; text-transform: uppercase; color: ${TOKENS.mutedColor}; margin: 0 0 8px; font-weight: 600;">Worth sitting with</p>
      <p style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; margin: 0;">${escapeHtml(d.reflection)}</p>
    </div>
    <p style="font-size: ${TOKENS.fontSizeBody}; color: ${TOKENS.mutedColor}; line-height: ${TOKENS.lineHeight}; margin: 0; white-space: pre-line;">${escapeHtml(d.sign_off)}</p>
  </div>
</body>
</html>`;
}

// ─── Plain-text rendering ──────────────────────────────────────────────────
function stripTags(html) {
  return String(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderText(d) {
  const stories = d.stories
    .map((s) => {
      const sources = (s.sources || [])
        .map((src) => `${src.label} (${src.url})`)
        .join(" · ");
      return [
        s.headline,
        "",
        stripTags(s.body_html),
        sources ? `Source: ${sources}` : "",
        `TRY IT: ${s.try_it}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  return [
    d.greeting,
    "",
    d.intro,
    "",
    "---",
    "",
    stories,
    "",
    "---",
    "",
    `Worth sitting with: ${d.reflection}`,
    "",
    d.sign_off,
  ].join("\n");
}

// ─── Public API ────────────────────────────────────────────────────────────
export function render(digest) {
  return {
    html: renderHtml(digest),
    text: renderText(digest),
  };
}
