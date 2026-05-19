import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../email/template.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../prompts");
const CACHE_DIR = path.resolve(__dirname, "../cache");
const CACHE_PATH = path.join(CACHE_DIR, "last-digest.json");
const RESEARCH_CACHE_PATH = path.join(CACHE_DIR, "last-research.json");
const HISTORY_PATH = path.join(CACHE_DIR, "history.json");
const SAMPLE_PATH = path.resolve(__dirname, "../email/sample-digest.json");
const HISTORY_WINDOW_DAYS = 14;
const HISTORY_WINDOW_MS = HISTORY_WINDOW_DAYS * 86400000;
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "ref_src"];

const fromCache = process.argv.includes("--from-cache");
const fromResearchCache = process.argv.includes("--from-research-cache");
const fromSample = process.argv.includes("--sample");
const dryRun = process.argv.includes("--dry-run");
const preview = process.argv.includes("--preview");

const RESEARCH_MODEL = "claude-haiku-4-5";
const WRITE_MODEL = "claude-sonnet-4-6";
const WEB_SEARCH_MAX_USES = 10;

const RESEARCH_TOOL_INSTRUCTIONS = `## Step 2: Submit research findings

Call the \`submit_research\` tool exactly once after gathering candidate stories. You are providing **raw material** — facts, quotes, sources — not polished prose. A second model will pick the strongest stories and write the final digest in its voice.

Aim for **5–8 candidate stories**. Cast a wider net than the final digest needs (3–5) so the writer has options. All candidates must be from the last 24–48 hours.

For each candidate, provide:
- A draft headline (plain, factual; include author and medium when relevant)
- A 4–6 sentence summary of what happened (concrete, no hype)
- 1–2 sentences on why it matters specifically to a Product Manager
- At least one real source URL from \`web_search\` results — never invent URLs
- Key facts as short bullet points (numbers, names, decisions, claims)
- Direct quotes or close paraphrases when the source is a person (podcaster, X post, newsletter author)

After calling \`submit_research\`, do not output further text.`;

const WRITE_INPUT_PREAMBLE = `## Research findings

A research stage has gathered candidate stories from the web. You do **not** have web access — work only from these findings. Pick the **3–5 strongest** stories, write each story body in your voice using the facts and quotes provided, and keep source URLs **exactly as given** (do not invent or modify URLs).`;

const SOURCE_ITEM_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string" },
    label: { type: "string", description: "e.g. 'Lenny's Newsletter — Why LinkedIn killed the APM program'." },
    published_date: {
      type: "string",
      description:
        "Publication date in ISO 8601 (YYYY-MM-DD). In Stage 1, extract from the article page or web_search metadata. In Stage 2, copy exactly from the research source. Omit the field rather than guessing.",
    },
  },
  required: ["url", "label"],
};

const readPrompt = (name) => fs.readFileSync(path.join(PROMPTS_DIR, name), "utf8").trim();

// The digest is delivered to a Melbourne reader, so the date label and subject
// line must reflect Melbourne local time — not the runner's UTC clock.
function melbourneDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const short = `${get("weekday")} ${get("day")} ${get("month")}`;
  return { short, full: `${short} ${get("year")}` };
}

// Normalize URLs so the dedup filter survives trailing slashes, hash fragments,
// and common tracking parameters that don't change the underlying article.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

