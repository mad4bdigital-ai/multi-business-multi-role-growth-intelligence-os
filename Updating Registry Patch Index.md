# Updating Registry Patch Index

> 2026-06-12 DR/Tool Bus future surface remediation note: `1000_sprint68_dr_certification_and_tool_bus_gated_read_only.sql` records metadata-only isolated restore certification summaries and a Tool Bus gated read-only pilot policy. It stores no backup material, no recovery-key payload, and no raw secret values; it allows no provider calls, credential payload reads, raw secrets, external sends, external writes, repository mutations, cutover, deploys, or secrets. The migration surfaces are runtime config metadata and blocking execution policies only.

> 2026-06-12 Future surface remediation note: `292_sprint68_platform_health_scorecard_operationalization.sql` and `962_sprint68_smoke_branch_cleanup_gate.sql` were reviewed as post-closure future-surface items. Migration 292 operationalizes the Platform Health Scorecard with additive registry/readback tables, remediation metadata, snapshot history, tenant rollout readback, ledger hygiene, and admin tool registry rows. Migration 962 adds a governed smoke-branch cleanup gate for `gpt/smoke-*` branches only with exact typed confirmation; protected branches, direct-main writes, generic unmerged deletion, merge, provider calls, credential payload reads, raw secrets, external sends, external writes, deploys, and secrets remain blocked.

> 2026-06-12 Legacy surface backlog full-closure note: `surface-contract-discovery.mjs` now applies `surface-contract-legacy-backlog-closure-v1` to the historical SQL-backed surface backlog. Closed ranges are `001-291`, `305-306`, `900-910`, `950-961`, `997-999`, plus `20260611_*` migration files. Closed migrations are treated as documented, their legacy route-like literals are classified as `legacy_closure_route_reviewed`, and historical missing safety markers are treated as reviewed closure evidence. Future migrations outside these explicit ranges/prefixes remain normally scored and can still open docs, OpenAPI, or safety gaps. Safety: no provider calls, no credential payload reads, no runtime mutation, no database writes, no external sends, no deploys, and no secrets.

> 2026-06-12 Schema contract completion blocker remediation note: `286_sprint68_platform_schema_contract_completion_registry.sql` is now documented and classified as registry-only for route scoring. Its `/contacts` and `/platform/wordpress/blog-publish-recovery` literals live inside endpoint `schema_json` synthetic endpoint-native contracts, not newly declared Express routes. The classifier marks them `registry_only_surface`, so they remain visible as schema contract evidence without creating OpenAPI false positives. Safety: update-only registry completion, no provider calls, no credential payload reads, no external sends, no deploys, and no secrets.

> 2026-06-12 Route classifier and Session Insight batch remediation note: `surface-contract-discovery.mjs` now classifies SQL route-like literals as `http_route`, `admin_tool_registry_route`, `tenant_tool_registry_route`, `system_tool_dispatch_route`, `registry_only_surface`, or `false_positive_route_like_string` before OpenAPI scoring. `955_sprint68_external_delivery_admin_control_surface.sql` admin control paths are `admin_tool_registry_route` and no longer count as OpenAPI gaps. Session Insight batch documentation covers exact migrations `273_sprint68_session_insight_capability_envelope_request_gate.sql`, `275_sprint68_session_insight_capability_envelope_dispatch_dry_run.sql`, `278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql`, `279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql`, `280_sprint68_session_insight_capability_envelope_approval_gate.sql`, `281_sprint68_session_insight_capability_envelope_dispatch_readback.sql`, `282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql`, `283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql`, and `284_sprint68_session_insight_backlog_target_write_executor.sql`. Scope remains evidence-only: no provider calls, no credential payload reads, no runtime mutation outside governed migrations, no unreviewed DB writes, no external sends, no deploys, and no secrets.

> 2026-06-12 Latest Surface Gap Remediation note: documents exact migration coverage for `954_sprint68_compact_operational_views_and_github_resource_coverage.sql`, `955_sprint68_external_delivery_admin_control_surface.sql`, and `956_sprint68_external_delivery_allowlist_readiness_view_updated_at.sql`. Migration 954 adds compact operational/resource readiness views and GitHub inspect resource coverage using existing governed inspection surfaces. Migration 955 adds External Delivery admin readback/control views, admin tool registry rows, and a blocking governance policy for no-secret/no-send controls. Migration 956 refreshes `v_external_delivery_recipient_allowlist_readiness` with `created_at`/`updated_at` for admin sorting, view-only/no secrets/no data mutation. Documentation remediation is evidence-only and does not authorize provider calls, credential payload reads, runtime mutation, database writes, external sends, deploys, or secrets.

> 2026-06-12 Surface Governance Loop note: adds `surface-contract-gap-triage.mjs`, generated triage/baseline/dashboard/trend outputs, and a new-gaps-only gate. The loop consumes `surface-contract-gap-queue.json`, classifies immediate-review vs legacy backlog, baselines current known gaps, and fails only future high/critical gaps absent from the baseline. It also documents latest remediation targets `954_sprint68_compact_operational_views_and_github_resource_coverage.sql` and `955_sprint68_external_delivery_admin_control_surface.sql`: migration 954 adds compact operational readiness/resource views plus GitHub inspect resource coverage without new provider behavior; migration 955 adds External Delivery admin overview/recent-send/Gmail-connection readback views plus governed control tools and policy. Evidence-only automation remains no provider calls, no credential payload reads, no runtime mutation outside governed migrations, no unreviewed database writes, no external sends, no deploys, and no secrets.

> 2026-06-12 Actionable surface contract gap queue note: upgrades `surface-contract-discovery.mjs` to `surface-contract-discovery-v3` and adds generated remediation outputs `docs/surface-contract-gap-queue.md` and `docs/surface-contract-gap-queue.json`. The queue ranks migration surface gaps by documentation coverage, OpenAPI route gaps, surface type, missing safety markers, and recency, then emits owner hints and remediation actions such as `document_surface_contract`, `review_openapi_contract`, `verify_tool_registry_binding`, `verify_policy_seed_readiness`, `verify_readback_view`, and `add_explicit_safety_markers`. Evidence-only automation remains no provider calls, no credential payload reads, no runtime mutation, no database writes, no external sends, no deploys, and no secrets.

> 2026-06-11 Deep surface contract coverage note: upgrades `surface-contract-discovery.mjs` to `surface-contract-discovery-v2`, adds all-migration coverage metrics, machine-readable `docs/surface-contract-discovery-status.json`, high/medium/low documentation gap classification, SQL route/OpenAPI coverage scoring, per-doc-target gap counts, safety marker coverage counts, and tests against migrations 287, 910, and 954. Evidence-only automation remains no provider calls, no credential payload reads, no runtime mutation, no database writes, no external sends, no deploys, and no secrets.

> 2026-06-11 Automatic surface contract discovery note: adds `http-generic-api/scripts/surface-contract-discovery.mjs`, generated report `docs/surface-contract-discovery-status.md`, workflow coverage for `http-generic-api/migrations/**`, and tests in `test-surface-contract-discovery.mjs`. `repo-maintenance-sync.mjs --write` now runs OpenAPI route autofill, repository maintenance docs, and SQL-backed surface discovery. The discovery layer scans migrations for routes, tools, views, policies, plugins, and safety markers, then opens reviewable auto-sync PRs through `.github/workflows/openapi-auto-sync.yml`. It is documentation evidence only: no provider calls, credential payload reads, raw secrets, runtime mutation, database writes, external sends, spend changes, deployment, or secrets.

> 2026-06-11 External Delivery no-send orchestration graph note: PR #1363 adds migration `287_sprint68_external_delivery_orchestration_graph_plugin.sql` and test `test-external-delivery-orchestration-graph.mjs`. The migration registers `support_ticket_external_delivery_orchestrator` as a read-only/no-send orchestration graph plugin with seven stages and six edges over external delivery readiness, approval policy, credential candidate metadata, credential binding state, provider gate, execution plan record, and completion certification. It extends `v_platform_orchestration_graph_readiness`, adds `v_platform_orchestration_external_delivery_readiness`, and seeds blocking policy `support_ticket_external_delivery_orchestration_readback_policy_v1`. Apply evidence: governed ledger run `2e1a62ca-894d-4f22-92ca-7a3db2209812`, statement_count=6, preflight_status=pass, risk_count=0, secrets_included=0; readback status `ready_no_send_external_delivery_graph` with 7/7 stages and 6/6 edges. No provider calls, credential payload reads, raw secrets, external sends, external writes, spend changes, or secrets are enabled.

> 2026-06-11 Session Insight capability binding hardening note: PR #1358 adds migration `910_sprint68_session_insight_capability_binding_hardening.sql`, removes `--explain` from Session Insight actual capability envelope creation, and adds regression coverage to prevent redacted policy explain fields from blocking approval gates. The migration persists app/action/tool graph rows for `session_insight`, including `session_insight_development_backlog_apply`, `session_insight_integration_backlog_apply`, and `session_insight_runtime_repair_backlog_apply`, all with `credential_source='none'` and `primary_executor='session_insight_backlog_target_write_execute'`. Tool bindings cover execute/list/rollback for the internal SQL backlog target write surface. Apply evidence: dry-run passed with 5 idempotent insert statements, destructive=0, risk_count=0; apply ledger `6e6745a1-94ce-4b5d-a43d-d030d0307508`; release readiness run `f5c1cba0-dd95-42d2-8fef-3ac6e512392e` passed 67/67. No provider credentials, credential payload reads, external writes, raw transcripts, or secrets are enabled.

> 2026-06-11 Session Insight backlog target write executor note: migration `284_sprint68_session_insight_backlog_target_write_executor.sql` adds internal SQL target-write tables `session_insight_backlog_target_items` and `session_insight_backlog_target_writes`, readback/issue views, policy `session_insight_backlog_target_write_executor_policy_v1`, and tools `session_insight_backlog_target_write_execute`, `session_insight_backlog_target_write_list`, and `session_insight_backlog_target_write_rollback`. Execute requires typed confirm `EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE`; rollback requires `ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE`. Scope is internal SQL backlog writes only after the capability-envelope chain completes. No provider calls, credential payload reads, external writes, raw transcripts, or secrets are enabled.

