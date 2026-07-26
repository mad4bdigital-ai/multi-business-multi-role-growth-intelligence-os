# Growth Intelligence Platform Architecture

## Decision

The platform's first value-producing workflow is a governed Tenant -> Brand -> Intelligence -> Report -> Backlog -> Approval Plan path. It remains read-only and dry-run until provider-capable execution receives a separate review.

## Runtime Contract

The `tenant_brand_growth_intelligence_pilot_v1` workflow runs these stages:

1. tenant activation
2. brand core resolution
3. business activity resolution
4. prompt router
5. module loader
6. engine compatibility
7. governed tool dispatch
8. approval hold
9. readback
10. audit evidence

The implementation is in `http-generic-api/growthIntelligencePilot.js`. The canonical full-platform API route is:

`POST /tenants/{tenant_id}/brands/{brand_key}/growth-intelligence/pilot`

The route uses backend authentication. It is intentionally absent from `openapi.tenant-gpt.auth.yaml`; tenant GPT capability expansion remains registry-backed through the existing MCP-style tool surface.

## Report Contract

The stable v1 report contains:

- executive summary
- brand context
- activity intelligence
- evidence register
- SEO opportunity map
- growth opportunities
- prioritized action backlog
- approval queue view
- Markdown report
- readback and audit evidence

The schema is `http-generic-api/schemas/http-generic-api/growth-intelligence-report-v1.schema.json`.

## Product Registries

Migration `243_sprint68_growth_intelligence_product_registry.sql` adds:

- `growth_intelligence_reports`
- `growth_intelligence_insights`
- `growth_intelligence_actions`
- `growth_intelligence_readiness_assessments`

These registries reuse `workflow_runs` and `approval_holds`. They are classified
in `database_table_lifecycle_registry`. Persistence is explicit through
`persistence_mode=internal_registry` and commits the full linked record set in
one transaction.

Approval decisions update the hold, action, report, and workflow state together.
An approved report becomes `awaiting_review`; approval never dispatches execution.
The generic approval decision endpoint rejects Growth Intelligence holds so it
cannot bypass this synchronized lifecycle.

Insight records carry deterministic tenant/brand fingerprints. A newer matching
insight supersedes the prior active record instead of creating an untracked
duplicate. Insight reviewers explicitly accept, reject, or mark insights stale.

Readiness assessments are immutable, SHA-256-addressed evidence records. A report
is `review_ready` only when the report and all actions are approved, all insights
are accepted and evidence-backed, every action is scored and has readback
requirements, and all safety flags remain zero. `review_ready` still sets
`execution_allowed=false`.

Read APIs provide report lists, report detail with readiness-assessment history,
and tenant/brand product metrics.
Metrics expose evidence coverage, insight acceptance, action/report approval,
supersession, staleness, and safety. Safety metrics must remain zero for provider
writes, external sends, and secrets.

Every action declares execution class, risk, score, approval state, readback requirements, provider-write state, external-send state, and secret state.

## Authority Boundaries

- SQL registries and active canonicals remain authority.
- Caller-supplied rows are bounded pilot input, not promoted registry authority.
- No report result grants provider write or external-send authority.
- Internal registry persistence is an allowed platform-primary write but grants no external execution authority.
- No PDF or Drive export is authorized by this workflow.
- Provider writes require a separate provider-capable release and approval/readback policy.

## Validation

Run:

```text
node http-generic-api/test-growth-intelligence-pilot.mjs
node http-generic-api/test-growth-intelligence-product-registry.mjs
node http-generic-api/test-tenant-tool-surface-guard.mjs
node http-generic-api/test-openapi-split-governance.mjs
node build-canonicals.mjs --check
```
