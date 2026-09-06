---
status: complete
priority: p2
issue_id: "003"
tags: [ci, portfolio, verification]
dependencies: ["002"]
---

# Automate portfolio verification

## Problem Statement

PR #15 is merged, but the repository has no workflow that runs its financial
invariants and env-free build. Vercel diagnostics alone are insufficient.

## Recommended Action

Implement issue #18 with pinned official actions, Node 24, the declared pnpm
version, and disposable PostgreSQL 15. Keep hosted verification in #17.

## Acceptance Criteria

- [x] Pull requests and main pushes run all offline/database checks and build.
- [x] No application secrets or production database access are required.
- [x] Action pins and workflow syntax are validated.
- [x] A GitHub-hosted run passes and its evidence is linked from the PR.
- [x] README and issue tracking reflect the new verification path.

## Work Log

### 2026-09-05

Merged PR #15 at the user's request. GitHub automatically closed #17 with that
merge; reopened it because its acceptance criteria remain unresolved. Browser
diagnostics are also blocked by the locked Mac. Continue with independent CI work.

### Hosted verification

GitHub run https://github.com/mrcportillo/cryptfolio/actions/runs/33994526277
passed on `3a40aba`: 157 offline tests and all 48 PostgreSQL checks (15 opening,
19 transactions, 14 valuation/insights), with no database skips. Frozen install,
Prisma generation, typecheck, lint, production audit, and production build passed.
The workflow also passed actionlint and Prettier. PR #19 carries the delivery;
issue #18 remains open until integration. Vercel failed separately and remains #17.
