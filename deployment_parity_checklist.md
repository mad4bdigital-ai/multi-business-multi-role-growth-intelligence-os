# Deployment Parity Checklist
**Authority document - run before and after every deployment**

> Session Insight capability-envelope chain parity note: before promotion, verify migrations `277` through `283` are applied or already present, tool registry keys from `session_insight_capability_envelope_dispatch_dry_run_review_decide` through `session_insight_remaining_scope_completion_list` are enabled with the expected HTTP paths, and `execution_policies` contains the corresponding blocking policies. Smoke target: the targeted tests for dispatch dry-run review, actual request preflight/request, approval, dispatch readback, adapter execution gate, and remaining scope completion pass. Runtime smoke must use fixture/no-write data only and confirm `adapter_apply_requested=false`, `adapter_apply_executed=false`, `execution_allowed=false`, `target_write_allowed=false`, `target_write_executed=false`, `promotion_allowed=false`, `raw_transcript_included=false`, and `secrets_included=false`. See `docs/session-insight-capability-envelope-release-readiness.md`.

> Ads Provider Governance snapshot record gate parity note: after migration `264_sprint68_ads_governance_snapshot_record_gate.sql`, verify admin tool `ads_provider_governance_snapshot_record` is enabled and `/platform/orchestration/ads-provider/snapshot-record` defaults to `mode=record_dry_run` unless `apply=true`. Apply-mode must recompute the proposal, verify `candidate_sha256`, require `idempotency_key` and a ready `capability_envelope_id`, and then insert/update only `platform_orchestration_state_snapshots` and `platform_orchestration_recommendations`. Smoke target: `node test-ads-governance-snapshot-record-gate.mjs` passes and release readiness tracks migration 264 plus `ads_provider_governance_snapshot_record_gate_policy_v1`. No provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secrets.

> Ads Provider Governance snapshot proposal parity note: after migration `263_sprint68_ads_governance_snapshot_proposal.sql`, verify admin tool `ads_provider_governance_snapshot_propose` is enabled and `/platform/orchestration/ads-provider/snapshot-propose` returns `mode=proposal_only`, `writes_database=false`, `snapshot_candidate`, `recommendation_candidate`, and all execution booleans false. Smoke target: `node test-ads-governance-snapshot-proposal.mjs` passes and release readiness tracks migration 263 plus `ads_provider_governance_snapshot_proposal_policy_v1`. The proposal must not insert snapshot/recommendation rows yet and must not perform provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secrets.

> Orchestration readback surface parity note: after migration `262_sprint68_orchestration_readback_surface.sql`, verify views `v_platform_orchestration_graph_readiness` and `v_platform_orchestration_ads_governance_readiness` exist, admin tool `platform_orchestration_readback` is enabled, and `/platform/orchestration/readback` returns `readback_mode=orchestration_graph_readonly`, `recommendation_only=true`, and all execution booleans false. Smoke target: `node test-orchestration-readback-surface.mjs` passes and release readiness tracks migration 262 plus `orchestration_intelligence_readback_policy_v1`. No provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secrets.

> Orchestration Intelligence foundation parity note: after migration `261_sprint68_orchestration_intelligence_foundation.sql`, verify the five `platform_orchestration_*` tables exist, `orchestration_intelligence_engine` is active, `orchestration_intelligence_policy_v1` has at least six active rules, and `ads_provider_governance_orchestrator` has seven stages plus six edges. Smoke target: `node test-orchestration-intelligence-foundation.mjs` passes and release readiness tracks migration 261 plus `orchestration_intelligence_foundation_policy_v1`. This layer is read-only/diagnose-only; it must not enable provider calls, credential payload reads, spend changes, external writes, deploys, publishing, or secrets.

> Platform Development Constitution parity note: after migration `260_sprint68_platform_development_constitution_policies.sql`, verify all 20 constitution/orchestration policies exist in `execution_policies` with `active='TRUE'`, `blocking='TRUE'`, and `JSON_VALID(policy_value)=1`. `releaseReadiness.js` must require these policy rows through `REQUIRED_RUNTIME_POLICY_SEEDS`, including execution-scope and affects-layer token checks. Smoke target: `node test-platform-development-constitution-policies.mjs` passes and release readiness reports no missing runtime policy seed for the new policy keys. No provider calls, no credential reads, no deploy, and `secrets_included=false`.

