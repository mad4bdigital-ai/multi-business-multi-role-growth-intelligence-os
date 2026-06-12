# Platform Recomposition Current-State Checkpoint - 2026-06-06

## Decision

Platform recomposition is no longer an unpromoted clean-room exercise. The SQL-primary authority transition and schema cleanup phases S1-S5 are complete. This directory now serves as a governed evidence register, historical review archive, and follow-up tracker.

## Promoted and verified

| Area | Current state | Evidence |
|---|---|---|
| Memory/state contract | Root `memory_schema.json` is valid and SQL-first. | `validate-memory-schema.mjs`; promoted S1 history. |
| Governance and execution schemas | Runtime binding/write-proof contracts use SQL registry/table identity. | S2 schema cleanup and tests. |
| Operations and repair schemas | Runtime contracts use SQL logs/registries; mirror imports are explicit recovery behavior. | S3 schema cleanup and tests. |
| Analytics, WordPress, and assets | SQL/source connector/asset keys are primary. | S4 schema cleanup and tests. |
| Governed registry reads | Google Sheets fallback and runtime mirror evidence are removed. | S5 runtime alignment and registry tests. |
| Activation bootstrap | DB-native bootstrap config is authority; Sheets alias is compatibility-only and must not call Sheets. | Active canonicals, guides, and activation tests. |
| Execution evidence | `execution_log` has all required context columns and migration 203 is applied live. The 2026-06-07 readback found 120 of 14,372 rows with correlation/context JSON. `writeExecutionEvidence` now accepts ordered, explicit `contextSources` and the public/private platform-plugin REST dispatch boundaries propagate exact request-input dimensions without recursively inspecting or storing the source payload. Additional writer boundaries remain an active improvement target. | Migration 203; `executionEvidenceLogger.js`; platform-plugin REST dispatchers; context-dimension regression tests; `scripts/platform-recomposition-live-readback.mjs`; live readback on 2026-06-07. |
| Core runtime context | Migrations 204/205 are applied live and the 14-table coverage view is available. Supported enrichment joins report zero remaining fillable dimensions, while workspace coverage is still zero and several historical dimensions remain sparse. | Migrations 204/205; `v_core_runtime_context_dimension_coverage`; `v_runtime_context_dimension_enrichment_fillable`; live readback on 2026-06-07. |
| Database lifecycle governance | The live registry covers 292 tables with zero missing owners and zero missing retention classes; all expected reporting views are present and three retention-plan snapshots exist. | Lifecycle registry/reporting views; `scripts/platform-recomposition-live-readback.mjs`; live readback on 2026-06-07. |
| Runtime workflow selection | Runtime loaders resolve explicit `workflow_id` first, accept only unique active `workflow_key` matches, and block ambiguous keys. Migrations 206 and 209 were applied live on 2026-06-06. Governed post-apply readback confirmed 10 of 13 plans now carry explicit `workflow_id`, zero uniquely resolvable fallback plans remain, zero executable plans lack `workflow_id`, and the remaining 2 unresolved drafts plus 1 identityless plan are isolated for manual review. | `runtimeWorkflowResolver.js`; migrations 206/209; governed `workflow_execution_identity_readback`; `scripts/workflow-execution-identity-readback.mjs`; `test-runtime-workflow-resolver.mjs`; PRs #705 and #720 evidence. |
| Tenant GPT OAuth secret handling | The live `tenant_gpt.oauth.client` row now stores only `client_secret_ref=platform_secret:TENANT_GPT_OAUTH_CLIENT_SECRET`; the preserved secret resolves from encrypted `platform_secrets`, no inline secret remains, and the safe status reports no migration required. | PR #735; governed `tenant_gpt_oauth_client_upsert`; secret-free `tenant_gpt_oauth_client_status` pre/post readback on 2026-06-07. |
| First Growth Intelligence value path | `tenant_brand_growth_intelligence_pilot_v1` resolves brand and business activity context and produces JSON/Markdown reports, SEO opportunity map, prioritized backlog, approval queue, readback, and audit evidence. The promoted scope is read-only/dry-run and records zero provider writes, external sends, and secrets. | `growthIntelligencePilot.js`; `routes/growthIntelligenceRoutes.js`; canonical OpenAPI; `test-growth-intelligence-pilot.mjs`; Growth Intelligence architecture/runbook/release policy. |
| Growth Intelligence product registry foundation | Explicit internal persistence stores reports, insights, actions, workflow evidence, linked approval holds, and immutable readiness assessments transactionally. Deterministic fingerprints supersede duplicate insights; insight/action decisions update lifecycle only and never dispatch execution. Tenant/brand metrics expose derived quality, approval, supersession, staleness, and safety counters. | Migration 243; `growthIntelligenceRegistry.js`; Growth Intelligence report JSON schema; `test-growth-intelligence-product-registry.mjs`; canonical OpenAPI. |
| Sequential plan orchestration foundation | Multi-step plans compile into durable dependency-aware steps. Transactional claims execute one ready step per tick, stop at approvals, retain idempotency/retry policy, and record an append-only timeline. Approval resumes readiness without implicit dispatch. | Migration 244; `sequentialPlanOrchestrator.js`; planner and approval routes; `test-sequential-plan-orchestrator.mjs`; canonical OpenAPI. |

