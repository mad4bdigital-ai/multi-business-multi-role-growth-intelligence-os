# Session Insight Capability Envelope Release Readiness

## Scope

This document records the release-readiness contract for the Session Insight capability-envelope chain delivered across migrations `277` through `283`.

The chain closes the requested scope as governed, reviewable, no-secret, no-target-write layers. It does not grant permission to bypass typed confirmation, approval holds, adapter gates, release readiness, or production migration/deploy controls.

## Governed chain

| Stage | Migration | Primary table/view surface | Tool/API surface | Safety class |
|---|---:|---|---|---|
| Dispatch dry-run review | 277 | `session_insight_capability_envelope_dispatch_dry_run_review_events`; review/readiness views | `/platform/session-insight-promotions/capability-envelope-dispatch-dry-runs/review/decision` | Review-only, no capability resolution, no adapter execution, no target write |
| Actual request preflight | 278 | `session_insight_capability_envelope_actual_request_preflights`; `v_session_insight_actual_preflight_*` | `/platform/session-insight-promotions/capability-envelope-actual-requests/preflights/*` | Preflight-only, no actual envelope, no approval hold, no target write |
| Actual capability envelope request | 279 | `session_insight_capability_envelope_actual_requests` | `/platform/session-insight-promotions/capability-envelope-actual-requests/*` | Ledger request only; typed confirm `REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION`; no approval or target write |
| Approval gate | 280 | `session_insight_capability_envelope_approval_decisions` | `/platform/session-insight-promotions/capability-envelope-approvals/*` | May create approval hold; typed confirm `APPROVE_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION`; no adapter execution or target write |
| Dispatch readback | 281 | `session_insight_capability_envelope_dispatch_readbacks` | `/platform/session-insight-promotions/capability-envelope-dispatch-readbacks/*` | Readback-only; verifies `ready_for_dispatch`; no adapter execution or target write |
| Adapter execution gate | 282 | `session_insight_capability_envelope_adapter_execution_gates` | `/platform/session-insight-promotions/capability-envelope-adapter-execution-gates/*` | Gate-only; typed confirm `OPEN_ADAPTER_EXECUTION_GATE_NO_APPLY`; does not request adapter apply |
| Remaining scope completion | 283 | `session_insight_capability_envelope_remaining_scope_completions` | `/platform/session-insight-promotions/remaining-scope-completions/*` | Completion ledger; typed confirm `COMPLETE_REMAINING_SCOPE_AS_GATED_NO_EXECUTION`; no adapter apply and no target write |

## Required invariants

Every stage must keep these invariants unless a future PR adds a separate production execution policy, rollback plan, and release-readiness evidence:

- `secrets_included=false`.
- No raw transcript content is returned or written to SQL.
- No credential payload is read or emitted.
- Adapter apply is not requested until a separate adapter-apply dispatch layer is implemented.
- Adapter apply is not executed by these routes.
- `execution_allowed`, `target_write_allowed`, `target_write_executed`, and `promotion_allowed` remain false for the no-execution layers.
- Target writes require a future explicit target-write gate, rollback plan, readback validator, release-readiness approval, and production deployment approval.

## Tool registry evidence

Migrations register these admin tool keys through `admin_platform_endpoint_tools`:

- `session_insight_capability_envelope_dispatch_dry_run_review_decide`
- `session_insight_capability_envelope_actual_request_preflight_create`
- `session_insight_capability_envelope_actual_request_preflight_list`
- `session_insight_capability_envelope_actual_request_create`
- `session_insight_capability_envelope_actual_request_list`
- `session_insight_capability_envelope_approval_decide`
- `session_insight_capability_envelope_approval_list`
- `session_insight_capability_envelope_dispatch_readback_create`
- `session_insight_capability_envelope_dispatch_readback_list`
- `session_insight_capability_envelope_adapter_execution_gate_create`
- `session_insight_capability_envelope_adapter_execution_gate_list`
- `session_insight_remaining_scope_completion_create`
- `session_insight_remaining_scope_completion_list`

## Migration and deployment checklist

Before deployment, run only the governed migration runner against the target environment and apply only unapplied migrations. Do not run ad-hoc SQL manually for this chain.

Verification must confirm:

1. Migrations `277` through `283` are applied in order or already present.
2. All policy keys created by the migrations exist in `execution_policies`, are active, and remain blocking where marked.
3. All admin tool keys above are enabled with the expected HTTP paths.
4. The OpenAPI schema includes the route contracts for all create/list/decision surfaces.
5. Targeted tests in `test-manifest.mjs` include the chain-specific tests.
6. Staging smoke calls exercise list endpoints and fixture/no-write create paths only.
7. Production target writes are still blocked until a separate explicit production execution approval is granted.

## Staging smoke sequence

Use fixture or non-production data only:

1. List existing dispatch dry-run review queues/readiness.
2. Exercise approval/rejection decisions on fixture rows only.
3. Run actual request preflight on a fixture approved dispatch dry-run.
4. Request an actual capability envelope only with typed confirm and fixture data.
5. Approve only a fixture actual request.
6. Create dispatch readback and adapter execution gate rows for fixture data.
7. Create remaining scope completion for fixture data.
8. Verify issue views return zero failures and all safety flags are false.

## Internal SQL target-write executor

Migration `284_sprint68_session_insight_backlog_target_write_executor.sql` adds the first actual target-write surface for this chain. It writes only to internal SQL backlog tables:

- `session_insight_backlog_target_items`
- `session_insight_backlog_target_writes`

The execute route is `/platform/session-insight-promotions/backlog-target-writes/execute` and requires typed confirm `EXECUTE_SESSION_INSIGHT_BACKLOG_TARGET_WRITE`. The rollback route is `/platform/session-insight-promotions/backlog-target-writes/rollback` and requires typed confirm `ROLLBACK_SESSION_INSIGHT_BACKLOG_TARGET_WRITE`.

This is a production write-enablement layer for internal SQL backlog targets only. It may set `target_write_allowed=true`, `target_write_executed=true`, and `promotion_allowed=true` inside `session_insight_backlog_target_writes` after the capability-envelope approval/readback/remaining-scope chain is complete. It must keep `provider_call_executed=false`, `credential_payload_read=false`, `external_write_executed=false`, `raw_transcript_included=false`, and `secrets_included=false`.

## Production boundary

The current write-enabled surface is limited to internal SQL backlog targets. External provider writes, credential reads, canonical policy rewrites, deployment changes, and non-SQL targets still require a separate PR with provider-specific rollback/readback, OpenAPI coverage, release-readiness evidence, and explicit operator approval.
