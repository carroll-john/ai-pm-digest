// Redact recipient-identifying data before writing failure artifacts that get
// committed to main (cache/last-failure.{json,log}). Keeps error type, stage,
// timestamps, and truncated technical detail for debugging.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_RE = /Bearer\s+[a-zA-Z0-9._-]+/gi;
const GREETING_RE = /(Good morning|Hi|Hello|Dear),?\s+[A-Z][\w'-]*/g;
const DETAIL_MAX_LEN = 2000;

function knownEmails() {
  return [process.env.TO_EMAIL, process.env.FROM_EMAIL].filter(Boolean);
}

export function redactPii(text) {
  let out = String(text ?? "");
  for (const email of knownEmails()) {
    out = out.split(email).join("[REDACTED_EMAIL]");
  }
  out = out.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  out = out.replace(BEARER_RE, "Bearer [REDACTED_TOKEN]");
  out = out.replace(GREETING_RE, "$1 [REDACTED]");
  out = out.replace(/"greeting"\s*:\s*"[^"]*"/g, '"greeting": "[REDACTED]"');
  out = out.replace(
    /Digest content was:\s*\n[\s\S]*?(?=\n(?:FAILURE|HINT|DETAIL|$))/g,
    "Digest content was: [REDACTED — see failure summary above]\n",
  );
  return out;
}

export function redactFailureRecord(record) {
  if (!record || typeof record !== "object") return record;
  const redacted = { ...record };
  for (const key of ["summary", "hint", "detail"]) {
    if (typeof redacted[key] === "string") {
      let value = redactPii(redacted[key]);
      if (key === "detail") value = value.slice(0, DETAIL_MAX_LEN);
      redacted[key] = value;
    }
  }
  return redacted;
}
