# TENANT Release Intelligence Spec

## Objective

TENANT workflows allow tenant owners to understand and request safe release operations for their own runtime targets without gaining platform-wide authority or access to provider secrets.

TENANT mode is advisory-first. Execution is allowed only when a tenant-owned target has required authority, connection readiness, capability template, and approval policy.

## TENANT visibility

Tenant users may see:

- tenant-owned runtime targets
- tenant release operations
- sanitized release status
- sanitized evidence summaries
- required next actions
- blocked reasons scoped to their tenant

Tenant users must not see:

- other tenants' targets
- platform credential metadata beyond readiness classification
- raw SSH/provider credentials
- platform-wide approval internals
- unredacted execution logs

## TENANT operation flow

```text
tenant target drift or user request detected
  -> tenant release advisor creates advisory plan
  -> target ownership and workspace authority checked
  -> capability template resolved for tenant scope
  -> dry-run plan returned
  -> if execution requires platform managed action, mark approval_required
  -> if tenant can proceed, create tenant-scoped envelope request
  -> dispatch only through approved runtime adapter
  -> readback shown as sanitized status
```

## TENANT action classes

### Allowed read-only

- Get tenant release readiness.
- Get tenant runtime parity summary.
- List tenant release operations.
- View sanitized evidence manifest.
- View required setup gaps.

### Request-only

- Request release operation.
- Request gate open.
- Request rollback.
- Request capability approval.

### Execution-limited

Tenant execution requires all of:

- tenant-owned runtime target
- active workspace authority
- target-scoped capability template
- approved capability envelope
- readback contract
- no-secret policy
- tenant-visible audit event

## TENANT blocked classifications

- `target_not_owned_by_tenant`
- `workspace_authority_missing`
- `runtime_adapter_not_ready`
- `capability_template_missing`
- `approval_required`
- `credential_binding_missing`
- `readback_contract_missing`
- `quota_or_budget_required`
- `platform_admin_required`

## TENANT response contract

Tenant responses should be summary-first:

```json
{
  "ok": true,
  "scope": "tenant",
  "operation_id": "relop_...",
  "classification": "approval_required",
  "target": {
    "target_id": "...",
    "display_name": "Production site",
    "runtime_family": "hostinger_ssh"
  },
  "safe_next_actions": [
    "request_approval",
    "view_readiness_gaps"
  ],
  "blocked_reasons": [],
  "secrets_included": false
}
```

## TENANT acceptance criteria

- Tenant cannot access cross-tenant release evidence.
- Tenant cannot bypass platform approval for critical runtimes.
- Tenant sees actionable setup gaps without secrets.
- Tenant release operations remain linked to workspace and target authority.