function withinHistoryWindow(entries) {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  return entries.filter((e) => {
    const t = new Date(e.shipped_at).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(entries) ? withinHistoryWindow(entries) : [];
  } catch (err) {
    console.warn(`Could not read history at ${HISTORY_PATH}: ${err.message}`);
    return [];
  }
}

function renderHistoryContext(history) {
  if (history.length === 0) {
    return `## Already-shipped history (last ${HISTORY_WINDOW_DAYS} days)\n\nNo prior digests on record yet — no exclusions.`;
  }
  const grouped = new Map();
  for (const entry of history) {
    const key = entry.date_label || entry.shipped_at?.slice(0, 10) || "unknown";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  const days = Array.from(grouped.entries())
    .sort(([, a], [, b]) => (b[0].shipped_at || "").localeCompare(a[0].shipped_at || ""))
    .map(([label, entries]) => {
      const stories = entries
        .map((e) => `  - ${e.headline}${(e.urls || []).map((u) => `\n    - ${u}`).join("")}`)
        .join("\n");
      return `- ${label}\n${stories}`;
    })
    .join("\n");
  return `## Already-shipped history (last ${HISTORY_WINDOW_DAYS} days)

These stories and source URLs have already gone out. Do **not** propose anything that points to one of these URLs, and avoid re-covering the same underlying announcement, podcast episode, or post — even at a different URL — unless there is genuinely new information (e.g. a follow-up post, a new data point, a meaningful update). If a topic continues to evolve, frame the new candidate around the *new* development, not a recap.

${days}`;
}

function logUsage(label, r) {
  const u = r.usage || {};
  const ws = u.server_tool_use?.web_search_requests;
  const tail = ws != null ? `, web_search=${ws}` : "";
  console.log(`${label} usage: input=${u.input_tokens ?? "?"}, output=${u.output_tokens ?? "?"}${tail}`);
}

async function runStage(client, label, model, prompt, tools, toolName, maxTokens = 5000) {
  console.log(`${label} (${model}): prompt ${prompt.length} chars`);
  const r = await client.messages.create({
    model,
    max_tokens: maxTokens,
    tools,
    messages: [{ role: "user", content: prompt }],
  });
  logUsage(label, r);
  const block = r.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (!block) {
    console.error(`${label} did not call ${toolName}. Stop reason:`, r.stop_reason);
    console.error("Response content:\n", JSON.stringify(r.content, null, 2));
    process.exit(1);
  }
  return block.input;
}

// When Haiku stringifies `candidates` AND the string gets truncated by
// max_tokens, JSON.parse fails on the dangling tail. Walk the array tracking
// brace depth + string state, find the end of the last complete object inside
// the outer `[...]`, and parse that prefix with a synthetic closing `]`.
function tryParseTruncatedArray(s) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let arrayStarted = false;
  const completeObjectEnds = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (!arrayStarted) {
      if (c === "[") { arrayStarted = true; depth = 1; }
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (c === "}" && depth === 1) completeObjectEnds.push(i + 1);
    }
  }
  if (completeObjectEnds.length === 0) return null;
  const cutoff = completeObjectEnds[completeObjectEnds.length - 1];
  try {
    return JSON.parse(s.slice(0, cutoff) + "]");
  } catch {
    return null;
  }
}

