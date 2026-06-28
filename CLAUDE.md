# Working in this repo

## After creating a pull request

Always immediately call `mcp__github__enable_pr_auto_merge` on the PR you
just created (squash merge). The repo has CI configured (`.github/workflows/ci.yml`)
and auto-merge will land the PR **only after** the required `validate` status
check passes — never merge a red PR. No manual click needed from the user once
CI is green.

**Guardrail:** Auto-merge queues the squash; GitHub still blocks the actual merge
until all required status checks succeed. If branch protection on `main` does not
yet require the `validate` job, add it under Settings → Branches → Branch
protection rules → Require status checks → `validate`. That prevents a bypass
where auto-merge is enabled but CI is optional.

If `enable_pr_auto_merge` errors with something like "auto-merge not allowed",
the repo-level setting is off. Tell the user to flip Settings → General →
Pull Requests → "Allow auto-merge", then retry.

## When the user says "the digest failed"

Do NOT ask them to paste the failure email. The daily-digest workflow now
commits the failure context to `main` on every red run via the
`Persist failure context to main` step. Pull and read:

```
git pull origin main
cat cache/last-failure.json   # categorised failure record (kind, summary, hint)
cat cache/last-failure.log    # last 60 lines of digest.log (PII redacted)
```

Both files are cleared by `send-digest.mjs` on the next successful send, so if
they exist on `main` it means the most recent run failed. Diagnose from there.
