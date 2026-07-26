# Stable Error Catalog

All public errors use:

```json
{
  "error": {
    "code": "STABLE_MACHINE_CODE",
    "message": "Human-readable summary.",
    "details": [],
    "requestId": "req_..."
  }
}
```

Internal stack traces, secrets, provider tokens, and unrestricted provider payloads are never returned.

## Authentication and authority

| Code | HTTP | Meaning |
|---|---:|---|
| `AUTHENTICATION_REQUIRED` | 401 | Missing or invalid caller authentication |
| `AUTHENTICATION_ASSURANCE_INSUFFICIENT` | 401 | Operation requires a stronger authentication mode |
| `PRINCIPAL_INACTIVE` | 403 | Principal is suspended or inactive |
| `AUTHORITY_DENIED` | 403 | Effective authority decision is deny |
| `RESOURCE_BINDING_REQUIRED` | 403 | Exact governed resource binding is absent |
| `RESOURCE_OUTSIDE_TENANT_SCOPE` | 403 | Resource is outside caller tenant/workspace |
| `CROSS_TENANT_ACCESS_DENIED` | 403 | Cross-tenant access lacks explicit audited platform authority |
| `CAPABILITY_NOT_GRANTED` | 403 | Required capability is not granted |
| `RUNTIME_CERTIFICATION_REQUIRED` | 403 | Adapter/action certification is missing or expired |
| `CREDENTIAL_SCOPE_MISMATCH` | 403 | Credential owner/scope cannot serve target resource |
| `APPROVAL_REQUIRED` | 403 | A valid approval hold is required |
| `APPROVAL_HASH_MISMATCH` | 409 | Approval does not match plan/settings/authority/adapter hashes |
| `APPROVAL_EXPIRED` | 409 | Approval validity window has elapsed |
| `READBACK_CONTRACT_REQUIRED` | 403 | High-risk operation has no acceptable readback contract |

## Assets and customization

| Code | HTTP | Meaning |
|---|---:|---|
| `ASSET_NOT_VISIBLE` | 404 | Asset is not visible to caller audience |
| `ASSET_VERSION_NOT_INSTALLABLE` | 409 | Version is draft, retired, blocked, or outside publication window |
| `ASSET_ALREADY_INSTALLED` | 409 | Installation identity already exists |
| `CUSTOMIZATION_MODE_NOT_ALLOWED` | 403 | Publication policy forbids requested mode |
| `OVERRIDE_KEY_UNKNOWN` | 422 | Override key is not declared |
| `OVERRIDE_SCOPE_NOT_ALLOWED` | 422 | Scope cannot set the requested key |
| `OVERRIDE_OUT_OF_BOUNDS` | 422 | Value violates platform/tenant bounds |
| `OVERRIDE_WIDENS_AUTHORITY` | 403 | Override would expand authority |
| `EXTENSION_POINT_NOT_FOUND` | 422 | Named extension point does not exist |
| `EXTENSION_CAPABILITY_INCOMPATIBLE` | 422 | Extension requires unsupported or forbidden capability |
| `FORK_ORIGIN_MISMATCH` | 409 | Fork lineage does not match requested origin |
| `FORK_SECURITY_BASELINE_STALE` | 409 | Fork must adopt a mandatory security baseline |
| `UPGRADE_PREVIEW_STALE` | 409 | Installation or source/target version changed after preview |
| `UPGRADE_BLOCKED` | 422 | Compatibility/policy blockers remain |
| `INSTALLATION_VERSION_CONFLICT` | 409 | Expected installation version is stale |

## Workflow compilation and settings

| Code | HTTP | Meaning |
|---|---:|---|
| `WORKFLOW_GRAPH_CYCLE` | 422 | Unsupported cycle exists in workflow graph |
| `WORKFLOW_STEP_UNREACHABLE` | 422 | Required step cannot be reached |
| `WORKFLOW_JOIN_INVALID` | 422 | Join semantics do not match incoming branches |
| `WORKFLOW_SCHEMA_INCOMPATIBLE` | 422 | Step input/output schemas are incompatible |
| `WORKFLOW_CAPABILITY_UNRESOLVED` | 422 | Required capability cannot be resolved |
| `WORKFLOW_VERSION_IMMUTABLE` | 409 | Published/active version cannot be edited |
| `SETTING_KEY_UNKNOWN` | 422 | Setting definition does not exist |
| `SETTING_PATH_AMBIGUOUS` | 422 | Multiple equal-precedence inheritance paths exist |
| `SETTING_VALUE_INVALID` | 422 | Value fails schema validation |
| `SETTING_CONSTRAINT_CONFLICT` | 422 | Effective constraints are unsatisfiable |
| `SETTINGS_SNAPSHOT_IMMUTABLE` | 409 | Bound run snapshot cannot be changed |
| `ADAPTER_SELECTION_AMBIGUOUS` | 422 | Deterministic adapter winner cannot be chosen |
| `ADAPTER_UNAVAILABLE` | 503 | No certified healthy adapter can satisfy plan |

## Runtime, concurrency, and external effects

| Code | HTTP | Meaning |
|---|---:|---|
| `IDEMPOTENCY_KEY_REUSE` | 409 | Same key was reused with a different request hash |
| `STATE_VERSION_CONFLICT` | 409 | Expected state/version is stale |
| `INVALID_STATE_TRANSITION` | 409 | Transition is not allowed from current state |
| `CLAIM_CONFLICT` | 409 | Another worker owns the active lease |
| `LEASE_EXPIRED` | 409 | Command uses an expired lease |
| `DISPATCH_NOT_READY` | 409 | Run lacks authority/settings/adapter/approval readiness |
| `PROVIDER_RATE_LIMITED` | 429 | Provider rate limit was reached |
| `PROVIDER_REJECTED` | 422 | Provider rejected a validly transported request |
| `PROVIDER_TEMPORARILY_UNAVAILABLE` | 503 | Provider dependency is temporarily unavailable |
| `EXTERNAL_OUTCOME_UNKNOWN` | 409 | Timeout occurred and external effect must be inspected before retry |
| `CALLBACK_SIGNATURE_INVALID` | 401 | Callback signature is invalid |
| `CALLBACK_TOKEN_INVALID` | 401 | Opaque callback token is invalid |
| `CALLBACK_EXPIRED` | 409 | Callback validity window elapsed |
| `CALLBACK_NONCE_REPLAYED` | 409 | Callback nonce was already consumed |
| `CALLBACK_BINDING_MISMATCH` | 409 | Callback does not match run/step/adapter/event |
| `READBACK_PENDING` | 409 | Required verification has not completed |
| `READBACK_MISMATCH` | 409 | Observed state differs from expected effect |
| `COMPENSATION_REQUIRED` | 409 | Failed workflow requires declared compensation |
| `COMPENSATION_PARTIAL` | 409 | Compensation completed only partially |

## Error rules

- Codes are stable; messages may become clearer without changing semantics.
- Validation details identify fields/rules but never disclose another tenant's resource existence.
- A resource outside scope may return `404` instead of `403` to avoid enumeration.
- Provider-native errors are normalized and retained only in redacted internal evidence.
- Retry guidance is explicit in response metadata where safe.
