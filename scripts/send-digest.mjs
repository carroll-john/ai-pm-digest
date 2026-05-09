import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "../email/template.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, "../prompts");

// Read every .md file in prompts/ in alphabetical order and join them.
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
          subject: { type: "string", description: "Email subject line, e.g. '🤖 AI × PM Daily — Sat 9 May'." },
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
                  description: "Story headline. Include emoji + author/medium when relevant, e.g. '🎙 Lenny\\'s Podcast: …' or '🐦 Shreyas Doshi: …'.",
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

const digest = submitBlock.input;

console.log(`Parsed digest. Subject: ${digest.subject} (${digest.stories?.length} stories)`);

const { html, text } = render(digest);

const dryRun = process.argv.includes("--dry-run");

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