function loadJson(p, label) {
  if (!fs.existsSync(p)) {
    console.error(`No ${label} at ${p}. Run once without the corresponding flag to populate it.`);
    process.exit(1);
  }
  console.log(`Loading ${label} from ${p} (no API call).`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

fs.mkdirSync(CACHE_DIR, { recursive: true });

let digest;

if (fromSample) {
  console.log(`Loading sample digest from ${SAMPLE_PATH} (no API call).`);
  digest = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
} else if (fromCache) {
  digest = loadJson(CACHE_PATH, "cached digest");
} else {
  const anthropic = new Anthropic();

  const today = melbourneDate();
  const dateContext = `**Today's date in Melbourne:** ${today.full}. Use \`${today.short}\` as the \`date_label\` and \`AI × PM Daily — ${today.short}\` as the \`subject\`. "Last 24–48 hours" is relative to this date.`;
  console.log(`Melbourne date: ${today.full}`);

  const systemPrompt = readPrompt("00-system.md");

  const history = loadHistory();
  const historyUrls = new Set(history.flatMap((e) => (e.urls || []).map(normalizeUrl)));
  console.log(
    `History: ${history.length} prior stories across ${new Set(history.map((e) => e.date_label)).size} days; ${historyUrls.size} unique URLs to exclude.`,
  );

  // ── Stage 1: Research with Haiku 4.5 ─────────────────────────────────────
  let research;
  if (fromResearchCache) {
    research = loadJson(RESEARCH_CACHE_PATH, "cached research");
  } else {
    const researchPrompt = [
      systemPrompt, dateContext, readPrompt("01-research.md"),
      renderHistoryContext(history), RESEARCH_TOOL_INSTRUCTIONS,
    ].join("\n\n---\n\n");

    // Haiku tends to stringify the `candidates` array (every quote/brace gets
    // escaped), roughly doubling token cost. 16k leaves plenty of headroom so
    // the response isn't truncated mid-JSON on a heavy research day.
    research = await runStage(anthropic, "Stage 1", RESEARCH_MODEL, researchPrompt, [
      { type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES },
      {
        name: "submit_research",
        description:
          "Submit candidate stories as raw structured data for a downstream writer model. Call this exactly once after research is complete.",
        input_schema: {
          type: "object",
          properties: {
            candidates: {
              type: "array",
              minItems: 4,
              maxItems: 10,
              items: {
                type: "object",
                properties: {
                  headline_draft: {
                    type: "string",
                    description:
                      "Plain factual headline. Include author/medium where relevant, e.g. \"Lenny's Podcast: …\", \"Anthropic ships …\". No emojis.",
                  },
                  summary: { type: "string", description: "4–6 sentences. What happened, concrete and factual. No hype." },
                  why_pm: { type: "string", description: "1–2 sentences on why this matters to a Product Manager." },
                  key_facts: {
                    type: "array",
                    minItems: 1,
                    description: "Short bullet-point facts: numbers, names, decisions, claims.",
                    items: { type: "string" },
                  },
                  quotes: {
                    type: "array",
                    description:
                      "Direct quotes or close paraphrases (especially for podcasts, X posts, newsletter pieces). Optional but useful.",
                    items: { type: "string" },
                  },
                  sources: {
                    type: "array",
                    minItems: 1,
                    description: "Real URLs from web_search results. Never invent URLs.",
                    items: SOURCE_ITEM_SCHEMA,
                  },
                },
                required: ["headline_draft", "summary", "why_pm", "key_facts", "sources"],
              },
            },
            themes: {
              type: "string",
              description: "1–2 sentences on common threads across the candidates — helps the writer craft the intro and reflection.",
            },
          },
          required: ["candidates", "themes"],
        },
      },
    ], "submit_research", 16000);

    // Haiku sometimes emits `candidates` as a JSON-encoded string instead of an
    // array. Parse it back so Stage 2 receives clean structured JSON.
    if (typeof research.candidates === "string") {
      try {
        research.candidates = JSON.parse(research.candidates);
        console.log("Stage 1 note: parsed candidates string back into an array.");
      } catch {
        const salvaged = tryParseTruncatedArray(research.candidates);
        if (salvaged && salvaged.length >= 3) {
          console.warn(`Stage 1 note: candidates string was truncated; salvaged ${salvaged.length} complete entries.`);
          research.candidates = salvaged;
        } else {
          console.error("Stage 1 emitted candidates as a non-JSON string and could not be salvaged. Aborting.");
          console.error("First 500 chars:", research.candidates.slice(0, 500));
          process.exit(1);
        }
      }
    }

    fs.writeFileSync(RESEARCH_CACHE_PATH, JSON.stringify(research, null, 2));
    console.log(
      `Stage 1 complete: ${Array.isArray(research.candidates) ? research.candidates.length : 0} candidate stories. Cached to ${RESEARCH_CACHE_PATH}`,
    );
  }

  // Drop any candidate that points to a URL we've already shipped. Belt-and-
  // braces — the prompt told Haiku to avoid these, but models drift, and this
  // also catches the case where --from-research-cache replays older research
  // whose stories have since gone out.
  if (Array.isArray(research.candidates) && historyUrls.size > 0) {
    const before = research.candidates.length;
    research.candidates = research.candidates.filter((c) => {
      const hit = (c.sources || []).map((s) => normalizeUrl(s.url)).find((u) => historyUrls.has(u));
      if (hit) console.log(`  drop: "${c.headline_draft}" → ${hit}`);
      return !hit;
    });
    const after = research.candidates.length;
    if (before !== after) console.log(`History filter: ${before - after}/${before} candidates dropped`);
    if (after < 3) console.warn(`Only ${after} candidates after filter — Stage 2 may struggle to hit 3–5 stories.`);
  }

  // ── Stage 2: Write with Sonnet 4.6 ───────────────────────────────────────
  const writePrompt = [
    systemPrompt, dateContext,
    readPrompt("02-digest-format.md"), readPrompt("03-try-it-tasks.md"), readPrompt("04-output.md"),
    `${WRITE_INPUT_PREAMBLE}\n\n\`\`\`json\n${JSON.stringify(research, null, 2)}\n\`\`\``,
  ].join("\n\n---\n\n");

  digest = await runStage(anthropic, "Stage 2", WRITE_MODEL, writePrompt, [
    {
      name: "submit_digest",
      description:
        "Submit the final compiled digest as structured data. Call this exactly once. Do NOT write HTML — a separate template file renders the email.",
      input_schema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Email subject line, e.g. 'AI × PM Daily — Sat 9 May'. No emojis." },
          date_label: { type: "string", description: "Short date label, e.g. 'Sat 9 May'." },
          greeting: { type: "string", description: "Opening greeting line, e.g. 'Good morning John,'." },
          intro: { type: "string", description: "One-line scene-setter under the greeting." },
          stories: {
            type: "array",
            minItems: 3,
            maxItems: 5,
            items: {
              type: "object",
              properties: {
                headline: {
                  type: "string",
                  description:
                    "Plain-text story headline. Include author and medium when relevant, e.g. \"Lenny's Podcast: …\" or \"Shreyas Doshi on X: …\". No emojis.",
                },
                body_html: {
                  type: "string",
                  description:
                    "The story body as an HTML fragment (no <p> wrappers needed — the template adds them). Use only inline tags: <strong>, <em>, <a>, <code>. 3–5 sentences. Substance over fluff.",
                },
                sources: {
                  type: "array",
                  minItems: 1,
                  description:
                    "Use the source URLs from the research findings exactly as given. Never invent or modify URLs. Preserve `published_date` when the research provided one.",
                  items: SOURCE_ITEM_SCHEMA,
                },
                try_it: {
                  type: "string",
                  description: "One-sentence hands-on task. Action verb + tool + specific thing. No explanation.",
                },
              },
              required: ["headline", "body_html", "sources", "try_it"],
            },
          },
          reflection: { type: "string", description: "Closing 'Worth sitting with' question or observation." },
          sign_off: { type: "string", description: "Sign-off, e.g. 'Stay curious,\\nYour AI Digest'." },
        },
        required: ["subject", "date_label", "greeting", "intro", "stories", "reflection", "sign_off"],
      },
    },
  ], "submit_digest");

  fs.writeFileSync(CACHE_PATH, JSON.stringify(digest, null, 2));
  console.log(`Stage 2 complete: cached digest to ${CACHE_PATH}`);
}

