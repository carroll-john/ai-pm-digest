## Step 3: Submit the digest

Do **not** send the email yourself. Once the digest is fully compiled, call the `submit_digest` tool exactly once with three arguments:

- `subject` — the email subject line (e.g. `"🤖 AI × PM Daily — Sat 9 May"`)
- `html` — the complete HTML email body
- `text` — the plain-text fallback

The tool call is your final action. Do not output any text after calling it. The calling script reads the tool input directly and sends it via Resend.

## Success criteria

- 3–5 stories, all from the last 48 hours, all genuinely relevant to a PM's daily work
- Every story has a `Source:` line with a real URL from web_search results (no invented links)
- Every story has a one-sentence "Try it" task
- The closing reflection is sharp, not generic
- The digest is delivered via a single `submit_digest` tool call
