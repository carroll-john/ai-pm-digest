import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../email/template.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../prompts");
const CACHE_DIR = path.resolve(__dirname, "../cache");
const CACHE_PATH = path.join(CACHE_DIR, "last-digest.json");

const fromCache = process.argv.includes("--from-cache");
const fromSample = process.argv.includes("--sample");
const dryRun = process.argv.includes("--dry-run");
const preview = process.argv.includes("--preview");

let digest;

const SAMPLE_PATH = path.resolve(__dirname, "../email/sample-digest.json");

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
  const promptFiles = fs
    .readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (promptFiles.length === 0) {
    console.error("No .md files found in prompts/ — aborting.");
    process.exit(1);
  }

  const prompt = promptFiles
    .map((f) => fs.readFileSync(path.join(PROMPTS_DIR, f), "utf8").trim())
    .join("\n\n---\n\n");

  console.log(`Loaded ${promptFiles.length} prompt files: ${promptFiles.join(", ")}`);
  console.log(`Assembled prompt length: ${prompt.length} characters`);

  const anthropic = new Anthropic();

  console.log("Calling Claude...");
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 15,
      },
      {
        name: "submit_digest",
        description:
          "Submit the final compiled digest as structured data. Call this exactly once after research is complete. Do NOT write HTML — a separate template file renders the email.",
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
                    description: "Plain-text story headline. Include author and medium when relevant, e.g. \"Lenny's Podcast: …\" or \"Shreyas Doshi on X: …\". No emojis.",
                  },
                  body_html: {
                    type: "string",
                    description: "The story body as an HTML fragment (no <p> wrappers needed — the template adds them). Use only inline tags: <strong>, <em>, <a>, <code>. 3–5 sentences. Substance over fluff.",
                  },
                  sources: {
                    type: "array",
                    minItems: 1,
                    description: "Real URLs from web_search results. Never invent URLs.",
                    items: {
                      type: "object",
                      properties: {
                        url: { type: "string" },
                        label: { type: "string", description: "e.g. 'Lenny's Newsletter — Why LinkedIn killed the APM program'." },
                      },
                      required: ["url", "label"],
                    },
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
    ],
    messages: [{ role: "user", content: prompt }],
  });

  const submitBlock = response.content.find(
    (b) => b.type === "tool_use" && b.name === "submit_digest",
  );

  if (!submitBlock) {
    console.error("Model did not call submit_digest. Stop reason:", response.stop_reason);
    console.error("Response content:\n", JSON.stringify(response.content, null, 2));
    process.exit(1);
  }

  digest = submitBlock.input;

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(digest, null, 2));
  console.log(`Cached digest to ${CACHE_PATH}`);
}

console.log(`Digest ready: "${digest.subject}" (${digest.stories?.length} stories)`);

const { html, text } = render(digest);

if (preview) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
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

const { id } = await resendRes.json();
console.log(`Sent. Resend message ID: ${id}`);