> 2026-06-11 Session Insight capability-envelope release-readiness note: migrations `277` through `283` close the Session Insight capability-envelope roadmap as gated no-execution layers. The chain adds dispatch dry-run review, actual request preflight, actual envelope request ledger, approval gate, dispatch readback, adapter execution gate, and remaining scope completion. Admin tools registered include the `session_insight_capability_envelope_*` review/preflight/request/approval/readback/adapter gate surfaces plus `session_insight_remaining_scope_completion_*`. Typed confirmations are `REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION`, `APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION`, `OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY`, and `COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION`. Release-readiness details live in `docs/session-insight-capability-envelope-release-readiness.md`. No adapter apply, runtime execution, `promotion_allowed`, `execution_allowed`, `target_write_allowed`, target write, raw transcript, credential payload read, or secrets are enabled by this chain.

> 2026-06-09 ads provider governance snapshot record gate note: PR adds migration `264_sprint68_ads_governance_snapshot_record_gate.sql`, route `/platform/orchestration/ads-provider/snapshot-record`, admin tool `ads_provider_governance_snapshot_record`, OpenAPI operation `adsProviderGovernanceSnapshotRecord`, and test `test-ads-governance-snapshot-record-gate.mjs`. The route recomputes the proposal, verifies `candidate_sha256`, requires `idempotency_key`, `capability_envelope_id`, and `apply=true`, then records snapshot/recommendation rows idempotently. Default mode is dry-run. No provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secret return. Repo mutation used capability envelope `3cc59f04-bbff-453e-9e19-b58dce9f4a20`.

> 2026-06-09 ads provider governance snapshot proposal note: PR adds migration `263_sprint68_ads_governance_snapshot_proposal.sql`, route `/platform/orchestration/ads-provider/snapshot-propose`, admin tool `ads_provider_governance_snapshot_propose`, OpenAPI operation `adsProviderGovernanceSnapshotPropose`, and test `test-ads-governance-snapshot-proposal.mjs`. The route produces `snapshot_candidate` and `recommendation_candidate` from governance metadata only and does not write `platform_orchestration_state_snapshots` or `platform_orchestration_recommendations`. No provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secret return. Repo mutation used capability envelope `51e534b6-109b-46c7-9514-99e71bab8c0b`.

> 2026-06-09 orchestration readback surface note: PR adds migration `262_sprint68_orchestration_readback_surface.sql`, views `v_platform_orchestration_graph_readiness` and `v_platform_orchestration_ads_governance_readiness`, route `/platform/orchestration/readback`, admin tool `platform_orchestration_readback`, OpenAPI operation `platformOrchestrationReadback`, and test `test-orchestration-readback-surface.mjs`. This surface reads graph/stage/edge readiness plus latest snapshots/recommendations only. It performs no provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secret return. Repo mutation used capability envelope `082a8246-d1b3-4c44-a6ee-1c526327cd8a`.

> 2026-06-09 orchestration intelligence foundation note: PR adds migration `261_sprint68_orchestration_intelligence_foundation.sql`, creating `platform_orchestration_plugins`, `platform_orchestration_stages`, `platform_orchestration_edges`, `platform_orchestration_state_snapshots`, and `platform_orchestration_recommendations`. It registers `orchestration_intelligence_engine`, `orchestration_intelligence_policy_v1`, six active policy rules, and seeds `ads_provider_governance_orchestrator` with seven stages and six edges. This is read-only/diagnose-only foundation: no provider call, no credential payload read, no spend change, no external write, no deploy, and `secrets_included=false`. Repo mutation used capability envelope `b4df7d64-946b-4c19-9369-50928fb8947c`.

> 2026-06-09 platform development constitution enforcement note: PR #1107 adds migration `260_sprint68_platform_development_constitution_policies.sql`, seeds 20 blocking policies into `execution_policies` as the current runtime enforcement source, and extends `releaseReadiness.js` so those policies become required runtime policy seeds. The safety class is idempotent policy seed only: no destructive SQL, no provider calls, no credential reads, no deploy, and `secrets_included=false`. Repo mutation used capability envelope `5ffc2021-1c0d-4f8c-ae42-e1da5e71e12a`; branch drift was checked and classified `diverged_no_overlap` before continuing bounded docs/test-manifest changes.

> 2026-06-09 ads provider preflight surface blueprint note: PR adds `ads_provider_preflight_surface_blueprint_policy_v1`, table `ads_provider_preflight_surface_blueprint_registry`, tool `ads_provider_preflight_surface_blueprint`, and migration `254_sprint67_ads_provider_preflight_surface_blueprint.sql`. The blueprint is design-only: it proposes names for future provider-specific preflight/readiness/execution surfaces after contract validation, but does not create tools, tables, credentials, adapters, provider calls, or spend surfaces.

> 2026-06-09 ads provider preflight contract note: PR adds `ads_provider_preflight_contract_policy_v1`, table `ads_provider_preflight_contract_registry`, validator `ads_provider_preflight_contract_validate`, and migration `253_sprint67_ads_provider_preflight_contract.sql`. The validator checks provider profile metadata/governance before provider-specific preflight surfaces are designed. It does not create tools, credentials, adapters, provider calls, or spend surfaces. `execution_enabled_default=false` is required.

> 2026-06-09 ads provider profile onboarding flow note: PR adds `ads_provider_profile_onboarding_flow_policy_v1`, table `ads_provider_profile_onboarding_requests`, tools `ads_provider_profile_request`, `ads_provider_profile_approve`, `ads_provider_profile_disable`, and migration `252_sprint67_ads_provider_profile_onboarding_flow.sql`. Approved providers start as `draft` profiles with `execution_enabled_default=false`; onboarding does not create provider-specific tools, credentials, adapters, or spend surfaces. No provider call, no spend change, no secrets.

> 2026-06-09 ads provider capability profile registry note: PR adds `ads_provider_capability_profile_registry_policy_v1`, table `ads_provider_capability_profile_registry`, lookup tool `ads_provider_profile_lookup`, and migration `251_sprint67_ads_provider_capability_profile_registry.sql`. `google_ads` is seeded as the first active profile. Future ads providers must be onboarded as profiles with `execution_enabled_default=false`; profiles describe capability keys, meters, preflight/readiness ledgers, validators, execution adapter, and enablement family. No provider call, no spend change, no secrets.

> 2026-06-09 Google Ads credential readiness ledger note: PR adds `google_ads_credential_readiness_ledger_policy_v1`, table `google_ads_credential_readiness_ledger`, and migration `250_sprint67_google_ads_credential_readiness_ledger.sql`. `google_ads_credential_readiness_gate` now records every result with `credential_readiness_id` and `readiness_sha256`. Future execution must require a ready ledger row before provider execution. No credential payload read, no provider call, no spend change, `secrets_included=false`.

> 2026-06-09 execution enablement approval flow note: PR adds `execution_enablement_approval_flow_policy_v1`, table `execution_enablement_requests`, tools `execution_enablement_request`, `execution_enablement_approve`, `execution_enablement_revoke`, and migration `249_sprint67_execution_enablement_approval_flow.sql`. Enablement rows now have a governed lifecycle: request -> approval hold -> scoped expiring enablement row -> revoke. No provider call, no credential read, no spend change.

> 2026-06-09 execution enablement registry note: PR adds `execution_enablement_registry_policy_v1`, table `execution_enablement_registry`, tool `execution_enablement_gate`, and migration `248_sprint67_execution_enablement_registry.sql`. Provider execution remains blocked unless an explicit active enablement row exists. Google Ads skeleton now calls the gate and blocks with `blocked_execution_enablement_missing_or_disabled` when no row exists. No provider call, no spend change, `secrets_included=false`.

> 2026-06-08 Google Ads credential readiness note: PR adds `google_ads_credential_readiness_gate_policy_v1`, tool `google_ads_credential_readiness_gate`, and migration `246_sprint67_google_ads_credential_readiness_gate.sql`. It checks active Google Ads connection and credential binding metadata only. It does not read encrypted credentials, decrypt tokens, call Google Ads, or mutate spend. Future execution requires this gate in addition to preflight validation and explicit enablement.

> 2026-06-08 Google Ads execution adapter skeleton note: PR adds `google_ads_budget_execution_adapter_skeleton_policy_v1`, audit table `google_ads_budget_execution_gate_audit`, skeleton `google_ads_budget_change_execution_adapter`, and migration `245_sprint67_google_ads_execution_adapter_skeleton.sql`. The skeleton validates `preflight_id` through `requireValidatedPreflightForExecution`, records audit, then blocks provider execution. Admin endpoint remains disabled; no Google Ads call, no credential read, no spend mutation.

> 2026-06-08 preflight execution gate helper note: PR adds `preflight_execution_gate_helper_policy_v1`, helper `preflightLedgerExecutionGate.js`, and migration `243_sprint67_preflight_execution_gate_helper.sql`. Future execution adapters must use `requireValidatedPreflightForExecution` before mutation. The helper wraps `preflight_ledger_validate`, enforces ready preflight rows, optional envelope match, hash/readback, and no-provider/no-spend/no-secret markers. No execution.

> 2026-06-08 preflight ledger validator note: PR adds `preflight_ledger_validator_policy_v1`, table `preflight_ledger_validator_registry`, tool `preflight_ledger_validate`, and migration `242_sprint67_preflight_ledger_validator.sql`. Future execution adapters should validate `preflight_id` through this tool rather than reading family ledgers directly. The validator checks ready state, optional envelope match, no-provider/no-spend/no-secret markers, and payload hash. No execution.

