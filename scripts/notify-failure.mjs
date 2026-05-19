// Sends a failure email via Resend so the alert carries a usable error excerpt
// instead of GitHub's bare "Run failed" notification. Reads the captured log
// tail and links back to the workflow run for full context.
import fs from "node:fs";

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

const runUrl = process.env.RUN_URL || "";
const runName = process.env.RUN_NAME || "Daily AI × PM Digest";
const commit = (process.env.COMMIT_SHA || "").slice(0, 7);

const subject = `${runName} failed${commit ? ` (${commit})` : ""}`;
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const html = `<p>The daily digest workflow failed${commit ? ` on commit <code>${commit}</code>` : ""}.</p>
${runUrl ? `<p><a href="${runUrl}">View the full run logs</a></p>` : ""}
<p><strong>Last ${TAIL_LINES} log lines:</strong></p>
<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#f6f8fa;padding:12px;border-radius:6px;border:1px solid #d0d7de;">${escapeHtml(tail)}</pre>`;

const text = `${runName} failed${commit ? ` on commit ${commit}` : ""}.
${runUrl ? `Run: ${runUrl}\n` : ""}
Last ${TAIL_LINES} log lines:

${tail}
`;

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
