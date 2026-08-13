# Release Intelligence Contracts

## Canonical entities

### release_operation

Represents one requested release, deploy, restart, rollback, or parity recovery lifecycle.

Required fields:

- `operation_id`
- `scope_type`: `admin` or `tenant`
- `tenant_id`
- `workspace_id`
- `target_id`
- `runtime_family`
- `operation_type`
- `expected_commit_sha`
- `deployed_commit_sha`
- `status`
- `classification`
- `capability_envelope_id`
- `approval_hold_id`
- `latest_verification_run_id`
- `secrets_included=false`
- `created_at`
- `updated_at`

### release_operation_step

Represents each lifecycle transition.

Suggested step keys:

- `detect_drift`
- `resolve_target`
- `resolve_capability_template`
- `dry_run`
- `approval`
- `open_gate`
- `dispatch`
- `restart_wait`
- `readback`
- `verify_parity`
- `close_gate`
- `archive_evidence`

### release_gate_event

Represents gate open/close/hard-disable events.

Required fields:

- `gate_event_id`
- `operation_id`
- `gate_key`
- `action`: `open`, `close`, `expire`, `hard_disable`
- `ttl_minutes`
- `reason`
- `capability_envelope_id`
- `verification_run_id`
- `status`
- `readback_status`

### capability_envelope_template

Resolves envelope creation from operation intent and runtime target context.

Required fields:

- `template_key`
- `operation_type`
- `runtime_family`
- `app_key`
- `capability_key`
- `operation_intent`
- `runtime_surface`
- `source_tier_strategy`
- `tenant_strategy`
- `workspace_strategy`
- `approval_required`
- `readback_required`
- `risk_class`

## Async deploy API contract

### Create operation

`POST /release/operations`

Returns `201 Created` for ledger creation or `202 Accepted` when orchestration starts asynchronously.

### Start deploy

`POST /release/operations/{operationId}/dispatch`

Returns:

```json
{
  "ok": true,
  "operation_id": "relop_...",
  "status": "dispatch_started",
  "classification": "readback_pending",
  "poll": {
    "status_url": "/release/operations/relop_...",
    "recommended_after_ms": 5000
  },
  "secrets_included": false
}
```

### Read operation

`GET /release/operations/{operationId}`

Returns summary-first state, latest step, readback status, and evidence manifest.

## Error classifications

Use structured errors with stable codes:

- `CAPABILITY_ENVELOPE_REQUIRED`
- `CAPABILITY_ENVELOPE_SCOPE_MISMATCH`
- `TARGET_AUTHORITY_MISSING`
- `RUNTIME_GATE_CLOSED`
- `RUNTIME_RESTART_IN_PROGRESS`
- `READBACK_PENDING`
- `DEPLOYED_COMMIT_MISMATCH`
- `GATE_CLEANUP_REQUIRED`
- `TENANT_SCOPE_VIOLATION`
- `SECRET_RESPONSE_BLOCKED`

## 503 handling rule

A 503 during deploy/restart should not be final by default.

It may classify as `restart_in_progress` when:

- dispatch preflight passed
- envelope matched target and expected commit
- restart was requested
- bounded readback is still pending

It must classify as `failed_execution` when:

- preflight failed
- target rejected command
- path allowlist failed
- envelope mismatch occurred
- readback exceeded timeout and degraded evidence was recorded

## Readback contracts

Minimum production readback:

- deployed commit equals expected commit
- runtime health passes
- required routes are installed
- release readiness returns bounded summary
- degraded surfaces are empty or explicitly explained
- temporary gates are closed or expiring with active cleanup step

## Tenant scoping rules

Every TENANT read must filter by tenant, workspace, and target authority. Evidence manifests must be sanitized and must not include cross-tenant operations.