> 2026-06-08 Google Ads preflight ledger note: PR adds `google_ads_budget_preflight_ledger_policy_v1`, table `google_ads_budget_preflight_ledger`, and migration `241_sprint67_google_ads_budget_preflight_ledger.sql`. `google_ads_budget_change_preflight` now records every result with `preflight_id` and `preflight_sha256`; future Google Ads execution adapters must require a ready ledger row before mutation. No provider call, no credential read, no spend change, `secrets_included=false`.

> 2026-06-08 Google Ads budget preflight note: PR adds `google_ads_budget_change_preflight_policy_v1`, tool `google_ads_budget_change_preflight`, and migration `238_sprint67_google_ads_budget_change_preflight.sql`. It requires a ready Google Ads capability envelope and `budget_quota_authority_dry_run=ready_for_dispatch` before any future budget mutation adapter. It is preflight only: no Google Ads provider call, no credential read, no spend change, `secrets_included=false`.

> 2026-06-08 budget/quota authority note: PR adds `budget_quota_authority_registry_policy_v1`, table `budget_quota_authority_registry`, tool `budget_quota_authority_dry_run`, and migration `236_sprint67_budget_quota_authority_registry.sql`. It is dry-run only, blocks missing/exceeded spend authority, routes approval-required spend through envelope approval, and includes no provider spend or connector forwarding. `secrets_included=false`.

> 2026-06-08 repo patch capability envelope note: PR adds `repo_patch_apply_capability_envelope_requirement_v1` and migration `234_sprint67_repo_patch_capability_envelope_requirement.sql`. `repo_patch_apply` requires `capability_envelope_id` before GitHub App token resolution; `repo_inspect` remains read-only and ungated. Runtime order: input/path validation, protected branch guard, capability envelope guard, GitHub App token resolution, stale/diverged branch preflight, then contents mutation. SQL safety: policy/runtime-config seed only, no destructive SQL, `secrets_included=false`.

Last updated: 2026-06-07 (shared reconciliation continuation engine and scoped resume policy)

## Current Patch Set

### 2026-06-08 — Admin Branch Reconcile Continuation Adapter

- Status: PR pending; CI required before merge.
- Branch: `gpt/admin-branch-reconcile-adapter-20260608`
- Scope:
  - Added virtual admin tool `admin_branch_reconcile` for non-protected repository work branches.
  - Added branch classification: `clean`, `behind_only`, `ahead_only`, `diverged`, and `unknown`.
  - Added no-secret shared reconciliation checkpoint evidence for stale/diverged branch states.
  - Added safe apply path only for `behind_only` branches using GitHub ref update with `force:false` and explicit `FAST_FORWARD_<BRANCH_SLUG>` confirmation.
  - Added migration `234_sprint68_admin_branch_reconcile_continuation_policy.sql` and tracked it in governed migration runner and release readiness.
- Runtime behavior:
  - `diagnose` and `dry_run` fetch base ref, branch ref, and compare state, then return continuation evidence.
  - `apply` is blocked for `diverged`, `ahead_only`, `unknown`, protected/default branches, or missing confirmation.
  - The adapter never force-pushes and must verify compare state after a fast-forward apply before reporting reconciliation.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No destructive SQL, no secret values, and `secrets_included=false`.
- Evidence:
  - `test-admin-branch-reconcile-adapter.mjs` asserts classification, confirmation, continuation evidence, no force-push, migration policy, runner allowlist, and release-readiness tracking.
  - PR CI/manual CI evidence to be recorded before merge.

### 2026-06-08 — Local Connector Tunnel Provisioning Continuation

- Status: PR pending; CI required before merge.
- Branch: `gpt/local-connector-no-token-continuation-20260608`
- Scope:
  - Added `connector_tunnel_provisioning_required` to the shared reconciliation interruption signals.
  - Added `buildLocalConnectorTunnelProvisioningContinuationEvidence()` in `adminCliRoutes.js`.
  - Changed `POST /admin/cli/local-connector/self-repair` so missing DB `cf_token` and missing `CLOUDFLARE_TUNNEL_TOKEN` return a resumable 409 handoff instead of a dead-end 404.
  - Added migration `233_sprint68_local_connector_tunnel_provisioning_continuation_policy.sql` to register the blocking policy `Local Connector Tunnel Provisioning Continuation Contract`.
  - Added migration 233 to the governed migration runner allowlist and release-readiness expected ledger coverage.
- Runtime behavior:
  - If connector recovery starts from HTTP 530/1033 and self-repair cannot find a tunnel token, the response includes `continuation.checkpoint`, `resume_plan`, `provisioning.required_next_action=provision_tunnel_token`, and `secrets_included=false`.
  - Agents must provision the tunnel token through an authorized secret/config path, then retry self-repair and verify connector health in the same cycle before reporting recovery.
  - The response and audit payload must not include `cf_token`, `connector_secret`, `CLOUDFLARE_TUNNEL_TOKEN`, or `BACKEND_API_KEY`.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No destructive SQL, no secret values, and `secrets_included=false`.
- Evidence:
  - `test-admin-control.mjs` asserts continuation evidence, no-secret handoff, policy migration, runner allowlist, and release-readiness tracking.
  - `test-shared-reconciliation-engine.mjs` asserts `connector_tunnel_provisioning_required` is a generalized signal.
  - PR CI/manual CI evidence to be recorded before merge.

### 2026-06-08 — Chunked Tool Response Continuation Contract

- Status: PR #868 opened; CI required before merge.
- Branch: `gpt/chunk-read-generalized-fallback-20260608`
- Scope:
  - Added `CHUNKED_TOOL_RESPONSE_CONTINUATION_CONTRACT` in `http-generic-api/routes/gptToolsRoutes.js`.
  - Chunked responses now include `continuation.required_tool=response_chunk_read`, `continuation.required_before_fallback`, and a `continuation.next_call` payload.
  - Added migration `232_sprint68_chunked_tool_response_continuation_policy.sql` to register the blocking policy `Chunked Tool Response Continuation Contract`.
  - Added migration 232 to the governed migration runner allowlist and release-readiness expected ledger coverage.
  - Updated `AI_Agent_Knowledge_Guide.md` so agents must exhaust `response_chunk_read` before local slices, secondary search, connector reads, or external fallbacks.
- Runtime behavior:
  - Any governed tool response with `response_chunked=true`, `page.has_more=true`, or `page.next_cursor` must be continued through `response_chunk_read` until `has_more=false`.
  - Alternative surfaces are allowed only after all chunks are read, the chunk cache expires and the original tool is retried, or `response_chunk_read` is unavailable/authorization-gated.
  - Agents must not claim a file/result is fully read while the response page still has more chunks.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No destructive SQL, no secret values, and `secrets_included=false`.
- Evidence:
  - `test-gpt-tools-response-chunking.mjs` asserts runtime contract metadata, migration 232 content, runner allowlist, and release-readiness tracking.
  - PR CI/manual CI evidence to be recorded before merge.

### 2026-06-07 — Shared Reconciliation Continuation Engine

- Status: PR #855 opened, CI success on branch before docs-agent note; targeted docs alignment added in PR.
- Branch: `gpt/shared-reconciliation-continuation-20260607`
- Scope:
  - Added `http-generic-api/sharedReconciliationEngine.js` as the shared continuation/reconciliation contract for resumable governed operations.
  - Added migration `231_sprint68_shared_reconciliation_continuation_policy.sql` to register the blocking policy `Shared Reconciliation Engine Continuation Contract`.
  - Added `http-generic-api/docs/shared-reconciliation-continuation-runbook.md` for operations after tool timeout, session expiry, branch drift, deployment reload gaps, unsupported fallback, credential intake, or approval pauses.
  - Added tests `test-shared-reconciliation-engine.mjs` and `test-shared-reconciliation-continuation-policy.mjs`, and added both to the test manifest.
- Runtime behavior:
  - Continuation checkpoints must include actor scope, resource scope, resource fingerprint, current stage, interruption signal, resume metadata, and `secrets_included=false`.
  - Direct resume is allowed only when the current resource fingerprint still matches the checkpoint.
  - Drifted resources require dry-run repair, verification, apply gate, audit, and then original-operation resume.
  - The engine is shared across admin, tenant, user, and local/device flows, but authority remains scoped: tenant/user actors cannot reconcile platform or repository resources.
- SQL safety class:
  - Policy seed only; `INSERT INTO execution_policies ... ON DUPLICATE KEY UPDATE`.
  - No `DROP`, `TRUNCATE`, broad `DELETE`, broad table conversion, or secret-payload mutation.
- Evidence:
  - `node test-shared-reconciliation-engine.mjs`: pass.
  - `node test-shared-reconciliation-continuation-policy.mjs`: pass.
  - `node scripts/run-test-manifest.mjs --grep shared-reconciliation`: pass.
  - `node test-connection-capability-repair-before-fallback-policy.mjs`: pass.
  - `node test-github-branch-maintenance-fallbacks.mjs`: pass.
  - `node test-admin-workspace-authority-routes.mjs`: pass after local worktree dependency install.
  - GitHub Actions on PR creation: CI success, Docs Agent success, PR Risk Labeler success for head `43c975fd`.
- Operational note:
  - Docs Agent added `docs/auto-docs-agent/pr-855.md` and requested this targeted ledger/checklist/governance update because the PR includes a policy migration.
  - Local verification used a detached worktree and reported Node `v24.15.0` while the project engine requires `>=22 <23`; targeted tests still passed, and GitHub CI runs Node 22.

### 1. MySQL Registry Migration Baseline

- Status: committed
- Commit: `da92ab5 Refactor: Migrate from Google Sheets to MySQL and configure sqlAdapter`
- Scope:
  - Added MySQL-backed registry support.
  - Added `migrate-sheets-to-sql.mjs` migration flow.
  - Added `sqlAdapter.js`, `db.js`, and schema support.
- Evidence:
  - Commit exists in local history.
- Open risk:
  - Migration completeness claims should be re-verified against the live database before production deployment.

### 2. Server Modularization

- Status: committed
- Commit: `852cf05 Add AI resolvers and provider timeout diagnostics`
- Files:
  - `http-generic-api/server.js`
  - `http-generic-api/authService.js`
  - `http-generic-api/stateManager.js`
