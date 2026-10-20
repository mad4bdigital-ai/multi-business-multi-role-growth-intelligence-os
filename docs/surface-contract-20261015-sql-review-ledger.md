# Surface Contract SQL Review Ledger — 2026-10-15

> Evidence inventory for current `main@1dcf1adb605b2f1d362aacc28f429d36cf2f7799`. Source-only; no migration application, provider calls, credential reads, runtime mutation, Production promotion, or authorization is implied. This file is **not** a safety attestation. Recompute all queue counts from the generator after changes.

## Scope and exact migration review

| Migration | Observed source surface | Required acceptance evidence |
|---|---|---|
| `20260808_github_issue_comment_dispatch_parity.sql` | Updates GitHub REST issue-comment endpoint registry, exports and a readback view | Checksum-bound provider-route classification; confirm 201 contract, governed dispatcher and live readback separately |
| `20260810_github_issue_comment_exact_response_parity.sql` | Reconciles 201 Created response metadata for registered GitHub Issue Comments | Checksum-bound provider-route classification; verify no stale 200 success contract, no invented local Express handler |
| `20260812_repository_reconciliation_admin_apply_activation.sql` | Activates internal repository reconciliation policy/readback via guarded SQL | Human review of dynamic SQL and activation criteria; exact policy, review authority, and readback; no implied apply |
| `20260815_custom_gpt_mcp_catalog_levels.sql` | Adds/normalizes catalog-level registry columns and bounded tool metadata | Schema compatibility, <=30 Custom GPT operation boundary, exact tool identity, and permission review |
| `1038_sprint69_github_actions_workflow_control_dispatch.sql` | Registers GitHub Actions rerun and workflow-dispatch provider endpoints and governed bindings | Confirm registry-only migration behavior; provider-call permissions and live endpoint execution remain separate |
| `1030_sprint69_default_blocker_recovery_governance_seed.sql` | Seeds default recovery tags, policies, and taxonomy | Verify no automatic provider write or authority grant; check policy readiness and recovery audit contracts |
| `20260810_platform_runtime_registry_drift_reconciliation.sql` | Internal canonical plugin capability registry and WordPress binding reconciliation | Verify canonical identity, disabled provider dispatch and the specified readback views |
| `1042_sprint69_support_ticket_lifecycle_sla_dedupe.sql` | Internal tickets, deduplication, SLA events/triggers and readback views | Review DDL/trigger behavior, dedupe constraints, staging migration, and same-cycle readback |
| `1047_sprint69_tenant_request_inbox_and_chunk_store_hardening.sql` | Internal ticket/case indexes and governed chunk ownership columns via guarded SQL | Review PREPARE/EXECUTE branches and idempotency; tenant ownership, privacy, and readback |
| `20260728_governed_response_chunk_ownership.sql` | Internal response-chunk ownership metadata and indexes | Review PREPARE/EXECUTE and absence of guessed legacy backfill; require separate approval before applying |

## Source-of-truth and decision policy

- The 10 candidates originate from `docs/surface-contract-gap-queue.json` on the cited main head: 4 critical-review, 2 high-review, 4 medium-review.
- The two registered GitHub provider paths are *not* automatically public routes of the local platform. Their route classification uses exact source Git blob SHA and explicit endpoint-registry evidence in `http-generic-api/surface-contract-classification-evidence.json`. A changed SQL blob falls back to OpenAPI review.
- SQL comment markers such as `no_provider_call=true` are static source evidence, not proof of production behavior. The parser must recognize exact comment declarations without treating SQL-string payloads as safety assertions.
- For risk-bearing SQL (including PREPARE/EXECUTE, ALTER, trigger or activation steps), require manually reviewed checksum-bound SQL risk/preflight evidence, applicable policy approval, and staging readbacks. Do not manufacture `docs/surface-contract-manual-safety-attestations.json` entries.
- The five canonical documentation targets cross-reference this ledger. A documentation-complete classification does not independently discharge missing provider/OpenAPI, runtime callability, safety, policy, or migration-apply review.
- Regenerate all `docs/surface-contract-*` facts **from exact current main** through the registered writer. Do not cherry-pick generated evidence from stale PR #8510; close or supersede it without merging stale generated manifests.
- New remediation PRs must complete CI, derived-state closure, and exact-head governance review before any merge. No Production branch/deployment is authorized.

## Acceptance checklist

- [ ] Verified current-base generator output is consistent after source changes; no stale generated reports
- [ ] Verified two provider endpoint registry route classifications with exact Git blob identities and negative tamper/unrelated-route tests
- [ ] Verified parsing of explicit true safety comments and rejection of untrusted SQL-string assignments
- [ ] Revalidated all remaining SQL preflight risks and same-cycle staging readbacks under the appropriate review authority
- [ ] Confirmed queue counts and all required CI/Derived State checks on exact PR source head
- [ ] Recorded independent exact-head merge authorization for critical control-plane edits if required
