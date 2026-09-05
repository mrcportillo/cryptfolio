# Portfolio experience verification

The screenshots use synthetic holdings and the actual InsightsView, ScenarioForm,
ScenarioResults, and navigation components, with the project's compiled styles.
Desktop width is 1280px; mobile width is 375px. Both had no horizontal overflow.

An isolated production-built Next.js fixture exercised keyboard add/remove/save,
pending disabled fields, duplicate-coin rejection, corrected submission, and
inverted allocation bounds. Validation errors and successful saves preserve
edited fields. The fixture replaced authentication and persistence with synthetic
data and validation-only server actions; it had no production credentials or
database access. Full authenticated Auth0 E2E remains a rollout check.

Database tests separately verify real persistence, create retry stability,
edit/archive lifecycle, owner scoping, database constraints, and unchanged ledger,
movement, and snapshot records after preferences/scenario operations. Unit tests
cover exact impact math, positive holdings only, range drift, and null/stale prices.

Daily and weekly screenshots are in `../reports`; live pricing before/after states
are in `../valuation`.