> Ads provider preflight surface blueprint parity note: verify `ads_provider_preflight_surface_blueprint_policy_v1`, table `ads_provider_preflight_surface_blueprint_registry`, and tool `ads_provider_preflight_surface_blueprint` after migration `254_sprint67_ads_provider_preflight_surface_blueprint.sql`. Smoke should return `ready_existing_preflight_surface_blueprint` for `google_ads` and `ready_proposed_preflight_surface_blueprint` for a draft test provider, with no surface creation, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Ads provider preflight contract parity note: verify `ads_provider_preflight_contract_policy_v1`, table `ads_provider_preflight_contract_registry`, and validator `ads_provider_preflight_contract_validate` after migration `253_sprint67_ads_provider_preflight_contract.sql`. Smoke should return `ready_existing_preflight_surface_contract` for `google_ads` and `ready_for_preflight_surface_design` for a draft test provider, with `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Ads provider profile onboarding parity note: verify `ads_provider_profile_onboarding_flow_policy_v1`, table `ads_provider_profile_onboarding_requests`, and tools `ads_provider_profile_request`, `ads_provider_profile_approve`, `ads_provider_profile_disable` after migration `252_sprint67_ads_provider_profile_onboarding_flow.sql`. Smoke should request a test provider, approve it into `draft`, then disable it, with `execution_enabled_default=false`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Ads provider profile registry parity note: verify `ads_provider_capability_profile_registry_policy_v1`, table `ads_provider_capability_profile_registry`, and lookup tool `ads_provider_profile_lookup` after migration `251_sprint67_ads_provider_capability_profile_registry.sql`. Smoke should return active `google_ads` profile with `execution_enabled_default=false`, preflight/readiness ledger pointers, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Google Ads credential readiness ledger parity note: verify `google_ads_credential_readiness_ledger_policy_v1`, table `google_ads_credential_readiness_ledger`, and `google_ads_credential_readiness_gate` ledger writes after migration `250_sprint67_google_ads_credential_readiness_ledger.sql`. Smoke without a Google Ads connection should return `credential_readiness_recorded=true`, `credential_readiness_id`, `readiness_sha256`, `blocked_google_ads_connection_missing`, `no_credential_payload_read=true`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Execution enablement approval flow parity note: verify `execution_enablement_approval_flow_policy_v1`, table `execution_enablement_requests`, and tools `execution_enablement_request`, `execution_enablement_approve`, and `execution_enablement_revoke` after migration `249_sprint67_execution_enablement_approval_flow.sql`. Smoke should create a pending request and approval hold without provider calls, credentials, spend change, or secrets.

> Execution enablement approval flow parity note: verify `execution_enablement_approval_flow_policy_v1`, table `execution_enablement_requests`, and tools `execution_enablement_request`, `execution_enablement_approve`, and `execution_enablement_revoke` after migration `249_sprint67_execution_enablement_approval_flow.sql`. Smoke should create a pending request and approval hold without provider calls, credentials, spend change, or secrets.

> Execution enablement registry parity note: verify `execution_enablement_registry_policy_v1`, table `execution_enablement_registry`, tool `execution_enablement_gate`, and Google Ads skeleton binding after migration `248_sprint67_execution_enablement_registry.sql`. Smoke should return `blocked_execution_enablement_missing_or_disabled`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Google Ads credential readiness parity note: verify `google_ads_credential_readiness_gate_policy_v1` and enabled tool `google_ads_credential_readiness_gate` after migration `246_sprint67_google_ads_credential_readiness_gate.sql`. Smoke without a Google Ads connection should block with `blocked_google_ads_connection_missing` and keep `no_credential_payload_read=true`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Google Ads execution adapter skeleton parity note: verify `google_ads_budget_execution_adapter_skeleton_policy_v1`, `google_ads_budget_execution_gate_audit`, and disabled admin endpoint `google_ads_budget_change_execution_adapter` after migration `245_sprint67_google_ads_execution_adapter_skeleton.sql`. Smoke should validate a ready preflight, write audit, then return `blocked_google_ads_execution_adapter_not_implemented` with `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Preflight execution gate helper parity note: verify `preflight_execution_gate_helper_policy_v1` and helper `preflightLedgerExecutionGate.js` after migration `243_sprint67_preflight_execution_gate_helper.sql`. Future execution adapters must call `requireValidatedPreflightForExecution` before mutation; smoke should validate a ready preflight row and return `execution_gate=preflight_ledger_validated`, `hash_verified=true`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Preflight ledger validator parity note: verify `preflight_ledger_validator_policy_v1`, table `preflight_ledger_validator_registry`, and tool `preflight_ledger_validate` after migration `242_sprint67_preflight_ledger_validator.sql`. Smoke should validate a ready Google Ads preflight row with `hash_verified=true`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Google Ads preflight ledger parity note: verify `google_ads_budget_preflight_ledger_policy_v1`, table `google_ads_budget_preflight_ledger`, and `google_ads_budget_change_preflight` ledger writes after migration `241_sprint67_google_ads_budget_preflight_ledger.sql`. Smoke should return `preflight_recorded=true`, `preflight_id`, `preflight_sha256`, `no_provider_call=true`, `no_spend_change=true`, and `secrets_included=false`.

