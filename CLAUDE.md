# Working in this repo

## After creating a pull request

Always immediately call `mcp__github__enable_pr_auto_merge` on the PR you
just created (squash merge). The repo has CI configured (`.github/workflows/ci.yml`)
and auto-merge will land the PR as soon as `validate` goes green — no manual
click needed from the user.

If `enable_pr_auto_merge` errors with something like "auto-merge not allowed",
the repo-level setting is off. Tell the user to flip Settings → General →
Pull Requests → "Allow auto-merge", then retry.
