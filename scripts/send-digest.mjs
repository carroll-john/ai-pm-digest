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
const HOLDOVER_PATH = path.join(CACHE_DIR, "holdover.json");
const LAST_FAILURE_PATH = path.join(CACHE_DIR, "last-failure.json");
const SAMPLE_PATH = path.resolve(__dirname, "../email/sample-digest.json");
const HISTORY_WINDOW_DAYS = 14;
const HISTORY_WINDOW_MS = HISTORY_WINDOW_DAYS * 86400000;
const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "ref_src"];
// Server-side dedup + freshness controls. The Stage 1 prompt asks for the last
// 24–48 hours, but the model drifts; this is the backstop.
const MAX_AGE_HOURS = 72;
const TITLE_OVERLAP_THRESHOLD = 0.3;
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "for", "nor", "so", "yet",
  "of", "in", "on", "at", "by", "to", "from", "with", "into", "onto", "via",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "it", "its", "this", "that", "these", "those",
  "as", "if", "while", "when", "than", "then",
  "has", "have", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can",
  "new", "today", "now", "just",
]);

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
  const isoParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Melbourne",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const isoGet = (type) => isoParts.find((p) => p.type === type)?.value;
  const iso = `${isoGet("year")}-${isoGet("month")}-${isoGet("day")}`;
  return { short, full: `${short} ${get("year")}`, iso, monthYear: `${get("month")} ${get("year")}` };
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

// Token-set for fuzzy headline-overlap dedup. Lowercase, strip punctuation,
// drop short tokens and stopwords. The remaining tokens carry the topic
// signal that Jaccard similarity is meant to compare.
function titleTokens(s) {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !TITLE_STOPWORDS.has(t)),
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