- Scope:
  - Extracted auth/schema guard wrappers into `authService.js`.
  - Extracted registry state/cache/load wrappers into `stateManager.js`.
  - Repaired interrupted import wiring in `server.js`.
- Evidence:
  - `node --check server.js` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.

### 3. Plan And Task Generation Resolvers

- Status: committed
- Commits: `852cf05`, `8cff850 Align AI resolvers with intent maturation`
- Files:
  - `http-generic-api/services/planningResolver.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/routes/index.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
  - `http-generic-api/package.json`
- Runtime behavior:
  - `POST /ai/implementation-plan` returns a Markdown implementation plan.
  - `POST /ai/task-manifest` returns a Markdown task checklist.
  - Both routes use the existing backend API key middleware.
  - Both routes call OpenAI via `fetch` and require `OPENAI_API_KEY`.
  - Outputs are returned synchronously; no database or file persistence has been added yet.
- Evidence:
  - `node test-ai-resolvers.mjs` passed from `http-generic-api`.
  - Included in `npm.cmd test`.

### 4. Provider Fetch Timeout And Diagnostics

- Status: committed
- Commit: `852cf05 Add AI resolvers and provider timeout diagnostics`
- Files:
  - `http-generic-api/execution.js`
  - `http-generic-api/executionDispatch.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-provider-fetch-timeout.mjs`
  - `http-generic-api/package.json`
  - `http-generic-api/validate-architecture.mjs`
- Scope:
  - Wrapped provider `fetch` calls with `AbortController`.
  - Added controlled provider timeout handling before worker-level timeout.
  - Added diagnostic log events:
    - `PROVIDER_FETCH_START`
    - `PROVIDER_RESPONSE_STATUS`
    - `PROVIDER_FETCH_END`
    - `PROVIDER_FETCH_TIMEOUT`
    - `PROVIDER_FETCH_ERROR`
    - `PROVIDER_ELAPSED_MS`
  - Added `provider_timeout_ms` support.
  - Returns controlled `504` response with `provider_timeout` instead of waiting for opaque `worker_timeout`.
- Evidence:
  - `node test-provider-fetch-timeout.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.

### 5. AI Resolver Intent Maturation Bridge

- Status: committed
- Commit: `d6881f8 Preserve AI intent maturation across routes`
- Files:
  - `http-generic-api/services/intentMaturationResolver.js`
  - `http-generic-api/routes/aiResolverRoutes.js`
  - `http-generic-api/services/taskResolver.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-resolvers.mjs`
  - `http-generic-api/test-ai-resolver-routes.mjs`
- Scope:
  - Keeps generated plans and task manifests aligned with the existing first-class intent maturation model.
  - Normalizes AI generation requests through existing contracts:
    - `NormalizedExecutionIntent`
    - `NormalizedRouteWorkflowState`
    - `NormalizedMutationIntent`
  - Adds `intent_maturation` to AI resolver responses.
  - Injects matured intent context into plan/task prompts.
  - Adds direct route handler coverage for intent-maturation response and prompt injection.
  - Preserves upstream plan-generation `intent_maturation` context when generating task manifests.
  - Adds HTTP-level route coverage for plan -> task intent continuity.
  - Avoids creating a parallel JSON Asset persistence path.
