# system_bootstrap.clean-v1

Consolidated reference overlay for the Growth Intelligence Platform runtime contract.

This file is not runtime authority. Many principles were promoted through active canonicals, schemas, migrations, and runtime modules; unresolved items remain follow-ups in `current-state-checkpoint-2026-06-06.md`.

## 1. Runtime authority

- Hostinger MySQL is the runtime source of truth.
- Google Sheets workbooks are async mirrors, diagnostic evidence, and recovery helpers only.
- Drive files are canonical knowledge/document assets when explicitly registered, not implicit runtime authority.
- Activation bootstrap authority resolves from `platform_runtime_config`, then server environment fallback.
- DB-native bootstrap config read is activation bootstrap authority; `activation_sheets_bootstrap_read` is a deprecated compatibility alias and must not call Google Sheets.

## 2. Canonical file model

Root files are generated compatibility indexes:

- `system_bootstrap.md`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

Authoritative markdown bodies live under `canonicals/<family>/`.

Promotion rule: edit source files under `canonicals/`, then run `node build-canonicals.mjs`, then validate with `node validate-canonical-sources.mjs`.

## 3. Activation contract

Activation is active only when the same cycle confirms:

1. session context read succeeds;
2. DB runtime bootstrap config resolves;
3. Drive probe succeeds;
4. DB-native bootstrap config read succeeds;
5. GitHub validation succeeds using registry/bootstrap binding;
6. platform access counts resolve without degraded required surfaces.

Health/status endpoints are diagnostics and never replace activation bootstrap validation.

## 4. Multi-business activity contract

The platform must not default to tourism, travel, destination, or any single historical activity.

- `business_activity_types` is the first activity authority surface.
- Tourism is only one legacy/profiled activity, not the global runtime default.
- Every business/brand/growth request should resolve `business_activity_type_key` before selecting knowledge, engines, workflow variants, or Brand Core expectations.
- If no activity is supplied and no safe inference is possible, the request is classified `validating.activity_unresolved` or asks the caller/router for a scoped activity instead of silently falling back to tourism.
- Activity-specific knowledge profiles must be layered under the resolved activity and business type.

## 5. Tenant, role, service mode, and human oversight contract

Local development documents require the platform to operate as a multi-role, tenant-scoped, commercially gated system.

Required runtime gates before dispatch:

1. `tenant_id` and tenant type resolve from `tenants`.
2. actor role resolves from `role_assignments` or governed auth context.
3. tenant/brand/client/review/supervision scope resolves before execution.
4. service mode resolves as `self_serve`, `assisted`, or `managed`.
5. commercial entitlements resolve for paid, limited, assisted, or managed features.
6. human oversight route resolves when policy, risk, package, or workflow requires review/approval.
7. access gate denies by default when any required scope or entitlement is missing.

Human oversight is not a UI-only feature. It is a runtime layer using assistance roles, review assignments, approval holds, escalation, and supervisor signoff.

## 6. Execution path

All AI-driven execution flows through:

`execution_plan -> connectorExecutor.dispatchPlan -> runAgentLoop -> getAgentDeps -> modelAdapterRouter/modelAdapter -> engineExecutorRegistry -> outputSinkRouter`

No route should call a model directly.

## 7. Governance validation enforcement

The platform has `governanceValidationEngine` and active write/readback integrations. The clean contract still requires coverage to be verified at every governed mutation boundary, not inferred from an import or a partial integration.

Required enforcement points:

| Stage | Enforcement |
|---|---|
| pre-execution | workflow authority, agent skill grants, task route authority, governed context resolution |
| pre-write | target table compatibility, payload schema, duplicate checks, approval holds when applicable |
| post-write | readback confirmation and sink/audit correlation |

Where an enforcement point lacks runtime evidence, the affected feature must be classified as `validating` or `degraded_contract`, not `fully_enforced`.

## 8. Workflow key authority

Current DB contains repeated `workflow_key` values for workflow families. Clean contract:

- `workflow_id` is the unique execution row key.
- `workflow_key` may be a stable group key only when explicitly paired with a unique `workflow_id` or `workflow_variant_key`.
- Any loader using `WHERE workflow_key = ? LIMIT 1` is non-deterministic when duplicates exist and must be repaired.

## 9. Agent and model classes

Canonical execution classes:

- `rule_based`
- `standard`
- `complex`
- `authority`
- `tool_orchestrated`
- `governed`

`tool_orchestrated` and `governed` must be normalized by runtime policy instead of falling through silently to `standard`.

## 10. Output sink authority

Every completed governed execution should produce a canonical row in `output_artifacts`, unless explicitly classified as diagnostic-only.

Additional sink behavior:

- `sink_dispatch_log` is append-only router audit.
- `agent_chain_events` is the event bus for linked workflows.
- sink writes require pre-write validation and post-write readback.
- status enum drift (`ok/failed/skipped` vs `dispatched/completed/failed/skipped`) must be normalized before promotion.

## 11. Local connector governance

All local device operations flow through `/dispatch` using `intent_key` from `task_routes`.

Required invariants:

- `device_id` is required for all `local.*` intents.
- `target_module` must resolve to a registered module executor or return routing advice.
- when `agent_id` is present, missing skill grant returns `403 skill_not_granted`.
- local config resolves from `local_connector_user_configs`; caller-supplied tunnel URLs/secrets are ignored.
- shell/file checks run both on cloud orchestrator and device connector.

## 12. Secret handling

Secrets must not be stored in visible JSON config fields. Runtime config rows must reference secrets using `*_secret_ref` fields.

Known clean-up target: `tenant_gpt.oauth.client` should be migrated from inline `client_secret` to `client_secret_ref`.

## 13. Workbook role

Workbooks in the Production Drive folder are legacy/runtime-mirror evidence. Clean bootstrap must treat them as:

- registry recovery sources;
- human audit surfaces;
- historical row evidence;
- mirror/parity verification targets.

They are not primary runtime read paths.

## 14. Remaining implementation checklist

Before treating every statement in this overlay as fully enforced:

1. Decide and enforce the workflow key uniqueness model.
2. Verify governance validation coverage at every governed write boundary.
3. Normalize any remaining execution-class and sink-status drift.
4. Remove inline secrets from runtime config.
5. Validate Drive/Sheets workbook inventory only for explicit recovery/parity/archive decisions.
6. Run release readiness, schema validation, and live readback.