console.log(`Digest ready: "${digest.subject}" (${digest.stories?.length} stories)`);

const { html, text } = render(digest);

if (preview) {
  const previewPath = path.join(CACHE_DIR, "preview.html");
  fs.writeFileSync(previewPath, html);
  console.log(`Preview written to ${previewPath}\nOpen with:  open ${previewPath}`);
  process.exit(0);
}

if (dryRun) {
  console.log("\n=== DRY RUN — rendered email (skipping send) ===\n");
  console.log("SUBJECT:", digest.subject);
  console.log(`\n--- HTML ---\n\n${html}`);
  console.log(`\n--- PLAIN TEXT ---\n\n${text}`);
  process.exit(0);
}

console.log("Sending via Resend...");

const resendRes = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: process.env.FROM_EMAIL,
    to: [process.env.TO_EMAIL],
    subject: digest.subject,
    html,
    text,
  }),
});

if (!resendRes.ok) {
  console.error(`Resend failed (${resendRes.status}):`, await resendRes.text());
  console.error("Digest content was:\n", JSON.stringify(digest, null, 2));
  process.exit(1);
}

const resendBody = await resendRes.json();
if (!resendBody?.id) {
  console.error("Resend returned 2xx but no message id:", JSON.stringify(resendBody));
  process.exit(1);
}
console.log(`Sent. Resend message ID: ${resendBody.id}`);

// Only persist history on a real send. --from-cache and --sample re-emit a
// digest that already shipped (or a fixture), so they must not pollute the
// rolling exclusion list. --from-research-cache still produces a fresh digest
// from cached research and gets persisted normally.
if (!fromCache && !fromSample) {
  const newEntries = (digest.stories || []).map((s) => ({
    shipped_at: new Date().toISOString(),
    date_label: digest.date_label,
    headline: s.headline,
    urls: (s.sources || []).map((src) => normalizeUrl(src.url)),
  }));
  const updated = [...withinHistoryWindow(loadHistory()), ...newEntries];
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(updated, null, 2));
  console.log(`History updated: ${updated.length} entries within ${HISTORY_WINDOW_DAYS}-day window → ${HISTORY_PATH}`);
}