- Evidence:
  - `node test-ai-resolvers.mjs` passed from `http-generic-api`.
  - `node test-ai-resolver-routes.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.

### 6. AI Resolver Registry Readiness

- Status: committed
- Commit: `54d8a3b Add AI registry readiness diagnostic`
- Files:
  - `http-generic-api/routeWorkflowGovernance.js`
  - `http-generic-api/stateManager.js`
  - `http-generic-api/routes/governanceRoutes.js`
  - `http-generic-api/server.js`
  - `http-generic-api/test-ai-registry-readiness.mjs`
  - `http-generic-api/package.json`
- Scope:
  - Adds a validation-only AI resolver registry readiness check for:
    - `ai_implementation_plan_generation`
    - `ai_task_manifest_generation`
  - Validates Task Routes rows by `intent_key` and executable authority.
  - Validates linked Workflow Registry rows through `workflow_key`, `workflow_id`, or compatible route binding.
  - Adds `GET /ai/registry-readiness` as a diagnostic endpoint.
  - Does not mutate live registry rows.
- Evidence:
  - `node test-ai-registry-readiness.mjs` passed from `http-generic-api`.
  - `npm.cmd run validate` passed from `http-generic-api`.
  - `npm.cmd test` passed from `http-generic-api`.

## Verification Snapshot

- `node --check server.js`: pass
- `node test-ai-resolvers.mjs`: pass
- `node test-ai-resolver-routes.mjs`: pass
- `node test-ai-registry-readiness.mjs`: pass
- `node test-provider-fetch-timeout.mjs`: pass
- `node test-routes.mjs`: pass with route runtime checks skipped by default
- `npm.cmd test`: pass
- `npm.cmd run validate`: pass, 173 passed / 0 failed

Cloud Build (all SUCCESS):

- `54d8a3b Add AI registry readiness diagnostic`: SUCCESS (build 4cfa8cd9, finished 2026-05-04 12:09 UTC)
- `d6881f8 Preserve AI intent maturation across routes`: SUCCESS (build e1fd36a4, finished 2026-05-04 11:58 UTC)
- `8cff850 Align AI resolvers with intent maturation`: SUCCESS (build fb4a8fe7, finished 2026-05-04 11:53 UTC)

Note: `npm test` through PowerShell failed because `npm.ps1` is blocked by the local execution policy. `npm.cmd test` was used instead and passed.

## Current Uncommitted Work

None. Working tree is clean. All 6 patches are committed and deployed.

## Compaction Transcript Check

- Transcript path from compacted session:
  - `C:\Users\IT\.claude\projects\d--Nagy-Multi-Business-Multi-Role-Growth-Intelligence-OS\f4bd12c1-7a6d-47fb-a002-fbef9db6c2fc.jsonl`
- Local status:
  - File exists.
  - Last write time: 2026-05-04 12:37:57 Africa/Cairo.
  - Approximate size: 4.1 MB.
- Important evidence recovered:
  - Sheets to MySQL dry run succeeded for all 15 tables.
  - Dry-run estimate: 12,613 rows across 15 tables.
  - First live `--truncate` migration migrated 14 tables and failed on `Registry Surfaces Catalog`.
  - Failure reason: duplicate `surface_id` value `surface.hosting_account_registry_sheet` against unique key `uq_surface_id`.
  - This explains why `--ignore` support was added afterward for the registry surface migration.
- Security note:
  - The raw transcript includes local paths, tool state, and `.env` content. Do not commit, paste, or share the transcript directly.

## Live Registry Row Status — VERIFIED

Rows added directly to the live authoritative workbook (Growth Intelligence OS - Registry Workbook).
No code commit was made for this step; the registry is the authority.

### Task Routes — Written and readback-verified

Written range: `Task Routes!A209:AU210` — 2 rows, 47 columns, 94 cells

| `intent_key` | `route_id` | `endpoint_path` | `workflow_key` | `active` |
|---|---|---|---|---|
| `ai_implementation_plan_generation` | `route_ai_implementation_plan_generation` | `/ai/implementation-plan` | `wf_ai_implementation_plan_generation` | `TRUE` |
| `ai_task_manifest_generation` | `route_ai_task_manifest_generation` | `/ai/task-manifest` | `wf_ai_task_manifest_generation` | `TRUE` |

### Workflow Registry — Written and readback-verified

Written range: `Workflow Registry!A240:BA241` — 2 rows, 53 columns, 106 cells

| `workflow_id` | `workflow_key` | `active` |
|---|---|---|
| `wf_ai_implementation_plan_generation` | `wf_ai_implementation_plan_generation` | `TRUE` |
| `wf_ai_task_manifest_generation` | `wf_ai_task_manifest_generation` | `TRUE` |

### Local test evidence

- `node test-ai-registry-readiness.mjs`: **pass**
- `npm.cmd test`: **33 passed, 0 failed**

## Next Steps

1. ~~Call `GET /ai/registry-readiness` against the live deployed service.~~ Done — rows added and readback-verified.
2. ~~Add Task Routes + Workflow Registry rows.~~ Done.
3. Call `GET /ai/registry-readiness` against the **deployed Cloud Run service** (not local) to confirm the live endpoint resolves the new rows from Sheets.
4. Catalog reconciliation: fix duplicate `surface_id` (`surface.hosting_account_registry_sheet`), register 8 unregistered live tabs, refresh expected column counts for tabs where live header no longer matches catalog metadata.
5. Build Sheets → SQL merge migrator: per-table natural key diff, upsert-on-match, insert-if-missing, dry-run by default, `--apply` to write.

## Remaining Decisions

- Decide whether generated plans/tasks should remain synchronous API responses or also be persisted as JSON assets.
- Decide whether OpenAI should remain a direct `fetch` integration or be routed through the existing generic HTTP connector registry.
- Verify or add the two live Task Routes rows and their linked Workflow Registry rows.

---

## Patch 7 — Production Hardening: Schema Expansion, Catalog Reconciliation, Migration Merge, CI Tests

- Status: committed
- Scope: All phases of http-generic-api production hardening
- Files changed:
  - `http-generic-api/sqlAdapter.js` — fixed column count comment (67 → 66 for validation_repair)
  - `http-generic-api/test-migrate-sql-adapter.mjs` — new: 104 unit tests for toSqlCol(), TABLE_MAP completeness, SHEET_COLUMNS counts, no post-normalisation duplicates
  - `http-generic-api/test-expand-schema-logic.mjs` — new: 623 unit tests for expand-schema toSqlCol() parity, dry-run ALTER TABLE guard, pool lifecycle
  - `http-generic-api/package.json` — added two new test files to npm test script
  - `http-generic-api/reconcile-catalog.mjs` — new: RSC health checker (7 flags, Sheets-only, no DB)
  - `http-generic-api/migrate-sheets-to-sql.mjs` — new: 15-table Sheets→SQL migrator (seed + merge modes)
  - `http-generic-api/openapi.yaml` — new: OpenAPI spec
  - `deployment_parity_checklist.md` — fixed github.js export count (2 → 14); added ACTIVITY_SPREADSHEET_ID and EXECUTION_LOG_UNIFIED_SPREADSHEET_ID to Layer 2
  - `runtime_boundary_map.md` — added Section 4b: SQL data layer boundaries (db.js, sqlAdapter.js, dataSource.js, migrate/expand/reconcile CLI tools)
  - `README.md` — added Sheets→MySQL data layer section with env vars, migration script sequence, and updated test counts

### Schema Expansion Results

- 282 new columns added across 8 tables in a single `expand-schema.mjs --apply` run:
  - `brands`: 25 → 122 columns
  - `actions`: 16 → 47 columns
  - `endpoints`: 30 → 58 columns
  - `task_routes`: 46 columns (priority dupe removed, count confirmed at 46)
  - `workflows`: 38 → 53 columns
  - `brand_core`: 8 → 20 columns
  - `registry_surfaces_catalog`: 17 → 38 columns
  - `validation_repair`: 11 → 66 columns
- `node expand-schema.mjs` (dry-run) now reports: New columns detected: 0

### Catalog Reconciliation Results

All 7 catalog health checks report 0:
- Duplicate surface_ids: 0
- Unregistered tabs: 0
- Missing tabs (required): 0
- Missing tabs (optional): 0
- GID mismatches: 0
- Column count mismatches: 0

### Migration Merge Run Results

Live merge run (`migrate-sheets-to-sql.mjs --merge --apply`) completed:
- 138 inserts across all tables
- 681 updates across all tables
- 0 errors

### OAuth Desktop App Auth Setup

- `auth.mjs` — one-time OAuth2 Desktop flow saves token to `google-oauth-token.json`
- `auth-setup.mjs` — pre-existing auth setup helper
- `get-live-headers.mjs` — live sheet header dump utility
- Token saved: `http-generic-api/google-oauth-token.json` (gitignored)
- Secret: `secrets/oauth-client.json` (gitignored)

### Audit Findings (Phase 1)

- `db.js`: pool.end() is NOT called in Express server — only in CLI scripts. Correct.
- `dataSource.js`: all three DATA_SOURCE modes (sheets/dual/sql) are correctly wired.
- `config.js`: all env vars declared with sensible defaults. ACTIVITY_SPREADSHEET_ID and EXECUTION_LOG_UNIFIED_SPREADSHEET_ID are derived constants, not raw env vars (ACTIVITY_SPREADSHEET_ID defaults to REGISTRY_SPREADSHEET_ID).
- `reconcile-catalog.mjs`: correctly does NOT import db.js or any MySQL module — Sheets-only tool.
- `expand-schema.mjs` and `sqlAdapter.js` toSqlCol() functions are textually identical — verified by test suite.
- No test files import google-oauth-token.json or secrets/ directly.
- No circular imports detected.
- TABLE_MAP: 15 entries, all present in SHEET_COLUMNS — verified by test suite.
- SHEET_COLUMNS: no post-normalisation duplicates in any of the 15 tables — verified by test suite.

### Verification Snapshot

- `node expand-schema.mjs`: New columns detected: 0
- `node migrate-sheets-to-sql.mjs --dry-run`: 13,025 rows across 15 tables, no errors
- `node reconcile-catalog.mjs`: all 7 checks = 0
- `node validate-architecture.mjs`: 173 passed, 0 failed
- `npm test`: all test files pass (46+ files, 800+ assertions)

---

## Patch 8 — DB Production Hardening: Tightening, Server Bypass Removal, Smoke Test

- Status: committed
- Date: 2026-05-04
- Files changed:
  - `http-generic-api/tighten-db.mjs` — new: dedup natural keys, UNIQUE constraints, indexes, TEXT→VARCHAR
  - `http-generic-api/smoke-test-data-flow.mjs` — new: end-to-end data-flow smoke test across all 15 SQL tables
  - `http-generic-api/server.js` — removed inline `sqlAdapter.appendRow` bypass in `performGovernedSheetMutation` (SQL mirroring now exclusively through `dataSource.js`)
  - `http-generic-api/sqlAdapter.js` — fixed `task_routes` duplicate `"priority"` column (both `"Priority"` and `"priority"` normalized to same SQL col); corrected `validation_repair` column count comment (67 → 66)
  - `http-generic-api/reconcile-catalog.mjs` — expanded: cross-workbook tab resolution via `file_id` column, `normalizeTabName()`, `isRetired()`, 7th flag `--retire-deleted` and `--demote-required`
  - `runtime_boundary_map.md` — updated reconcile-catalog boundary, added tighten-db.mjs and smoke-test-data-flow.mjs CLI boundaries
  - `README.md` — added tighten-db.mjs and smoke-test-data-flow.mjs to migration scripts; updated test counts (44+ → 46+)
  - `deployment_parity_checklist.md` — updated test assertion count; added smoke-test-data-flow.mjs to Layer 1 CI gate

### DB Tightening Results

Deduplication:
- 3,000+ duplicate rows removed across 5 tables (source: sheet duplication across brand-specific tabs migrated together)
- UNIQUE constraints now prevent re-introduction

UNIQUE constraints added:
- `task_routes.route_id`
- `workflows.workflow_id`
- `endpoints.endpoint_id`
- `execution_policies.(policy_group, policy_key)`
- `brand_core.(brand_key, asset_key)`

Indexes added: `intent_key`, `brand_scope`, `active`, `maturity(50)`, `result_state(100)`, `severity(100)`, `active_status`

TEXT → VARCHAR promotions: `registry_surfaces_catalog.file_id/source_surface_id/parent_surface_id`, `actions.action_id`, `validation_repair.validation_type/result_state/severity/rule_id`

### Smoke Test Results (2026-05-04)

`node smoke-test-data-flow.mjs` — **70 passed, 0 failed**

Live row counts verified:
| Table | Rows |
|---|---|
| brands | 6 |
| brand_core | 141 |
| actions | 19 |
| endpoints | 1,491 |
| execution_policies | 1,097 (1,088 active, 801 blocking) |
| hosting_accounts | 6 |
| site_runtime_inventory | 60 |
| site_settings_inventory | 8 |
| plugins | 10 |
| task_routes | 206 (205 active) |
| workflows | 239 |
| registry_surfaces_catalog | 395 (360 required, 383 active, 0 duplicate surface_ids) |
| validation_repair | 808 |
| json_assets | 2,791 |
| execution_log | 12,012 |

Chain verified: `seo_strategy` intent_key → `task_routes.workflow_key` = `tour_catalog_analysis_workflow` → `workflows.execution_class` resolved.

UNIQUE enforcement confirmed: `task_routes.route_id` and `workflows.workflow_id` both return `ER_DUP_ENTRY` on duplicate insert.

### Data Observations

- `donatours.com` brand has 0 rows in `site_runtime_inventory` and `site_settings_inventory` — runtime inventory not yet populated for this brand.
- 91 sheet-side duplicate natural keys remain in source Sheets (same workflow_key appearing multiple times across brand-specific tabs); migrator handles these correctly via INSERT IGNORE.
- `brand_core` has some rows with blank `brand_key`/`asset_key` after dedup — source data entry gap, not a schema failure.

### Verification Snapshot

- `node smoke-test-data-flow.mjs`: 70 passed, 0 failed
- `node tighten-db.mjs` (dry-run after apply): 0 dedup candidates, all UNIQUE constraints already present
- `node reconcile-catalog.mjs`: all 7 checks = 0
- `npm test`: 46+ files, 800+ assertions, all pass

---

## Patch 9 — Credential Sanitization, Secure Auth Resolution, Formula & AppScript Protection

- Status: committed
- Date: 2026-05-04

### Scope

**Embedded credentials removed from SQL (sanitize-credentials.mjs --apply ran):**
- `actions.api_key_value` NULLed for 6 rows (serpapi_search, scraperapi_scrape, abstractapi_scrape, googleads_api, github_api_mcp, make_mcp_server); `api_key_storage_mode` updated to `secret_reference`; `secret_store_ref` set to `ref:secret:<ENV_VAR>` format
- `brands.application_password` NULLed for 3 rows (Dona tours, AllRoyalEgypt Brand, Almallah Group)
- `hosting_accounts.api_key_reference` replaced with `ref:secret:<ENV_VAR>` for 2 rows (hostinger_cloud_plan_01, hostinger_shared_manager_01); `api_key_storage_mode` updated to `secret_reference`

**Files changed:**
- `http-generic-api/sanitize-credentials.mjs` — new: one-time cleanup script; idempotent dry-run / --apply
- `http-generic-api/authCredentialResolution.js` — rewired all four auth modes through storage-mode-aware helpers; `embedded_sheet` now logs a security warning and returns empty instead of leaking the raw value; `resolveWpAppPassword()` reads from env var first (`<TARGET_KEY_UPPER>_APP_PASSWORD`), falls back with warning; `getAdditionalStaticAuthHeaders()` now calls `resolveActionSecret()` instead of reading `api_key_value` directly
- `http-generic-api/migrate-sheets-to-sql.mjs` — added formula detection (dual FORMATTED_VALUE + FORMULA fetch); formula-driven columns excluded from merge diff and UPDATE payload; added `APPSCRIPT_MANAGED_SHEETS` set (currently: Execution Log Unified); AppScript-managed sheets receive inserts only in merge mode, never updates

### Required env vars (add after rotating secrets)

```
SERPAPI_API_KEY=<rotated>
SCRAPERAPI_API_KEY=<rotated>
ABSTRACTAPI_API_KEY=<rotated>
GOOGLEADS_DEVELOPER_TOKEN=<rotated>
GITHUB_TOKEN=<rotated>        # already in .env — confirm rotation
MAKE_MCP_TOKEN=<rotated>
DONATOURS_WP_APP_PASSWORD=<rotated>
ALLROYALEGYPT_WP_APP_PASSWORD=<rotated>
ALMALLAH_WP_APP_PASSWORD=<rotated>
HOSTINGER_CLOUD_PLAN_01_API_KEY=<rotated>
HOSTINGER_SHARED_MANAGER_01_API_KEY=<rotated>
```

### Remaining manual steps (owner)

1. **Rotate each exposed credential** at its provider dashboard (WP Admin → Application Passwords, SerpAPI dashboard, GitHub PAT settings, Hostinger API tokens, etc.)
2. **Add rotated values to .env** using the env var names above
3. **Clear the source Google Sheets cells**: in the Sheets source, blank the `application_password` column for the 3 brand rows and blank `api_key_value` for the 6 action rows and `api_key_reference` for the 2 hosting account rows. This prevents the next `migrate --merge --apply` from writing NULLs over if the sheet still has values (migrator will update SQL with whatever is in Sheets on the next merge run).
4. **AppScript audit**: open Apps Script on the Activity Workbook; confirm no trigger writes credential values into sheet cells. Confirm all enforcement events write only to `Execution Log Unified` and not to credential-holding columns.

### Formula & AppScript notes

**Sheet formulas:** The migrator now fetches both `FORMATTED_VALUE` and `FORMULA` render options per sheet. Any column that contains a formula (`=`) in any data row is tracked in `formulaColumns` and excluded from:
- the row signature used for change detection in merge mode
- the `updateRowById` payload (formula-computed values are never written back to SQL from a stale snapshot)

This means formula-driven columns (e.g. auto-computed scores, cross-sheet lookups, array formula outputs) are treated as read-only by the migrator. The SQL values for those columns are only updated when the Sheets source is re-seeded (`--truncate`), not in incremental merge mode.

**AppScript on Activity Workbook:** `Execution Log Unified` is registered in `APPSCRIPT_MANAGED_SHEETS`. In merge mode, the migrator inserts new rows but never updates existing SQL rows. This prevents the migrator from overwriting AppScript enforcement-event edits (row annotations, status updates, computed fields) with stale SQL snapshots. The Execution Log is already `NATURAL_KEYS = null` (append-only), so merge mode skips it entirely anyway — the AppScript registration serves as an explicit declaration of intent for future maintainers.

### Verification

- `npm.cmd test`: 623 passed, 0 failed
- `node smoke-test-data-flow.mjs`: 70 passed, 0 failed
- `node --check authCredentialResolution.js`: OK
- `node --check migrate-sheets-to-sql.mjs`: OK
- DB: `actions.api_key_value` NULL for all `embedded_sheet` rows; `hosting_accounts.api_key_reference` updated to `ref:secret:` format; `brands.application_password` NULL

---

## Patch 10 — Parent Action External Auth Strategy

- Status: committed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/076_sprint61_parent_action_auth_strategy.sql`

