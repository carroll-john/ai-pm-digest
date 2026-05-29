// Sends a failure email via Resend so the alert carries a usable error excerpt
// instead of GitHub's bare "Run failed" notification. Reads the captured log
// tail and (when present) the structured failure record written by
// send-digest.mjs, so the subject line is categorised and the body opens with
// a "What happened / What to do" block before the raw log tail.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, "../cache");
const FAILURE_PATH = path.join(CACHE_DIR, "last-failure.json");
const FAILURE_LOG_PATH = path.join(CACHE_DIR, "last-failure.log");
const TAIL_LINES = 60;
const logPath = process.argv[2] || "digest.log";

let tail = "(no log captured — the failure happened before the digest step ran)";
try {
  const raw = fs.readFileSync(logPath, "utf8").trimEnd();
  const lines = raw.length ? raw.split("\n") : [];
  if (lines.length) tail = lines.slice(-TAIL_LINES).join("\n");
} catch (err) {
  if (err.code !== "ENOENT") tail = `(could not read ${logPath}: ${err.message})`;
}

// `cache/last-failure.json` is written by send-digest.mjs whenever it exits
// with a known failure mode. Its presence upgrades this generic notification
// into a categorised one with an actionable remedy.
let failure = null;
try {
  failure = JSON.parse(fs.readFileSync(FAILURE_PATH, "utf8"));
} catch (err) {
  if (err.code !== "ENOENT") console.warn(`Could not read ${FAILURE_PATH}: ${err.message}`);
}

const runUrl = process.env.RUN_URL || "";
const runName = process.env.RUN_NAME || "Daily AI × PM Digest";
const commit = (process.env.COMMIT_SHA || "").slice(0, 7);

const tag = failure?.subject_tag || "FAILED";
const subject = `[${tag}] ${runName} failed${commit ? ` (${commit})` : ""}`;
const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const bannerHtml = failure ? `<div style="background:#fff8e1;border-left:4px solid #f59e0b;padding:14px 16px;margin:0 0 20px;border-radius:4px;">
  <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b6b6b;font-weight:600;">What happened</p>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.45;">${escapeHtml(failure.summary)}</p>
  <p style="margin:0 0 6px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b6b6b;font-weight:600;">What to do</p>
  <p style="margin:0;font-size:15px;line-height:1.45;">${escapeHtml(failure.hint)}</p>
</div>
` : "";

const html = `${bannerHtml}<p>The daily digest workflow failed${commit ? ` on commit <code>${commit}</code>` : ""}.</p>
${runUrl ? `<p><a href="${runUrl}">View the full run logs</a></p>` : ""}
<p><strong>Last ${TAIL_LINES} log lines:</strong></p>
<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f6f8fa;padding:12px;border-radius:6px;border:1px solid #d0d7de;">${escapeHtml(tail)}</pre>`;

const bannerText = failure ? `What happened:
  ${failure.summary}

What to do:
  ${failure.hint}

` : "";

const text = `${runName} failed${commit ? ` on commit ${commit}` : ""}.
${runUrl ? `Run: ${runUrl}\n` : ""}
${bannerText}Last ${TAIL_LINES} log lines:

${tail}
`;

// Mirror the same log tail and structured failure record into cache/ so the
// persist step can commit them to main. That way the next conversation about
// a failure can read these files directly instead of asking the user to copy
// the email body.
try {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(FAILURE_LOG_PATH, tail.endsWith("\n") ? tail : tail + "\n");
} catch (err) {
  console.warn(`Could not write ${FAILURE_LOG_PATH}: ${err.message}`);
}

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: process.env.FROM_EMAIL,
    to: [process.env.TO_EMAIL],
    subject,
    html,
    text,
  }),
});

if (!res.ok) {
  console.error(`Failure-notification send failed (${res.status}):`, await res.text());
  process.exit(1);
}
const body = await res.json();
console.log(`Failure notification sent. Resend message ID: ${body?.id ?? "(none)"}`);
