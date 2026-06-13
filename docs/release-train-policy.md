# Release Train Policy

## Release Lanes

| Lane | Allowed scope | Required evidence |
|---|---|---|
| Governance-only | Canonicals, docs, gates, scanners, dashboards | docs tests, canonical build, governance checks |
| Runtime-readiness | health, readiness, operational console, parity, migration runner | health/readiness evidence, targeted runtime tests |
| Product workflow | Growth Intelligence reports, backlogs, tenant outputs | E2E workflow test, contract test, no-write proof |
| Provider-capable | provider writes, credentials, external sends | separate approval, security review, dry-run, readback, rollback |

## Promotion Rules

- A product workflow release cannot silently become provider-capable.
- Provider writes and external sends require explicit scope, approval, readback, and rollback evidence.
- API changes must update `openapi.yaml` and tests.
- Tenant GPT remains constrained to its five MCP-style operations; product capabilities are discovered and invoked through governed tool registries.
- Every release records tests, risks, rollout notes, API/DB impact, secret impact, and provider-write state.

## Current Promotion

`tenant_brand_growth_intelligence_pilot_v1` is promoted only as a Product Workflow dry-run. It produces report and approval-planning artifacts but grants no execution authority.

Internal registry persistence is permitted within the Product Workflow lane when
it is explicit, transactional, tenant-scoped, lifecycle-classified, and linked
to approval authority. It does not permit provider writes or external sends.

Promotion evidence must include explicit insight decisions, deterministic
supersession of duplicate insights, derived quality metrics, and an immutable
readiness assessment. `review_ready` is not an execution promotion state.