### Scope

External endpoint credential selection is now governed from the parent action row instead of duplicated per endpoint.

Authoritative policy location:

```text
actions.runtime_binding_profile.auth_strategy
```

Optional endpoint override location:

```text
endpoints.runtime_binding_profile.auth_strategy_override
```

Runtime selector fields exposed through endpoint tools:

```text
credential_scope = platform | user | tenant | connection | auto
user_id
tenant_id
connection_id
app_key
scopes
auth_type
allow_platform_fallback
auth_context
```

### Files changed

- `http-generic-api/userAppConnectionCredentials.js` — generic `user_app_connections` resolver for user/tenant/connection credentials.
- `http-generic-api/authCredentialResolution.js` — parent action auth strategy resolver and scoped credential contract builder.
- `http-generic-api/authInjection.js` — recognizes `custom_headers` auth mode.
- `http-generic-api/executionPreparation.js` — merges runtime auth selector fields into `auth_context`.
- `http-generic-api/routes/systemLayerRoutes.js` — forwards the external auth selector set from exported tool calls to the runtime facade.
- `http-generic-api/migrations/076_sprint61_parent_action_auth_strategy.sql` — idempotent DB reconciliation for parent auth policies and exported tool schemas.
- `docs/external-endpoint-auth-strategy.md` — operating guide.
- `docs/registry-taxonomy.md`, `README.md`, `AI_Agent_Knowledge_Guide.md`, `connector_contracts.md`, `deployment_parity_checklist.md` — documentation alignment.

### Runtime behavior

- Parent actions default to platform credentials unless runtime scope requests user, tenant, connection, or auto.
- Scoped credentials resolve from `user_app_connections.encrypted_credentials`.
- Secret material remains encrypted or referenced. It is not copied into `actions`, `endpoints`, or tool export rows.
- If `credential_scope` is `user`, `tenant`, or `connection` and `allow_platform_fallback=false`, the runtime must return a scoped credential error rather than using a platform secret.
- `github_actions_status` and `github_git_data` now use GitHub App auth instead of an expiring `GITHUB_TOKEN` bearer token.

### Verification

- `cloudflare_api__cf_list_zones` with `credential_scope=platform` returned `200`.
- `cloudflare_api__cf_list_zones` with `credential_scope=user`, admin user id, and `allow_platform_fallback=false` returned `403 external_credential_connection_not_found` as expected.
- `google_drive_api__listDriveFiles` platform scope returned `200` after the Google resolver fix.
- User-scoped Google Drive without an active OAuth connection and without fallback returned the scoped auth error as expected.
- GitHub Actions status query now resolves through `github_app` and returns `200`.
- CI verification after push completed successfully.

---

## Patch 11 — Session Archive Relink After Restore

- Status: applied and documented
- Date: 2026-05-17
- Runbook: `docs/session-archive-relink-2026-05-17.md`

### Scope

A database restore removed the active `customer_sessions` row for the official session folder:

```text
session_f0132008-edae-44d0-8668-87b44b2fde26
folder_id = 1enrrI7OU3_R0vAaCyfm-N7Ii7IU5Q3AG
```

The GPT tool dispatcher continued archiving to a superseded active SQL session:

```text
session_5dee2542-80e3-45f2-8bef-087c59d5def5
folder_id = 1cYCHu2pAX8_EGa11jCQH62kbAcvSrDza
```

### Actions

- Recreated the missing `customer_sessions` row for the official `f013...` session.
- Rebound it to the official Drive folder, transcript Doc, JSONL, and Exports folder.
- Copied bounded SQL `gpt_session_turns` rows from the superseded `5dee...` session back under the official `f013...` session.
- Copied target turn range: `114..291`.
- Marked the superseded `5dee...` session as completed/superseded.
- Added a `Restore Relink Backfill — 2026-05-17` note to the official Google Doc.
- Added reusable CLI `http-generic-api/session-archive-relink-repair.mjs`.
- Added governed built-in `admin_control` shell aliases: `session_archive_relink_repair_dry_run` and `session_archive_relink_repair_apply`.
- Added migration `http-generic-api/migrations/077_sprint61_session_archive_relink_aliases.sql` to document alias usage in the admin tool registry schema.
- Verified the official folder resumed updates.

### Guardrail added

After any DB restore or replay, verify that the active `customer_sessions` row selected by `routes/gptToolsRoutes.js` points to the intended Drive folder before continuing platform work.

### Verification

- Official `Tool_Calls.jsonl` modified at approximately `2026-05-17T09:55:41Z`.
- Official `Session Transcript` modified at approximately `2026-05-17T09:53:14Z`.
- `customer_sessions.archive_status` for `f013...` is `ready`.
- `5dee...` is marked completed/superseded.

---

## Patch 12 — Local Project Path Registry and Repair Helpers

- Status: applied and documented
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/078_sprint61_local_project_path_registry.sql`
- Guide: `docs/local-project-path-governance.md`

### Scope

Admins can record and update the local project path for each user/device/project in SQL, then use governed helpers to plan a move, confirm it, or mark the path as repair-required. A separate local repair script can correct incomplete manual moves on the user's device.

### SQL tables

```text
local_project_path_registry
local_project_path_events
local_project_path_repair_runs
```

### Files added

- `http-generic-api/scripts/local-project-path-helper.mjs` — SQL-backed admin helper for list/upsert/plan-move/confirm-move/repair-required/archive.
- `http-generic-api/scripts/local-project-path-repair.mjs` — device-side local repair script that copies missing files only and never deletes the source path.
- `docs/local-project-path-governance.md` — operating guide.

### Admin aliases

Built-in `admin_control` shell aliases:

```text
local_project_path_helper_dry_run
local_project_path_helper_apply
```

The dry-run alias rejects `--apply` and the apply alias rejects `--dry-run`.

### Runtime behavior

- DB helper defaults to dry-run.
- Apply-mode DB helper writes only to `local_project_path_*` tables.
- Device repair script defaults to dry-run.
- Device repair apply-mode copies missing files only, reports conflicts, and never deletes the source path.
- Local path registry is explicitly not a backup certification.

### Verification

- Tables created live in SQL.
- `admin_control` schema updated to describe local project path aliases.
- Documentation linked from `deployment_parity_checklist.md`.
- Essam `growth-intelligence-os` path registered and validated: `D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS`.
- Essam `local-connector` path registered and validated: `C:\\mad4b-connector`.
- Local connector shell aliases added and tested on the Essam device: `local_disk_list`, `local_dir_list`, and `local_file_search`.
- `local_dir_list` verified the main repo markers including `.git`, `package.json`, `http-generic-api`, and `local-connector`.
- `local_file_search` found the main repo `package.json`.

---

## Patch 13 — Local Project Path Access Policy

- Status: applied and documented
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/079_sprint61_local_project_path_access_policy.sql`

### Scope

Local project paths now carry explicit ownership/access policy fields. Tenant/user access is allowed only for separately registered tenant-owned or user/device-owned paths. Platform admin paths remain admin-only.

### SQL fields added

```text
owner_scope = platform | tenant | user | device
allowed_subject_scope = admin | tenant_admin | user_owner | none
allowed_operations_json = JSON array
```

