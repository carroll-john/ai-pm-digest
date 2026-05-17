## Step 1: Research

Use the web_search tool to find AI news and developments from the last 24–48 hours that are directly relevant to Product Management. Search for a mix of:

- New AI tools, models, or product launches PMs should know about (e.g. new Anthropic/OpenAI/Google releases, agent frameworks, coding assistants)
- Changes to AI-powered PM workflows (prioritisation, spec writing, user research, roadmapping, analytics)
- Industry discussion about AI reshaping product teams (team structure, role changes, build vs buy)
- Practical tutorials or experiments in the PM + AI space
- Insights, experiments, or frameworks from product leaders who are actively building with or thinking about AI

Cast a wide net — a downstream writer model will pick the final 3–5. Prioritise things that are new (last 24–48 hrs), concrete, and actionable. Skip pure funding/valuation news unless there's a product angle.

Run searches in roughly this order, stopping once you have enough strong candidates (see Step 2 for the target count). Not every search needs to be run — use judgment.

**General AI × PM news (run 2–3 of these):**
- "AI product management news today"
- "new AI tools for product managers [today's date]"
- "Claude Anthropic OR OpenAI OR Gemini update [today's date]"
- "AI agents product workflow 2026"

**Thought-leader written content (run 2–3 of these):**
- site:lennysnewsletter.com AI
- site:substack.com "product manager" "AI" [today's date]
- "Lenny Rachitsky AI" OR "Claire Vo AI" OR "Peter Yang AI" OR "Shreyas Doshi AI"
- site:productcompass.pm AI

**Podcasts (run 1–2 of these):**
- "Lenny's Podcast" AI episode [this week OR this month]
- "How I Built This" OR "Acquired" OR "Lex Fridman" OR "My First Million" AI product [this week]
- "No Priors podcast" AI product 2026
- "Light Cone podcast" Anthropic 2026

**YouTube (run 1–2 of these):**
- site:youtube.com "Claire Vo" AI product 2026
- site:youtube.com "Peter Yang" AI product manager 2026
- site:youtube.com "AI product management" [today's month and year]

**X / Twitter (run 1–2 of these):**
- site:x.com "Lenny Rachitsky" AI [today's date]
- site:x.com "Claire Vo" AI product [today's date]
- site:x.com "Shreyas Doshi" AI [today's date]
- site:x.com "product manager" AI [today's date]

When you find relevant podcast episodes or YouTube videos, include a direct link and summarise the key takeaway — don't just mention the show exists. For X posts, quote or paraphrase the substance of the thread, not just the existence of a tweet.

When a story comes from a named PM thought leader (Lenny Rachitsky, Claire Vo, Peter Yang, Shreyas Doshi, Gibson Biddle, Melissa Perri, Marty Cagan, or similar), name the author and medium in the headline as plain prose — e.g. "Lenny's Podcast: …" or "Claire Vo on YouTube: …". No emojis. Readers trust these voices and that context adds signal.

**Freshness and de-duplication.** A separate section below lists stories and source URLs already shipped in recent digests. Do not propose anything that points to one of those URLs, and do not re-cover the same underlying announcement, podcast episode, or post — even at a different URL — unless there is genuinely new information (a follow-up post, new data point, meaningful update). If a topic continues to evolve, frame the new candidate around the *new* development, not a recap of what already shipped.

**Publication dates.** For every source, capture its publication date as ISO 8601 (`YYYY-MM-DD`) in the `published_date` field. Prefer the date shown on the article page itself (byline, dateline, post metadata); fall back to the date in the `web_search` result. If the date is genuinely not available, omit the field rather than guessing — never invent a date.
