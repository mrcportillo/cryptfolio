---
status: ready
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

- [ ] Pull requests and main pushes run all offline/database checks and build.
- [ ] No application secrets or production database access are required.
- [ ] Action pins and workflow syntax are validated.
- [ ] A GitHub-hosted run passes and its evidence is linked from the PR.
- [ ] README and issue tracking reflect the new verification path.

## Work Log

### 2026-09-05

Merged PR #15 at the user's request. GitHub automatically closed #17 with that
merge; reopened it because its acceptance criteria remain unresolved. Browser
diagnostics are also blocked by the locked Mac. Continue with independent CI work.
