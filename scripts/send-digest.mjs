import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
        "Submit the final compiled digest. Call this exactly once after research is complete. The fields are sent directly to the email provider.",
      input_schema: {
        type: "object",
        properties: {
          subject: { type: "string", description: "Email subject line." },
          html: { type: "string", description: "Full HTML email body." },
          text: { type: "string", description: "Plain-text fallback body." },
        },
        required: ["subject", "html", "text"],
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

console.log(`Parsed digest. Subject: ${digest.subject}`);

const dryRun = process.argv.includes("--dry-run");

if (dryRun) {
  console.log("\n=== DRY RUN — digest output (skipping email send) ===\n");
  console.log("SUBJECT:", digest.subject);
  console.log("\n--- HTML ---\n");
  console.log(digest.html);
  console.log("\n--- PLAIN TEXT ---\n");
  console.log(digest.text);
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
    html: digest.html,
    text: digest.text,
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