> Google Ads budget preflight parity note: verify `google_ads_budget_change_preflight_policy_v1` and tool `google_ads_budget_change_preflight` read back active after migration `238_sprint67_google_ads_budget_change_preflight.sql`. The preflight must require a ready Google Ads capability envelope plus budget/quota authority and must not read credentials, call Google Ads, or mutate spend.

> Budget/quota authority parity note: verify `budget_quota_authority_registry_policy_v1`, table `budget_quota_authority_registry`, and tool `budget_quota_authority_dry_run` read back active after migration `236_sprint67_budget_quota_authority_registry.sql`. The dry-run must not call providers or connectors, and `secrets_included=false`.

> Repo patch mutation parity note: verify `repo_patch_apply` requires `capability_envelope_id`, resolves `capability_resolution_envelope_ledger`, and gates GitHub App token resolution before content mutation. `repo_inspect` remains read-only and ungated. Migration `234_sprint67_repo_patch_capability_envelope_requirement.sql` is policy/runtime-config only and must read back with `secrets_included=false`.

This checklist distinguishes four verification layers that must all pass before a deployment is considered aligned. File-level changes alone do not constitute deployment verification.

---

## Layer 1 - File merged (CI gate)

These pass automatically in CI on every push/PR. After every push, do not rely on screenshots or commit status assumptions; read GitHub workflow runs, jobs, and logs through the governed GitHub Actions tools until the target run is `completed` with `conclusion=success`. If a job fails, classify it, repair it, push again, and repeat verification until all required jobs are green.

After any database restore, SQL replay, or session archive repair, verify the active GPT archive pointer before continuing platform work:

```sql
SELECT session_id, started_at, drive_folder_id, drive_doc_id, drive_jsonl_id
FROM customer_sessions
WHERE originator='gpt_action'
  AND tenant_id='00000000-0000-0000-0000-000000000000'
  AND user_id IS NULL
  AND session_status NOT IN ('completed','closed')
ORDER BY started_at DESC
LIMIT 1;
```

The selected row must match the intended Drive session folder. Then confirm the Drive `Tool_Calls.jsonl` and `Session Transcript` modified times advance after a tool call. See `docs/session-archive-relink-2026-05-17.md` for the recovery pattern and use `http-generic-api/session-archive-relink-repair.mjs --dry-run`, or governed `admin_control` alias `session_archive_relink_repair_dry_run`, before any apply-mode relink. Apply mode must use the separate alias `session_archive_relink_repair_apply`.

Every repo or SQL change must also update the relevant Markdown ledger/runbook/checklist before the work is considered complete. See `docs/change-documentation-governance.md`.

For shared reconciliation or continuation changes, verify the exact resume contract before promotion: checkpoint creation, no-secret payload redaction, actor/resource scope enforcement, resource fingerprint comparison, drift classification, dry-run repair, verification gate, apply gate, audit requirement, and original-operation resume. Tenant and user actors must remain blocked from platform/repository reconciliation scope. See `http-generic-api/docs/shared-reconciliation-continuation-runbook.md`.

For Hostinger deployment/runtime changes, verify file sync and process reload separately. Governed deploy responses must include parsed deploy output, reload verification, and a no-secret `deploy_reload_pending` continuation checkpoint until `/health` confirms the expected running version/commit. Do not mark the runtime live-ready from filesystem checkout alone.

