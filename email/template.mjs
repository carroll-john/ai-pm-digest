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
  bodyFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  bodyColor: "#1a1a1a",
  mutedColor: "#666",
  accentColor: "#0066cc",
  bgColor: "#ffffff",
  maxWidth: "640px",
  fontSizeBody: "16px",
  fontSizeSmall: "14px",
  fontSizeHeadline: "20px",
  lineHeight: "1.55",
  storyGap: "32px",
  ruleColor: "#e5e5e5",
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

function renderStory(story) {
  return `
    <section style="margin-bottom: ${TOKENS.storyGap};">
      <h2 style="font-size: ${TOKENS.fontSizeHeadline}; font-weight: 600; margin: 0 0 12px; line-height: 1.3;">${escapeHtml(story.headline)}</h2>
      <div style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; margin: 0 0 12px;">${story.body_html}</div>
      ${renderSources(story.sources)}
      <p style="font-size: ${TOKENS.fontSizeBody}; margin: 16px 0 0;"><strong>🎯 Try it:</strong> ${escapeHtml(story.try_it)}</p>
    </section>
    <hr style="border: none; border-top: 1px solid ${TOKENS.ruleColor}; margin: 0 0 ${TOKENS.storyGap};">
  `;
}

function renderHtml(d) {
  return `<!DOCTYPE html>
<html>
<body style="margin: 0; padding: 24px; background: ${TOKENS.bgColor}; font-family: ${TOKENS.bodyFont}; color: ${TOKENS.bodyColor};">
  <div style="max-width: ${TOKENS.maxWidth}; margin: 0 auto;">
    <p style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; margin: 0 0 8px;">${escapeHtml(d.greeting)}</p>
    <p style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; color: ${TOKENS.mutedColor}; margin: 0 0 ${TOKENS.storyGap};">${escapeHtml(d.intro)}</p>
    <hr style="border: none; border-top: 1px solid ${TOKENS.ruleColor}; margin: 0 0 ${TOKENS.storyGap};">
    ${d.stories.map(renderStory).join("")}
    <p style="font-size: ${TOKENS.fontSizeBody}; line-height: ${TOKENS.lineHeight}; margin: 0 0 24px;"><strong>Worth sitting with:</strong> ${escapeHtml(d.reflection)}</p>
    <p style="font-size: ${TOKENS.fontSizeBody}; color: ${TOKENS.mutedColor}; margin: 0; white-space: pre-line;">${escapeHtml(d.sign_off)}</p>
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
        `🎯 Try it: ${s.try_it}`,
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
