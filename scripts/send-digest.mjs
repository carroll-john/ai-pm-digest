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
const SAMPLE_PATH = path.resolve(__dirname, "../email/sample-digest.json");

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
    label: {
      type: "string",
      description: "e.g. 'Lenny's Newsletter — Why LinkedIn killed the APM program'.",
    },
  },
  required: ["url", "label"],
};

function readPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, name), "utf8").trim();
}

// The digest is delivered to a Melbourne reader, so the date label and subject
// line must reflect Melbourne local time — not the runner's UTC clock.
function melbourneDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const short = `${get("weekday")} ${get("day")} ${get("month")}`;
  const full = `${short} ${get("year")}`;
  return { short, full };
}

function findToolUse(response, name) {
  return response.content.find((b) => b.type === "tool_use" && b.name === name);
}

function logUsage(label, response) {
  const u = response.usage || {};
  const parts = [
    `input=${u.input_tokens ?? "?"}`,
    `output=${u.output_tokens ?? "?"}`,
  ];
  if (u.server_tool_use?.web_search_requests != null) {
    parts.push(`web_search=${u.server_tool_use.web_search_requests}`);
  }
  console.log(`${label} usage: ${parts.join(", ")}`);
}

fs.mkdirSync(CACHE_DIR, { recursive: true });

let digest;

