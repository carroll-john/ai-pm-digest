## Step 3: Output the digest as JSON

Do **not** send the email yourself. Your entire final response must be **only** a single fenced JSON code block — no text before or after it:

```json
{
  "subject": "🤖 AI × PM Daily — Mon 4 May",
  "html": "<the HTML digest from Step 2>",
  "text": "<the plain-text fallback from Step 2>"
}
```

Rules:
- The code block must start with ` ```json ` on its own line and end with ` ``` ` on its own line.
- No prose, no preamble, no "Here is the digest:" — the JSON block is the entire response.
- The calling script extracts JSON from this fenced block and will fail if anything else is present.

## Success criteria

- 3–5 stories, all from the last 48 hours, all genuinely relevant to a PM's daily work
- Every story has a specific, actionable "Try it" task that follows the guidelines
- Output is a single, valid JSON object with `subject`, `html`, and `text` fields
- The closing reflection question is thought-provoking and non-generic
