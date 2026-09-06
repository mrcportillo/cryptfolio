---
status: pending
priority: p1
issue_id: "004"
tags: [deployment, vercel, portfolio]
dependencies: ["003"]
---

# Restore Vercel preview deployment

## Problem Statement

Issue #17: Vercel completes the Next.js build but rejects the generated outputs.
The snapshot route declares a 300-second duration and its scheduler needs that
budget. The existing Hobby project has Fluid Compute disabled.

## Evidence

On 2026-09-06, the authenticated dashboard for deployment
`3GRASqNGKuDVdi93iwAVikuDDtdP` showed `Build Completed in /vercel/output [1m]`
followed by `Deploying outputs...` and a failed deployment. Its error linked to
function execution-timeout limits. Both deployment and project settings showed
Fluid Compute disabled. Vercel documents a 300-second Hobby limit with Fluid
Compute and supports enabling it per deployment using `vercel.json`.

## Recommended Action

Set `fluid: true` in the repository configuration and verify the resulting preview.
Retain the route's duration and scheduler budget. Track hosted authentication,
database readiness, and production rollout separately in issue #17.

## Acceptance Criteria

- [x] Inspect authenticated Vercel logs and effective function settings.
- [x] Apply the documented repository configuration and update the runbook.
- [ ] The updated PR passes Portfolio CI and Vercel deployment checks.
- [ ] The preview reports Fluid Compute enabled and a 300-second cron duration.
- [ ] Record preview smoke checks and update GitHub tracking with remaining work.

## Work Log

### 2026-09-06

The user opened the authenticated Vercel console. The observed deployment failure
and disabled Fluid Compute point to the snapshot duration configuration. Added
the per-deployment opt-in to PR #19 for hosted verification.
