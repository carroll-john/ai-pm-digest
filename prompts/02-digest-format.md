## Step 2: Compile the Digest

Write the digest as **HTML** suitable for an email body. Use simple, email-safe markup: `<h2>` for headlines, `<p>` for paragraphs, `<hr>` between stories, `<strong>` for bold, `<em>` for italics. No external CSS, no images.

**Voice and style:**
- Cut everything that isn't signal. No hype, no "game-changer", no "landscape", no "this is huge".
- Write like a smart colleague who read the thing so John doesn't have to.
- Every story answers two questions in plain language: **what happened** and **so what for John** — not PMs in general, but John specifically: his workflow, his decisions, his team.
- One short paragraph max per story. 3–5 sentences. If you can't explain why it matters in 3 sentences, the story isn't clear enough yet.

**Sources and links (required):**
- Every story must end with a `Source:` line linking to the primary source(s) — the actual article, tweet, podcast episode, YouTube video, or release notes you summarised. No story without a link.
- Use real URLs from your web_search results. Never invent or guess a URL.
- For podcasts and videos, link to the episode/video itself, not the show's homepage.
- If multiple sources back the story, link 2–3 (e.g. official announcement + analysis piece).
- Format: `<p><strong>Source:</strong> <a href="URL">Publication or author — title</a></p>` (or multiple `<a>` tags separated by ` · `).
- Inline links inside the summary are fine too — but the `Source:` line is mandatory regardless.

**"Try it" tasks:**
- One sentence. An action verb, a tool, a specific thing to do. That's it.
- No explanation of why it's useful — the story already did that.
- Bad: "Open Claude and paste your backlog, then ask it to identify the highest-risk item and explain its reasoning, which will help you think about…"
- Good: "Paste your backlog into Claude and ask: 'What's the highest-risk item and why?'"

Structure:

```
Subject: 🤖 AI × PM Daily — [Day, Date e.g. "Mon 4 May"]

Good morning John,

Here's what's moving in AI for Product Managers today.

---

[HEADLINE — author + medium when relevant: "🎙 Lenny's Podcast: …" / "🎥 Claire Vo: …" / "🐦 Shreyas Doshi: …"]

[What happened + why it matters for John. 3–5 sentences, no fluff.]

Source: [Publication/author — title](URL) · [optional second source](URL)

🎯 [One-sentence task.]

---

[Repeat for each story]

---

Worth sitting with: [One sharp question or uncomfortable observation — not a summary, something that lingers.]

Stay curious,
Your AI Digest
```

Also produce a **plain-text version** as a fallback for the `text` field in the output.