// Returns the newest parseable `published_date` across a candidate's sources,
// or null if none parse. Used by the freshness filter — a candidate is as
// fresh as its newest source.
function newestSourceDate(sources) {
  if (!Array.isArray(sources)) return null;
  let newest = null;
  for (const s of sources) {
    if (!s?.published_date) continue;
    const t = new Date(s.published_date).getTime();
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest;
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

// Candidates that survived Stage 1 filtering on a previous run but never
// shipped (NO-NEWS abort). The next run merges them into its candidate pool
// before the freshness filter, giving them one more shot at the digest. The
// freshness filter then drops anything that's now older than MAX_AGE_HOURS,
// so the holdover expires naturally within ~24h.
function loadHoldover() {
  if (!fs.existsSync(HOLDOVER_PATH)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(HOLDOVER_PATH, "utf8"));
    return Array.isArray(entries) ? entries : [];
  } catch (err) {
    console.warn(`Could not read holdover at ${HOLDOVER_PATH}: ${err.message}`);
    return [];
  }
}

function clearHoldover() {
  if (fs.existsSync(HOLDOVER_PATH)) {
    fs.rmSync(HOLDOVER_PATH);
    console.log(`Cleared holdover at ${HOLDOVER_PATH}`);
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

// Writes a structured failure record so notify-failure.mjs can surface a
// specific subject prefix and actionable "What to do" hint, instead of the
// recipient having to read the log tail and reverse-engineer the cause.
function recordFailure({ kind, subjectTag, stage, summary, hint, detail }) {
  const payload = {
    kind,
    subject_tag: subjectTag,
    stage,
    summary,
    hint,
    detail,
    occurred_at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(LAST_FAILURE_PATH, JSON.stringify(payload, null, 2));
  } catch (err) {
    console.error(`Could not write ${LAST_FAILURE_PATH}: ${err.message}`);
  }
  console.error(`FAILURE [${kind}]${stage ? ` (${stage})` : ""}: ${summary}`);
  if (hint) console.error(`HINT: ${hint}`);
  if (detail) console.error(`DETAIL: ${detail}`);
  process.exit(1);
}

// Maps an @anthropic-ai/sdk error onto the structured failure shape. Status
// codes drive the category; the credit-balance message is the only string we
// pattern-match on because Anthropic returns it as a generic 400 rather than a
// dedicated error type.
function classifyAnthropicError(err, stage) {
  const status = err?.status;
  const apiError = err?.error?.error ?? err?.error ?? {};
  const message = apiError.message ?? err?.message ?? String(err);
  const type = apiError.type ?? err?.name ?? "unknown";
  const detail = `${type}: ${message}`;
  const lower = message.toLowerCase();

  if (status == null) {
    return {
      kind: "ANTHROPIC_NETWORK", subjectTag: "NETWORK", stage, detail,
      summary: `${stage} failed: could not reach Anthropic.`,
      hint: "Likely a transient network/DNS issue. Re-dispatch the workflow.",
    };
  }
  if (status === 400 && lower.includes("credit balance")) {
    return {
      kind: "ANTHROPIC_CREDIT", subjectTag: "CREDIT", stage, detail,
      summary: `${stage} failed: Anthropic credit balance is exhausted.`,
      hint: "Top up at https://console.anthropic.com/settings/billing, then re-dispatch the workflow from the Actions tab.",
    };
  }
  if (status === 401) {
    return {
      kind: "ANTHROPIC_AUTH", subjectTag: "AUTH", stage, detail,
      summary: `${stage} failed: Anthropic rejected the API key.`,
      hint: "Generate a new key at https://console.anthropic.com/settings/keys, update the ANTHROPIC_API_KEY GitHub secret, then re-dispatch.",
    };
  }
  if (status === 403) {
    return {
      kind: "ANTHROPIC_PERMISSION", subjectTag: "AUTH", stage, detail,
      summary: `${stage} failed: Anthropic denied access (${type}).`,
      hint: "Check that the API key has permission for the model in use. Update the ANTHROPIC_API_KEY secret if needed, then re-dispatch.",
    };
  }
  if (status === 429) {
    return {
      kind: "ANTHROPIC_RATE", subjectTag: "RATE", stage, detail,
      summary: `${stage} failed: Anthropic rate-limited the request.`,
      hint: "Wait 1–5 minutes and re-dispatch. Persistent rate-limits: see https://console.anthropic.com/settings/limits.",
    };
  }
  if (status >= 500) {
    return {
      kind: "ANTHROPIC_SERVER", subjectTag: "OUTAGE", stage, detail,
      summary: `${stage} failed: Anthropic returned ${status} (${type}).`,
      hint: "Check https://status.anthropic.com. Re-dispatch once the incident clears.",
    };
  }
  return {
    kind: "ANTHROPIC_OTHER", subjectTag: "API", stage, detail,
    summary: `${stage} failed: Anthropic returned ${status} (${type}).`,
    hint: "Check the log tail and https://status.anthropic.com, then re-dispatch.",
  };
}

function classifyResendError(status, bodyText) {
  const detail = `HTTP ${status}: ${bodyText}`;
  if (status === 401) {
    return {
      kind: "RESEND_AUTH", subjectTag: "AUTH", stage: "Resend send", detail,
      summary: "Resend rejected the API key.",
      hint: "Generate a new key at https://resend.com/api-keys, update the RESEND_API_KEY GitHub secret, then re-dispatch.",
    };
  }
  if (status === 403) {
    return {
      kind: "RESEND_FORBIDDEN", subjectTag: "RESEND", stage: "Resend send", detail,
      summary: "Resend denied the send (403).",
      hint: "Most often the FROM_EMAIL domain isn't verified. Check https://resend.com/domains and update FROM_EMAIL if needed, then re-dispatch.",
    };
  }
  if (status === 422) {
    return {
      kind: "RESEND_VALIDATION", subjectTag: "RESEND", stage: "Resend send", detail,
      summary: "Resend rejected the email payload (422).",
      hint: "Check FROM_EMAIL / TO_EMAIL format and that the from-domain is verified at https://resend.com/domains.",
    };
  }
  if (status === 429) {
    return {
      kind: "RESEND_RATE", subjectTag: "RATE", stage: "Resend send", detail,
      summary: "Resend rate-limited the send.",
      hint: "Wait a few minutes and re-dispatch. Check https://resend.com/api-keys for plan limits.",
    };
  }
  return {
    kind: "RESEND_OTHER", subjectTag: "RESEND", stage: "Resend send", detail,
    summary: `Resend send failed (${status}).`,
    hint: "Check https://resend.com and the log tail. Re-dispatch to retry.",
  };
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
    recordFailure({
      kind: label.startsWith("Stage 1") ? "STAGE1_INVALID_OUTPUT" : "STAGE2_INVALID_OUTPUT",
      subjectTag: "BUG",
      stage: label,
      summary: `${label} did not call the ${toolName} tool (stop_reason: ${r.stop_reason}).`,
      hint: "The model returned text instead of a structured tool call. Re-dispatch the workflow once; if it persists, the prompt or schema may need adjusting.",
      detail: `Response content: ${JSON.stringify(r.content)}`,
    });
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
  // Cutoff is "today minus 2 days" — the freshness backstop drops anything
  // older than 48h, so anything dated on/after this should pass.
  const cutoff = melbourneDate(new Date(Date.now() - 2 * 86400000));
  const dateContext = [
    `**Today's date in Melbourne:** ${today.full} (\`${today.iso}\`).`,
    `Use \`${today.short}\` as the \`date_label\` and \`AI × PM Daily — ${today.short}\` as the \`subject\`.`,
    `**Freshness floor: \`${cutoff.iso}\`.** Drop any web_search result whose publication date is earlier than this — do not include it as a candidate. Trust the date in the snippet; if no date is visible, search the article page before keeping it.`,
  ].join(" ");
  console.log(`Melbourne date: ${today.full}; freshness floor: ${cutoff.iso}`);

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
    // Inject the actual date into the prompt's literal placeholders so
    // web_search receives concrete strings (e.g. "2026-05-27") instead of the
    // model having to interpret "[today's date]" — relevance ranking otherwise
    // wins over recency and surfaces stories from weeks ago.
    const researchTemplate = readPrompt("01-research.md")
      .replaceAll("[today's date]", today.iso)
      .replaceAll("[this week OR this month]", `after:${cutoff.iso}`)
      .replaceAll("[this week]", `after:${cutoff.iso}`)
      .replaceAll("[today's month and year]", today.monthYear);
    const researchPrompt = [
      systemPrompt, dateContext, researchTemplate,
      renderHistoryContext(history), RESEARCH_TOOL_INSTRUCTIONS,
    ].join("\n\n---\n\n");

    // Haiku tends to stringify the `candidates` array (every quote/brace gets
    // escaped), roughly doubling token cost. 16k leaves plenty of headroom so
    // the response isn't truncated mid-JSON on a heavy research day.
    const stage1Tools = [
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
    ];

    // On a 429, retry once after a 65s pause with web_search max_uses halved.
    // The per-minute rate limit (input tokens) clears in 60s; halving max_uses
    // shrinks the search-result payload that web_search folds into the prompt,
    // which is the dominant input-token cost. Floored at 3 — any lower and
    // the candidate pool gets too thin for the dedup filters.
    let stage1Attempt = 0;
    while (true) {
      try {
        research = await runStage(anthropic, "Stage 1", RESEARCH_MODEL, researchPrompt, stage1Tools, "submit_research", 16000);
        break;
      } catch (err) {
        if (stage1Attempt === 0 && err?.status === 429 && stage1Tools[0].max_uses > 3) {
          stage1Attempt++;
          const previous = stage1Tools[0].max_uses;
          stage1Tools[0].max_uses = Math.max(3, Math.floor(previous / 2));
          console.warn(`Stage 1 rate-limited (429); waiting 65s then retrying with web_search max_uses=${stage1Tools[0].max_uses} (was ${previous}).`);
          await new Promise((r) => setTimeout(r, 65000));
          continue;
        }
        recordFailure(classifyAnthropicError(err, "Stage 1"));
        break;
      }
    }

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
          recordFailure({
            kind: "STAGE1_INVALID_OUTPUT", subjectTag: "BUG", stage: "Stage 1",
            summary: "Stage 1 emitted candidates as a string the script could not parse or salvage.",
            hint: "Likely a code change is needed: tighten the Stage 1 prompt or extend the salvage helper in send-digest.mjs. The raw model output is in the log tail below.",
            detail: `First 500 chars of candidates string: ${research.candidates.slice(0, 500)}`,
          });
        }
      }
    }

    fs.writeFileSync(RESEARCH_CACHE_PATH, JSON.stringify(research, null, 2));
    console.log(
      `Stage 1 complete: ${Array.isArray(research.candidates) ? research.candidates.length : 0} candidate stories. Cached to ${RESEARCH_CACHE_PATH}`,
    );
  }

  // Merge in any held-over candidates from a previous NO-NEWS abort. They go
  // through the same filters as fresh candidates below; anything that's now
  // older than MAX_AGE_HOURS drops off naturally. Dedup by primary URL so a
  // holdover that re-surfaced today doesn't appear twice.
  const holdover = loadHoldover();
  if (holdover.length > 0 && Array.isArray(research.candidates)) {
    const seenUrls = new Set(
      research.candidates.flatMap((c) => (c.sources || []).map((s) => normalizeUrl(s?.url))).filter(Boolean),
    );
    const merged = [];
    for (const h of holdover) {
      const urls = (h.sources || []).map((s) => normalizeUrl(s?.url)).filter(Boolean);
      if (urls.some((u) => seenUrls.has(u))) continue;
      merged.push(h);
      urls.forEach((u) => seenUrls.add(u));
    }
    if (merged.length > 0) {
      research.candidates = [...research.candidates, ...merged];
      console.log(`Merged ${merged.length} holdover candidate(s) from previous run.`);
    }
  }

  // Three server-side filters between Stage 1 and Stage 2. The Stage 1 prompt
  // already asks for fresh, non-duplicate stories, but models drift; these
  // are the mechanical backstop. Every drop and every close-call is logged
  // so the thresholds can be tuned against real output.

  // 1. Freshness — drop candidates whose newest source is older than the
  //    cutoff. Missing dates are kept (the prompt forbids inventing dates,
  //    so absence is preferable to a guess).
  if (Array.isArray(research.candidates)) {
    const cutoff = Date.now() - MAX_AGE_HOURS * 3600000;
    const before = research.candidates.length;
    research.candidates = research.candidates.filter((c) => {
      const newest = newestSourceDate(c.sources);
      if (newest === null) {
        console.log(`  no date — keeping: "${c.headline_draft}"`);
        return true;
      }
      if (newest < cutoff) {
        const ageH = Math.round((Date.now() - newest) / 3600000);
        console.log(`  drop (stale ${ageH}h): "${c.headline_draft}"`);
        return false;
      }
      return true;
    });
    const after = research.candidates.length;
    if (before !== after) console.log(`Freshness filter: ${before - after}/${before} candidates dropped (age > ${MAX_AGE_HOURS}h)`);
  }

  // 2. Title overlap — Jaccard similarity of significant tokens against every
  //    history headline. Catches the common case where the same underlying
  //    story appears at a different URL on a different day.
  if (Array.isArray(research.candidates) && history.length > 0) {
    const histTokenSets = history.map((e) => ({ headline: e.headline, tokens: titleTokens(e.headline) }));
    const before = research.candidates.length;
    research.candidates = research.candidates.filter((c) => {
      const ct = titleTokens(c.headline_draft);
      let bestScore = 0;
      let bestMatch = null;
      for (const h of histTokenSets) {
        const s = jaccard(ct, h.tokens);
        if (s > bestScore) { bestScore = s; bestMatch = h.headline; }
      }
      if (bestScore >= TITLE_OVERLAP_THRESHOLD) {
        console.log(`  drop (title overlap ${bestScore.toFixed(2)}): "${c.headline_draft}" ~~ "${bestMatch}"`);
        return false;
      }
      if (bestScore >= TITLE_OVERLAP_THRESHOLD - 0.1) {
        console.log(`  close call (${bestScore.toFixed(2)}): "${c.headline_draft}" ~~ "${bestMatch}"`);
      }
      return true;
    });
    const after = research.candidates.length;
    if (before !== after) console.log(`Title-overlap filter: ${before - after}/${before} candidates dropped (Jaccard >= ${TITLE_OVERLAP_THRESHOLD})`);
  }

  // 3. URL match — exact-URL repeats from history. Cheap, deterministic;
  //    catches the case where --from-research-cache replays research whose
  //    stories have since gone out.
  if (Array.isArray(research.candidates) && historyUrls.size > 0) {
    const before = research.candidates.length;
    research.candidates = research.candidates.filter((c) => {
      const hit = (c.sources || []).map((s) => normalizeUrl(s.url)).find((u) => historyUrls.has(u));
      if (hit) console.log(`  drop (URL repeat): "${c.headline_draft}" → ${hit}`);
      return !hit;
    });
    const after = research.candidates.length;
    if (before !== after) console.log(`URL filter: ${before - after}/${before} candidates dropped`);
  }

  // Stage 2 needs at least 3 candidates to produce a valid digest. With fewer,
  // it refuses to fabricate the rest and returns prose instead of calling
  // submit_digest — wastes a Sonnet call and surfaces as a misleading
  // STAGE2_INVALID_OUTPUT. Fail fast with a category that actually describes
  // the situation: Stage 1 didn't deliver enough fresh material.
  const candidateCount = Array.isArray(research.candidates) ? research.candidates.length : 0;
  if (candidateCount < 3) {
    // Preserve the survivors for tomorrow's run. The freshness filter has
    // already run, so we know these are < MAX_AGE_HOURS old today; tomorrow
    // they get one more shot before the filter drops them on age.
    if (candidateCount > 0) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(HOLDOVER_PATH, JSON.stringify(research.candidates, null, 2));
      console.log(`Wrote ${candidateCount} survivor(s) to ${HOLDOVER_PATH} for next run.`);
    }
    recordFailure({
      kind: "STAGE1_INSUFFICIENT_CANDIDATES",
      subjectTag: "NO-NEWS",
      stage: "Stage 1 → Stage 2 handoff",
      summary: `Only ${candidateCount} candidate(s) survived the freshness + dedup filters; Stage 2 needs at least 3.`,
      hint: `Either today genuinely had thin news, or Stage 1's web_search returned stale results. Check the per-candidate drop reasons in the log above. ${candidateCount > 0 ? "The surviving candidate(s) have been held over to tomorrow's run." : ""} Re-dispatching may help if news has since broken; otherwise tune MAX_AGE_HOURS or strengthen the Stage 1 prompt's recency emphasis.`,
      detail: `Candidates surviving filters: ${candidateCount}. See preceding log lines for what was dropped and why.`,
    });
    process.exit(1);
  }

  // ── Stage 2: Write with Sonnet 4.6 ───────────────────────────────────────
  const writePrompt = [
    systemPrompt, dateContext,
    readPrompt("02-digest-format.md"), readPrompt("03-try-it-tasks.md"), readPrompt("04-output.md"),
    `${WRITE_INPUT_PREAMBLE}\n\n\`\`\`json\n${JSON.stringify(research, null, 2)}\n\`\`\``,
  ].join("\n\n---\n\n");

  try {
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
  } catch (err) {
    recordFailure(classifyAnthropicError(err, "Stage 2"));
  }

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
  const bodyText = await resendRes.text();
  console.error(`Resend failed (${resendRes.status}):`, bodyText);
  console.error("Digest content was:\n", JSON.stringify(digest, null, 2));
  recordFailure(classifyResendError(resendRes.status, bodyText));
}

const resendBody = await resendRes.json();
if (!resendBody?.id) {
  recordFailure({
    kind: "RESEND_NO_ID", subjectTag: "RESEND", stage: "Resend send",
    summary: "Resend returned 2xx but no message ID — the email may not have been queued.",
    hint: "Check the Resend dashboard at https://resend.com/emails. Re-dispatch if no email appeared.",
    detail: `Response body: ${JSON.stringify(resendBody)}`,
  });
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
  // A successful send means any holdover candidates from previous runs either
  // shipped today or were dropped by the filters. Either way, clear the file
  // so it doesn't get re-merged tomorrow.
  clearHoldover();
}