For chunked governed tool responses, verify `response_chunked=true` or `page.has_more=true` is handled by `response_chunk_read` before any local slice, secondary search, connector read, or external fallback. The response should expose `continuation.next_call` and `continuation.required_before_fallback=true` until the chunk stream is exhausted.

For local connector recovery changes, verify HTTP 530/1033 recovery does not stop at `no_tunnel_token`. If self-repair lacks DB `cf_token` and `CLOUDFLARE_TUNNEL_TOKEN`, it must return a 409 `connector_tunnel_provisioning_required` handoff with no-secret continuation evidence, and recovery must not be claimed until tunnel token provisioning and same-cycle connector health validation pass.

For repository branch reconciliation changes, verify `admin_branch_reconcile` diagnoses stale/diverged branches with no-secret continuation evidence. Apply must be limited to non-protected `behind_only` branches, require `FAST_FORWARD_<BRANCH_SLUG>` confirmation, use GitHub ref update with `force:false`, and verify compare state after apply. Diverged/ahead/protected branches must not be force-pushed.

For local device project path changes, use the SQL-backed registry and governed helpers documented in `docs/local-project-path-governance.md`. A local path update is not a backup and must not be treated as one.

- [ ] `npm test` passes from `http-generic-api/` (800+ assertions across 46+ test files: utility, job runner, execution routing, execution response, execution log evidence, logic evidence plumbing, engine evidence derivation, engine evidence integration, connectors, routes, activation bootstrap cache, Google Sheets chunking, sheets range drift, starter authority surfaces, transport governance, activation classification, activation response, governed activation runner, registry alignment validator, logic switching, WordPress, AI resolvers, SQL migration tooling, and data-flow smoke test)
- [ ] `npm run validate` passes from `http-generic-api/` (173+ architecture checks)
- [ ] All `.js` modules pass `node --check`
- [ ] No new imports from removed or renamed modules
- [ ] `wordpress/index.js` barrel exports >= 545 symbols
- [ ] `github.js` exports exactly 14 public symbols
- [ ] `server.js` remains under 6,000 lines
- [ ] `node smoke-test-data-flow.mjs` passes from `http-generic-api/` (all SQL tables readable, route→workflow chain, UNIQUE constraints, row count summary)

---

## Layer 2 - Registry aligned

Verify the live Google Sheets registry reflects intended architecture:

- [ ] `Execution Log Unified` sheet exists and is writable
- [ ] `JSON Asset Registry` sheet exists and is writable
- [ ] `REGISTRY_SPREADSHEET_ID` environment variable points to correct spreadsheet
- [ ] `ACTIVITY_SPREADSHEET_ID` is set if the activity log lives in a separate workbook from `REGISTRY_SPREADSHEET_ID` (defaults to `REGISTRY_SPREADSHEET_ID` if absent)
- [ ] `EXECUTION_LOG_UNIFIED_SPREADSHEET_ID` resolves correctly (derived from `ACTIVITY_SPREADSHEET_ID`; set `ACTIVITY_SPREADSHEET_ID` to override)
- [ ] `JSON_ASSET_REGISTRY_SPREADSHEET_ID` is set if using a separate workbook for JSON assets
- [ ] Policy sheet values align with backend normalization rules (no unsupported custom literals in active policy rows)

---

## Layer 3 - Runtime deployed

Verify the deployed container/process matches the committed code:

- [ ] For dev, `https://dev.mad4b.com/deployment-info` reports the expected GitHub branch and commit before production promotion
- [ ] For production, deployed image was built from the current `main` commit (`git rev-parse HEAD`)
- [ ] `GET /health` returns `200 OK` with `{ ok: true }`
- [ ] `SERVICE_VERSION` in health response matches `package.json` version
- [ ] `GET /health` dependency surface matches the intended topology: `dependencies.redis`, `dependencies.queue`, and `dependencies.worker.enabled`
- [ ] No stale environment variables from a prior deployment remain active
- [ ] Redis/BullMQ connection is live if this instance is expected to accept async work (Google Cloud Memorystore, Upstash, or Hostinger VPS)
- [ ] `QUEUE_WORKER_ENABLED` matches the instance role (`TRUE` for worker-enabled runtime, `FALSE` for API-only runtime without Redis costs)
- [ ] `BACKEND_API_KEY` and `GOOGLE_APPLICATION_CREDENTIALS` (or equivalent) are injected

