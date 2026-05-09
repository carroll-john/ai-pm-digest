## Step 3: Submit the digest

Call the `submit_digest` tool **exactly once** with all the structured fields described in Step 2. The tool call is your final action — do not output any text after calling it. The script renders HTML/text via a separate template file and sends via Resend.

## Success criteria

- 3–5 stories, all from the last 48 hours, all genuinely relevant to a PM's daily work
- Every story has at least one real source URL from web_search results (no invented links)
- Every story has a one-sentence `try_it` task (no explanation, no preamble)
- The `reflection` is sharp, not generic
- The digest is delivered via a single `submit_digest` tool call with no surrounding text