if (fromSample) {
  console.log(`Loading sample digest from ${SAMPLE_PATH} (no API call).`);
  digest = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
} else if (fromCache) {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`No cache at ${CACHE_PATH}. Run once without --from-cache to populate it, or use --sample for the bundled fixture.`);
    process.exit(1);
  }
  console.log(`Loading cached digest from ${CACHE_PATH} (no API call).`);
  digest = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
} else {
  const anthropic = new Anthropic();

  const today = melbourneDate();
  const dateContext = `**Today's date in Melbourne:** ${today.full}. Use \`${today.short}\` as the \`date_label\` and \`AI × PM Daily — ${today.short}\` as the \`subject\`. "Last 24–48 hours" is relative to this date.`;
  console.log(`Melbourne date: ${today.full}`);

  const systemPrompt = readPrompt("00-system.md");

  // ── Stage 1: Research with Haiku 4.5 ─────────────────────────────────────
  let research;
  if (fromResearchCache) {
    if (!fs.existsSync(RESEARCH_CACHE_PATH)) {
      console.error(`No research cache at ${RESEARCH_CACHE_PATH}. Run once without --from-research-cache to populate it.`);
      process.exit(1);
    }
    console.log(`Loading cached research from ${RESEARCH_CACHE_PATH} (skipping Stage 1).`);
    research = JSON.parse(fs.readFileSync(RESEARCH_CACHE_PATH, "utf8"));
  } else {
    const researchPrompt = [
      systemPrompt,
      dateContext,
      readPrompt("01-research.md"),
      RESEARCH_TOOL_INSTRUCTIONS,
    ].join("\n\n---\n\n");

    console.log(
      `Stage 1 (research, ${RESEARCH_MODEL}): prompt ${researchPrompt.length} chars, web_search cap ${WEB_SEARCH_MAX_USES}`,
    );

    const researchResponse = await anthropic.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 5000,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: WEB_SEARCH_MAX_USES,
        },
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
                    summary: {
                      type: "string",
                      description: "4–6 sentences. What happened, concrete and factual. No hype.",
                    },
                    why_pm: {
                      type: "string",
                      description: "1–2 sentences on why this matters to a Product Manager.",
                    },
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
                description:
                  "1–2 sentences on common threads across the candidates — helps the writer craft the intro and reflection.",
              },
            },
            required: ["candidates", "themes"],
          },
        },
      ],
      messages: [{ role: "user", content: researchPrompt }],
    });

    logUsage("Stage 1", researchResponse);

    const researchBlock = findToolUse(researchResponse, "submit_research");
    if (!researchBlock) {
      console.error("Stage 1 model did not call submit_research. Stop reason:", researchResponse.stop_reason);
      console.error("Response content:\n", JSON.stringify(researchResponse.content, null, 2));
      process.exit(1);
    }

    research = researchBlock.input;

    // Haiku sometimes emits `candidates` as a JSON-encoded string instead of an
    // array. Parse it back so Stage 2 receives clean structured JSON rather than
    // a string of escaped JSON-inside-JSON.
    if (typeof research.candidates === "string") {
      try {
        research.candidates = JSON.parse(research.candidates);
        console.log("Stage 1 note: parsed candidates string back into an array.");
      } catch (err) {
        console.error("Stage 1 emitted candidates as a non-JSON string. Aborting.");
        console.error("First 500 chars:", research.candidates.slice(0, 500));
        process.exit(1);
      }
    }

    fs.writeFileSync(RESEARCH_CACHE_PATH, JSON.stringify(research, null, 2));
    console.log(
      `Stage 1 complete: ${Array.isArray(research.candidates) ? research.candidates.length : 0} candidate stories. Cached to ${RESEARCH_CACHE_PATH}`,
    );
  }

  // ── Stage 2: Write with Sonnet 4.6 ───────────────────────────────────────
  const writePrompt = [
    systemPrompt,
    dateContext,
    readPrompt("02-digest-format.md"),
    readPrompt("03-try-it-tasks.md"),
    readPrompt("04-output.md"),
    `${WRITE_INPUT_PREAMBLE}\n\n\`\`\`json\n${JSON.stringify(research, null, 2)}\n\`\`\``,
  ].join("\n\n---\n\n");

  console.log(`Stage 2 (write, ${WRITE_MODEL}): prompt ${writePrompt.length} chars`);

  const writeResponse = await anthropic.messages.create({
    model: WRITE_MODEL,
    max_tokens: 5000,
    tools: [
      {
        name: "submit_digest",
        description:
          "Submit the final compiled digest as structured data. Call this exactly once. Do NOT write HTML — a separate template file renders the email.",
        input_schema: {
          type: "object",
          properties: {
            subject: {
              type: "string",
              description: "Email subject line, e.g. 'AI × PM Daily — Sat 9 May'. No emojis.",
            },
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
                      "Use the source URLs from the research findings exactly as given. Never invent or modify URLs.",
                    items: SOURCE_ITEM_SCHEMA,
                  },
                  try_it: {
                    type: "string",
                    description:
                      "One-sentence hands-on task. Action verb + tool + specific thing. No explanation.",
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
    ],
    messages: [{ role: "user", content: writePrompt }],
  });

  logUsage("Stage 2", writeResponse);

  const submitBlock = findToolUse(writeResponse, "submit_digest");
  if (!submitBlock) {
    console.error("Stage 2 model did not call submit_digest. Stop reason:", writeResponse.stop_reason);
    console.error("Response content:\n", JSON.stringify(writeResponse.content, null, 2));
    process.exit(1);
  }

  digest = submitBlock.input;

  fs.writeFileSync(CACHE_PATH, JSON.stringify(digest, null, 2));
  console.log(`Stage 2 complete: cached digest to ${CACHE_PATH}`);
}

console.log(`Digest ready: "${digest.subject}" (${digest.stories?.length} stories)`);

const { html, text } = render(digest);

if (preview) {
  const previewPath = path.join(CACHE_DIR, "preview.html");
  fs.writeFileSync(previewPath, html);
  console.log(`Preview written to ${previewPath}`);
  console.log(`Open with:  open ${previewPath}`);
  process.exit(0);
}

if (dryRun) {
  console.log("\n=== DRY RUN — rendered email (skipping send) ===\n");
  console.log("SUBJECT:", digest.subject);
  console.log("\n--- HTML ---\n");
  console.log(html);
  console.log("\n--- PLAIN TEXT ---\n");
  console.log(text);
  process.exit(0);
}

console.log("Sending via Resend...");

const resendRes = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: process.env.FROM_EMAIL,
    to: [process.env.TO_EMAIL],
    subject: digest.subject,
    html,
    text,
  }),
});

if (!resendRes.ok) {
  const errBody = await resendRes.text();
  console.error(`Resend failed (${resendRes.status}):`, errBody);
  console.error("Digest content was:\n", JSON.stringify(digest, null, 2));
  process.exit(1);
}

const resendBody = await resendRes.json();
if (!resendBody?.id) {
  console.error("Resend returned 2xx but no message id:", JSON.stringify(resendBody));
  process.exit(1);
}
console.log(`Sent. Resend message ID: ${resendBody.id}`);