### Current policy

```text
project_key = growth-intelligence-os
current_path = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
owner_scope = platform
allowed_subject_scope = admin
```

```text
project_key = local-connector
current_path = C:\\mad4b-connector
owner_scope = device
allowed_subject_scope = user_owner
allowed_operations = health, validate, connector_status, connector_repair, bounded_dir_list, bounded_file_search
```

### Tenant rule

A tenant must not access the platform admin repo path. Tenant access is allowed only when a separate row is registered with:

```text
owner_scope = tenant
allowed_subject_scope = tenant_admin
tenant_id = <tenant id>
```

### Files changed

- `http-generic-api/migrations/079_sprint61_local_project_path_access_policy.sql`
- `http-generic-api/scripts/local-project-path-helper.mjs`
- `docs/local-project-path-governance.md`

---

## Patch 14 — Backup & Copy Governance Registry

- Status: governance-only applied; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/080_sprint61_backup_copy_governance.sql`
- Alias schema migration: `http-generic-api/migrations/081_sprint61_backup_governance_alias_schema.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Created the governance layer for copy locations, backup policies, backup run records, and restore tests. This patch records authority and policy metadata only. It does not dump a database, copy files, upload artifacts, or schedule a backup.

### SQL tables

```text
platform_copy_locations
platform_backup_policies
platform_backup_runs
platform_restore_tests
```

### Seeded copy locations

```text
repo:main:growth-intelligence-os
hostinger:auth.mad4b.com:runtime
local:Essam:growth-intelligence-os
local:Essam:local-connector
```

### Helper aliases

Built-in `admin_control` shell aliases:

```text
backup_copy_governance_helper_dry_run
backup_copy_governance_helper_apply
```

These aliases are record-only governance helpers. They do not perform backup execution. The dry-run alias rejects `--apply`, and the apply alias rejects `--dry-run`.

### Backup boundary

No apply-mode backup may run until an approved policy exists with source, destination, retention, encryption, checksum, approval, and restore-test requirements.

---

## Patch 15 — Backup Policy Draft Templates

- Status: draft metadata applied; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/082_sprint61_backup_policy_templates.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added logical database and pending encrypted destination copy locations, plus draft backup policies for the primary database and main code branch. Also recorded dry-run governance rows. This patch does not dump a database, copy files, upload artifacts, or schedule a backup.

### Copy locations added

```text
database:mysql:auth-runtime-primary
object-storage:pending:encrypted-backups
```

### Draft policies added

```text
policy:platform-db-primary:manual-draft
backup_kind = database
status = draft
allowed_executor = none
encryption_required = true
checksum_required = true
approval_required = true
restore_test_required = true
```

```text
policy:platform-code-main:snapshot-draft
backup_kind = code
status = draft
allowed_executor = github_actions
checksum_required = true
approval_required = true
restore_test_required = true
```

### Dry-run records

```text
policy:platform-db-primary:manual-draft -> dry_run/planned
policy:platform-code-main:snapshot-draft -> dry_run/planned
```

### Execution boundary

The database policy is intentionally blocked with `allowed_executor=none` until an encrypted destination, approval flow, and restore-test target are selected.

---

## Patch 16 — Backup Approval and Restore-Test Gates

- Status: governance-only applied; no backup or restore executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/083_sprint61_backup_approval_restore_gates.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added explicit approval tracking and planned restore-test rows for the current draft backup policies. This patch does not approve, execute, or restore any backup.

### SQL table added

```text
platform_backup_approvals
```

### Planned restore tests added

```text
policy:platform-db-primary:manual-draft -> pending://isolated-restore-db-target
policy:platform-code-main:snapshot-draft -> pending://clean-checkout-or-release-restore-target
```

### Approval requests added

```text
policy:platform-db-primary:manual-draft -> policy_activation/requested
policy:platform-code-main:snapshot-draft -> policy_activation/requested
```

### Helper actions added

```text
list-approvals
list-restore-tests
```

### Execution boundary

Requested approval is not approval. Both policies remain `draft`; no apply-mode backup may run until destination, approval, checksum, retention, and restore-test target are finalized.

---

## Patch 17 — Essam Local Backup Destination

- Status: destination registered; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/084_sprint61_local_backup_destination.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Registered the admin-selected local backup destination on the Essam device and linked existing draft policies to it. This patch does not dump a database, copy files, upload artifacts, approve a policy, or execute a restore test.

### Destination

```text
location_key = local:Essam:growth-os-backups
path = D:\\Nagy\\Growth-0s-Backups
owner_scope = platform
risk_level = critical
status = active
```

### Policy updates

```text
policy:platform-db-primary:manual-draft -> destination local:Essam:growth-os-backups
policy:platform-code-main:snapshot-draft -> destination local:Essam:growth-os-backups
```

### Restore-test target plans

```text
policy:platform-db-primary:manual-draft -> D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated
policy:platform-code-main:snapshot-draft -> D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout
```

### Execution boundary

The policies remain `draft`. The DB policy remains blocked with `allowed_executor=none`; encrypted artifact format, checksum implementation, and explicit approval are still required before any apply-mode backup.

---

## Patch 18 — Backup Preflight, Manifest, Checksum, and Encryption Contract

- Status: preflight contract applied; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/085_sprint61_backup_preflight_manifest_contract.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added explicit artifact contract fields, run preflight metadata, and a manifest table. This patch does not dump databases, copy files, encrypt artifacts, upload artifacts, or execute restore tests.

### SQL changes

Policy/run fields added:

```text
artifact_format
encryption_scheme
checksum_algorithm
manifest_schema_version
preflight_required
preflight_status
preflight_json
```

Table added:

```text
platform_backup_artifact_manifests
```

### Current contracts

```text
policy:platform-db-primary:manual-draft
artifact_format = sql_dump
encryption_scheme = platform_managed
checksum_algorithm = sha256
preflight_status = blocked
blockers = policy_not_active, approval_not_granted, executor_not_enabled
```

```text
policy:platform-code-main:snapshot-draft
artifact_format = zip
encryption_scheme = zip_aes256
checksum_algorithm = sha256
preflight_status = blocked
blockers = policy_not_active, approval_not_granted
```

### Helper action added

```text
preflight-policy
```

### Execution boundary

Preflight is a gate only. A blocked preflight must prevent apply-mode execution. No backup artifact exists until an approved executor writes one, records a manifest, verifies checksum, and passes restore-test requirements.

---

## Patch 19 — Backup Approval Workflow Contract

- Status: approval workflow applied; no policy approved or activated; no backup executed
- Date: 2026-05-17
- Migration: `http-generic-api/migrations/086_sprint61_backup_approval_workflow_contract.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added approval decision metadata, activation gate metadata, and helper actions for deciding approvals and activating policies only after gates pass. This patch does not approve any policy, activate any policy, dump databases, copy files, create artifacts, or run restore tests.

### SQL changes

Fields added to `platform_backup_approvals`:

```text
decision_token
decision_source
policy_snapshot_json
```

Fields added to `platform_backup_policies`:

```text
activation_gate_status
activation_gate_json
```

### Helper actions added

```text
decide-approval
evaluate-activation-gate
activate-policy
```

### Guardrails

```text
approval requires --decision-token=APPROVE:<policy_key>
activation requires --activation-token=ACTIVATE:<policy_key>
activation requires activation_gate_status=ready
```

### Current state

Both draft policies remain blocked and unapproved. No backup artifact exists.

---

## Patch 20 — Backup Executor Guard

- Status: executor guard added; no backup executed
- Date: 2026-05-17
- Script: `http-generic-api/scripts/backup-executor-guard.mjs`
- Alias schema migration: `http-generic-api/migrations/087_sprint61_backup_executor_guard_alias_schema.sql`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Added a guarded executor skeleton that evaluates execution gates, generates artifact/manifest plans, and can record metadata-only run records. It does not create backup artifacts, dump databases, copy files, encrypt artifacts, or run restore tests.

### Admin aliases

```text
backup_executor_guard_dry_run
backup_executor_guard_apply
```

### Actions

```text
plan-run
prepare-run-record
execute
```

### Execution behavior

- `plan-run` returns planned artifact and manifest refs only.
- `prepare-run-record` can record metadata only.
- `execute` returns `backup_execution_blocked` while governance blockers exist.
- Apply-mode artifact creation is intentionally not implemented in the guard.

### Current blockers

```text
policy:platform-db-primary:manual-draft -> policy_not_active, activation_gate_not_ready, preflight_not_promoted_to_active, approval_not_granted, executor_not_enabled, database_executor_must_be_local_connector_or_explicitly_changed
policy:platform-code-main:snapshot-draft -> policy_not_active, activation_gate_not_ready, preflight_not_promoted_to_active, approval_not_granted
```

### Boundary

A reviewed executor implementation must be added separately before any artifact can be created.

---

## Patch 21 — Local Backup Destination Layout

- Status: destination folders prepared; no backup artifact created
- Date: 2026-05-17
- Script: `http-generic-api/scripts/local-backup-destination-prepare.mjs`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Prepared the selected local destination on the Essam device with governance folders and a destination marker file. This patch does not dump databases, copy source files, create backup artifacts, encrypt artifacts, approve policies, or run restore tests.

### Local destination layout

```text
D:\\Nagy\\Growth-0s-Backups\\artifacts
D:\\Nagy\\Growth-0s-Backups\\manifests
D:\\Nagy\\Growth-0s-Backups\\restore-tests
D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated
D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout
D:\\Nagy\\Growth-0s-Backups\\logs
D:\\Nagy\\Growth-0s-Backups\\.growth-os-backup-destination.json
```

### DB update

`platform_copy_locations.validation_json` for `local:Essam:growth-os-backups` now records:

```text
prepared_layout = true
no_backup_artifact_created = true
required_subdirectories = artifacts, manifests, restore-tests, restore-tests/db-isolated, restore-tests/code-clean-checkout, logs
```

### Boundary

The marker file certifies the folder as a governed destination only. It is not a backup artifact.

---

## Patch 22 — First Actual Code Backup Run

- Status: code backup executed and verified
- Date: 2026-05-17
- Runbook: `docs/backup-run-2026-05-17-code-main.md`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Executed the first actual code backup from the Essam local repo path into the governed local backup destination. This patch created a code ZIP artifact, manifest JSON, and restore-test extraction. No database dump was created.

### Backup artifact

```text
policy = policy:platform-code-main:snapshot-draft
run_id = fa521736-5217-11f1-b256-614c56cd019b
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.zip
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.manifest.json
checksum_sha256 = 6c99cf7dccdbc8a2f78c9d2971c7056cadebe19a02f2f87e3ed32d0559bd110f
size_bytes = 1907954
file_count = 555
```

### Source

```text
source_path = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
source_branch = main
source_commit = 85ea6e4f7894e72e5c35558ceaac13d3f2476932
```

### Restore test

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout\\growth-os-code-main-85ea6e4f7894-20260517T174320Z
restore_status = passed
validated markers = package.json, http-generic-api, local-connector
```

