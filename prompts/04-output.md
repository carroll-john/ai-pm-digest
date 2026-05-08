## Step 3: Output the digest as JSON

Do **not** send the email yourself. Output a single JSON object — and nothing else after it — with this exact shape:


```json
{
  "subject": "🤖 AI × PM Daily — Mon 4 May",
  "html": "<the HTML digest from Step 2>",
  "text": "<the plain-text fallback from Step 2>"
}
```


The calling script will read this object and send it via Resend.

## Success criteria

- 3–5 stories, all from the last 48 hours, all genuinely relevant to a PM's daily work
- Every story has a specific, actionable "Try it" task that follows the guidelines
- Output is a single, valid JSON object with `subject`, `html`, and `text` fields
- The closing reflection question is thought-provoking and non-generic