## Reference overlays

The `*.clean-v1.md` files remain useful consolidated design references. They are not direct runtime authority because promotion occurred as smaller changes across active canonicals, schemas, migrations, and runtime modules.

When an overlay statement conflicts with current code or an active canonical:

1. Treat the active implementation and canonical source as current evidence.
2. Classify the mismatch as a follow-up or historical statement.
3. Promote a repair through code, canonical source, schema, migration, tests, and readback together.

## Remaining architecture work

| Priority | Follow-up | Reason |
|---|---|---|
| Medium | Classify and remove dead Sheets-era compatibility helpers and historical surface IDs only after alias/replacement migrations exist. | Names are not runtime authority, but blind renames can break registry identity. |
| Medium | Continue raising context attribution at remaining writer boundaries, then re-run live readback after deployed traffic. Prioritize workspace propagation across the 14 core runtime tables. | Public/private platform-plugin REST dispatch now propagates exact input dimensions into `execution_log`, but historical coverage remains sparse and workspace coverage was zero before this writer-boundary promotion. |
| Medium | Classify the remaining lifecycle backlog: 144 runtime-unclassified tables, 72 planned placeholders, and 26 backup snapshots; review the 54 high-risk rows before any archive/drop action. | Live lifecycle coverage is complete at registry/view level, but classification and retention execution still require governed decisions. |
| Medium | Manually classify or retire the remaining 2 unresolved `wordpress_connector_readiness` draft plans and the 1 identityless plan. | Governed post-backfill readback confirms they are not executable and cannot be safely assigned an identity by deterministic backfill. |
| Medium | Review the remaining unique remote branches before deletion or promotion. | Unique patches may contain architecture-aligned work not yet integrated. |
| Low | Re-read historical Drive workbook inventory only when a recovery, parity, or archive decision requires it. | Workbook inventory is not runtime authority. |
| Medium | Apply and read back migration 243 through the governed migration runner after deployment authorization. | The persistent product registry is implemented and tested locally but has not been applied live in this change. |
| High | Keep provider writes, external sends, PDF export, and Drive export closed until a separate provider-capable release passes approval, security, readback, and rollback review. | The first value path proves value production without widening execution authority. |

## Validation contract

Run these checks after changing this directory:

```text
node validate-memory-schema.mjs
node http-generic-api/test-platform-recomposition-docs.mjs
node http-generic-api/validate-architecture.mjs
node http-generic-api/scripts/platform-recomposition-live-readback.mjs
node http-generic-api/scripts/workflow-execution-identity-readback.mjs
git diff --check
```

The platform-recomposition docs test must verify:

- every file in this directory is classified in `README.md`;
- S1-S5 remain marked completed;
- the staged memory schema remains semantically equal to the promoted root schema after `$ref` path normalization;
- resolved stale follow-ups do not return as active claims.