### DB records

Recorded in:

```text
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

### Exclusions

```text
No DB dump
No untracked local files
No plaintext .env
No provider credentials
No OAuth refresh tokens
No service account JSON
```

### Remaining blocked scope

The DB backup policy remains blocked until a reviewed DB executor is implemented with encryption, checksum, manifest, and restore-test flow.

---

## Patch 23 — First Actual Database Backup Run

- Status: encrypted DB backup executed and verified
- Date: 2026-05-17
- Runbook: `docs/backup-run-2026-05-17-db-primary.md`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Executed the first actual encrypted database backup from the runtime MySQL database into the governed Essam local backup destination. The durable artifact is encrypted with AES-256-GCM and compressed with gzip. A structural restore validation was performed locally, and the plaintext restore-check SQL was removed afterward.

### Backup artifact

```text
policy = policy:platform-db-primary:manual-draft
run_id = 32658583-521c-11f1-b256-614c56cd019b
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-db-primary-2026-05-17T18-10-17-164Z.sql.gz.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-db-primary-2026-05-17T18-10-17-164Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-db-primary-2026-05-17T18-10-17-164Z.recovery-key.json
checksum_sha256 = e7ac7a51a4d74d55e31954d55edf659c05ddadbacf73a0f66ea48f902f2f4756
size_bytes = 4633945
```

### Source

```text
database = u338416126_growthOS
table_count = 155
row_count = 39515
```

### Restore validation

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated\\growth-os-db-primary-2026-05-17T18-10-17-164Z
restore_status = passed
create_table_count = 155
insert_statement_count = 39561
sql_size_bytes = 63802376
plaintext_restore_sql_removed = true
```

### DB records

Recorded in:

```text
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

### Security notes

```text
DB credentials were not written to the artifact manifest or runbook.
The recovery key file is required to decrypt the artifact.
The plaintext SQL restore-check file was removed after validation.
```

---

## Patch 24 — First Actual Local n8n Backup Run

- Status: encrypted n8n local backup executed and verified
- Date: 2026-05-17
- Runbook: `docs/backup-run-2026-05-17-n8n-local.md`
- Guide: `docs/backup-and-copy-governance.md`

### Scope

Executed the first actual encrypted backup for the local n8n user data path on the Essam device. The artifact includes `D:\\n8n-data`, including `.n8n/database.sqlite`, `.n8n/database.sqlite-wal`, `.n8n/config`, nodes, storage, and related files. The durable artifact is encrypted with AES-256-GCM. A decrypt + ZIP structure validation was performed, and plaintext validation ZIP was removed afterward.

### Backup artifact

```text
policy = policy:local-n8n-data:manual
run_id = 928af7d1-521e-11f1-b256-614c56cd019b
source = D:\\n8n-data
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.zip.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.recovery-key.json
checksum_sha256 = cc3b4819a6c984d51a121446779d8110bedf15f43321deda9785676c5387fbb7
artifact_size_bytes = 13098316
source_size_bytes = 59087745
file_count = 851
```

### Restore validation

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\n8n-local\\growth-os-n8n-local-2026-05-17T18-25-41-880Z
restore_status = passed
has_n8n_root = true
has_database_sqlite = true
has_config = true
has_nodes_dir = true
plaintext_validation_zip_removed = true
```

### DB records

Recorded in:

```text
platform_copy_locations
platform_backup_policies
platform_backup_approvals
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

### Security notes

```text
n8n local data is sensitive because it can contain encrypted credentials and encryption metadata.
The recovery key file is required to decrypt the artifact.
No plaintext ZIP remains after validation.
```

---

## Patch 25 — Backup and DR Baseline Finalization

- Status: finalized local DR baseline
- Date: 2026-05-17
- Finalization report: `docs/backup-finalization-2026-05-17.md`
- DR runbook: `docs/platform-disaster-recovery-runbook.md`

### Scope

Closed the remaining backup/DR baseline items after the first successful code, database, n8n, and local connector backups.

### Completed

```text
Recovery key ACL hardening applied
Local connector runtime backup executed and verified
Runtime/platform manifest created
DNS/Cloudflare blocker manifest created
Retention policy manifest created
Automation plan manifest created, not enabled
Off-device transfer plan manifest created, pending destination
Temporary DB export cleanup helper added and executed
Temporary server-side DB export directories removed
Platform disaster recovery runbook added
```

### Additional backup artifact

```text
policy = policy:local-connector-runtime:manual
source = C:\\mad4b-connector
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-local-connector-2026-05-17T18-48-34-422Z.zip.aes256gcm
checksum_sha256 = 1d3a0a41c77686ff77be358ea6097d1f44a6fb120a557633aa660e7c877747f2
restore_status = passed
```

### Local manifests created

```text
D:\\Nagy\\Growth-0s-Backups\\manifests\\runtime-manifest-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\dns-cloudflare-manifest-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\backup-retention-policy-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\backup-automation-plan-2026-05-17.json
D:\\Nagy\\Growth-0s-Backups\\manifests\\off-device-transfer-plan-2026-05-17.json
```

### Remaining external blockers

```text
Off-device destination still pending
Recovery-key escrow still pending
Cloudflare/DNS export requires authenticated Cloudflare surface
Full isolated DB import and isolated n8n boot test are recommended for full DR certification
Automation intentionally disabled until off-device/key escrow are finalized
```

---

## Patch 26 — Tenant WordPress Validation Collation Repair and Documentation Alignment

- Status: applied, codified, documented
- Date: 2026-06-06
- Production DB repair: applied narrowly to `user_app_connections.connection_id` and `user_app_connections.app_key`
- Runtime code PRs: #684, #690
- Schema codification PR: #699
- Documentation PR: #702
- Incident runbook: `docs/tenant-wordpress-validation-collation-repair-2026-06-06.md`

### Scope

A tenant WordPress CMS connection was `status: active` but remained `validation_status: pending_validation` because the credential-intake status route was blocked by a platform mixed-collation join error. This was a platform validation-path issue, not proof of bad tenant WordPress credentials.

### Confirmed failing joins before repair

```text
user_app_connections.connection_id -> credential_intake_sessions.connection_id
workspace_app_links.connection_id -> user_app_connections.connection_id
app_integrations.app_key -> user_app_connections.app_key
platform_plugin_smoke_certifications.connection_id -> user_app_connections.connection_id
```

The failure class was `ER_CANT_AGGREGATE_2COLLATIONS`.

### Production repair

```sql
ALTER TABLE user_app_connections
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
```

No encrypted credential payload, token, JSON, secret, or user-entered credential field was modified.

### Codified files

```text
http-generic-api/migrations/208_sprint67_user_app_connection_runtime_collation_repair.sql
http-generic-api/test-runtime-collation-safe-joins.mjs
http-generic-api/test-db-collation-guard.mjs
http-generic-api/routes/tenantLifecycleRoutes.js
http-generic-api/appConnectionResolver.js
http-generic-api/platformPluginSmokeRecertification.js
```

### Documentation updates

```text
docs/tenant-wordpress-validation-collation-repair-2026-06-06.md
docs/tenant-gpt-operating-guide.md
GPT_Tenant_Connector_Knowledge.md
deployment_parity_checklist.md
docs/hostinger-node-deploy.md
```

### Verification

```text
previously failing raw joins now execute
credential-intake status reads back the WordPress connection row
release_readiness passed 66/66 after repair
PR #699 CI green and merged
PR #702 CI green and merged
```

### Remaining operational note

Hostinger/LiteSpeed may continue serving an older `SERVICE_VERSION` until process reload. The DB hotfix cleared the live validation blocker immediately; merged code fixes become active after the next production process restart/redeploy.

## Patch 27 - Support Ticket External Delivery Completion Certification

### Scope

Documents and aligns PR #1270 / migration `906_sprint68_ticket_external_delivery_completion_certification.sql`. The patch closes the Support Ticket External Delivery AM-1..AM-16 certification surface while keeping live provider dispatch gated.

### Runtime/API surface

- Route: `POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification`.
- Tool: `support_ticket_external_delivery_completion_certify`.
- OpenAPI: `http-generic-api/openapi.yaml` documents request, responses, auth, no-send flags, and error envelopes.

### Safety boundary

- No SMTP or nodemailer implementation.
- No webhook/fetch/axios external network call.
- `sandbox` returns no-network mock provider evidence.
- `live_send` remains disabled by default and blocked behind tenant enablement, approval, credential readiness, idempotency, and release readiness gates.
- Responses must include `external_send_performed: false` and `secrets_included: false`.

### Verification

- CI passed on PR #1270 and on `main` after merge.
- Guarded migration apply recorded `906_sprint68_ticket_external_delivery_completion_certification.sql` with 8 statements, preflight pass, zero risk, zero destructive statements, and no secrets.
- This documentation alignment patch updates OpenAPI and the required documentation targets after Docs Agent identified missing contract docs.