---

## Layer 4 - Live behavior confirmed

Verify governed execution paths produce expected outcomes against the live runtime:

- [ ] A dry-run site migration payload (`apply: false`) returns `execution_mode: plan_only` with no errors
- [ ] A `github_git_blob_chunk_read` dispatch resolves without `ReferenceError` (auth errors acceptable in staging)
- [ ] A `hostinger_ssh_runtime_read` dispatch resolves without `ReferenceError`
- [ ] A governed connector action (e.g. `github_unified_proxy`) reaches the execution layer without `sameServiceNativeTarget is not defined` or `retryMutationEnabled is not defined` errors
- [ ] A delegated transport action (`http_generic_api` family) resolves transport binding without `transport_required` governance rejection when the endpoint is correctly configured
- [ ] An async job enqueued via `POST /jobs` reaches `queued` or `running` status within 5 seconds when queue connectivity is expected
- [ ] If queue connectivity is unavailable, `POST /jobs` and `POST /site-migrate` return a truthful `503`
- [ ] `GET /jobs/:id` returns a valid job summary for the enqueued job
- [ ] `Execution Log Unified` receives a writeback row for a completed governed execution
- [ ] `JSON Asset Registry` receives an asset row for a CPT schema preflight execution (if triggered)

---

## Drift detection

If any Layer 2-4 check fails after a successful Layer 1 (CI) pass, the failure class is:

| Failure location | Drift class |
|---|---|
| Registry sheet missing/wrong columns | Registry schema drift |
| Wrong spreadsheet ID in env | Configuration drift |
| Deployed image is behind `main` | Deployment lag |
| Health endpoint not responding | Runtime startup failure |
| Health endpoint reports degraded queue/redis unexpectedly | Dependency topology drift |
| `apply=false` returns error | Canonical/runtime logic drift |
| Async enqueue returns `503` unexpectedly | Queue dependency failure |
| Writeback not reaching sheet | Sink connectivity failure |
| `sameServiceNativeTarget is not defined` at runtime | Deployment lag - deploy from `c3c3b15` or later |
| `retryMutationEnabled is not defined` at runtime | Deployment lag - deploy from `46affb6` or later |
| `transport_required` governance rejection on correctly-configured endpoint | Registry data gap - verify `transport_action_key` is set on endpoint row |
| Drive schema/config returns `404 File not found` for shared-drive files | Missing `supportsAllDrives` - deploy from `c3286cf` or later |
| `ER_CANT_AGGREGATE_2COLLATIONS` on tenant connection or plugin runtime joins | Database join-key collation drift - prefer narrow, governed join-key repair or explicit query collation; do not use broad table conversion without migration review |
| Host repo checkout is current but `/health.version` still reports an older `SERVICE_VERSION` | Process reload lag - Hostinger/LiteSpeed Node process has not restarted even though files are updated |

Record any drift in the deployment log and do not mark the deployment complete until all four layers pass. For a DB hotfix that clears a live blocker before process reload, record both the schema readback and the still-pending runtime reload separately.

---

## Version stamp

Each deployment should record:

```
Deployed commit:   <git rev-parse HEAD>
Deployed at:       <ISO timestamp>
Deployed by:       <operator>
Layer 1 (CI):      PASS / FAIL
Layer 2 (registry): PASS / FAIL / SKIP
Layer 3 (runtime):  PASS / FAIL
Layer 4 (live):     PASS / FAIL / SKIP
```

## Support Ticket External Delivery Completion Certification Parity

Use this checklist for PR #1270 and migration `906_sprint68_ticket_external_delivery_completion_certification.sql`.

- File merged: `supportTicketExternalProviderDispatchService.js`, `supportTicketExternalDeliveryCompletionService.js`, route wiring, test manifest, and OpenAPI entry are present on `main`.
- Registry aligned: `support_ticket_external_delivery_completion_certify` exists in `admin_platform_endpoint_tools` and is enabled.
- Policies aligned: completion certification execution policy and target rule are active/blocking.
- Runtime deployed: `POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification` is documented and routes through admin guards.
- Live behavior confirmed: certification responses remain no-send/no-secret; adapters keep dispatch disabled; sandbox is no-network; live_send remains blocked by policy.
- Drift detection: if route exists without OpenAPI or tool registry entry, treat release as documentation/contract drift and block promotion until aligned.
