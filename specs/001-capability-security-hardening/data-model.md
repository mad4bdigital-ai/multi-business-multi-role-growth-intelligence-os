# Data Model

## 1. CanonicalCapability

Represents the security identity of an operation.

| Field | Type | Constraints |
|---|---|---|
| `id` | string/UUID | immutable, unique |
| `key` | string | stable machine-readable key |
| `display_name` | string | non-security label |
| `risk_level` | enum | `low`, `medium`, `high`, `critical` |
| `effect` | enum | `read`, `preview`, `create`, `update`, `delete`, `execute`, `admin` |
| `state_changing` | boolean | required |
| `credential_policy_id` | reference/null | explicit |
| `device_policy_id` | reference/null | explicit |
| `approval_policy_id` | reference/null | explicit |
| `smoke_policy_id` | reference/null | explicit |
| `status` | enum | `active`, `disabled`, `deprecated` |
| `policy_version` | string | required |
| `created_at` | timestamp | ISO 8601 |
| `updated_at` | timestamp | ISO 8601 |

**Invariant:** active executable capabilities must have complete security classification.

## 2. CapabilityAlias

Maps a surface selector to one canonical capability.

| Field | Type | Constraints |
|---|---|---|
| `selector_type` | enum | `action_key`, `tool_key`, `intent_key`, `route_key` |
| `selector_value` | string | unique within selector type |
| `canonical_capability_id` | reference | required |
| `surface` | enum | tenant/admin/device/system |
| `surface_restriction_policy_id` | reference/null | may only restrict |
| `status` | enum | active/disabled/deprecated |
| `registry_version` | string | required |

**Invariant:** one active alias maps to exactly one canonical capability.

## 3. CapabilityPolicy

| Field | Type |
|---|---|
| `id` | string/UUID |
| `canonical_capability_id` | reference |
| `allowed_principal_classes` | array enum |
| `allowed_roles` | array string |
| `allowed_surfaces` | array enum |
| `required_skills` | array string |
| `resource_scope_type` | enum/null |
| `mutation_mode` | enum: denied/preview_only/auto_bounded/user_approval/tenant_admin_approval/platform_admin_approval |
| `fail_closed` | boolean |
| `version` | string |
| `effective_from` | timestamp |
| `effective_to` | timestamp/null |

## 4. SecurityDecision

One immutable decision per request attempt.

| Field | Type |
|---|---|
| `decision_id` | UUID |
| `request_id` | string |
| `principal_ref` | non-secret reference |
| `tenant_ref` | non-secret reference/null |
| `workspace_ref` | reference/null |
| `canonical_capability_id` | reference/null |
| `selector_type` | enum/null |
| `selector_value_hash_or_ref` | string/null |
| `surface` | enum/null |
| `target_resource_type` | string/null |
| `target_resource_ref` | string/null |
| `policy_version` | string/null |
| `registry_version` | string |
| `mode` | preview/execute |
| `final_decision` | allow/deny/error |
| `reason_code` | string |
| `dispatch_ready` | boolean |
| `execution_occurred` | boolean |
| `readback_status` | enum/null |
| `created_at` | timestamp |

## 5. GateResult

| Field | Type |
|---|---|
| `decision_id` | reference |
| `gate` | enum |
| `required` | boolean |
| `state` | pass/deny/not_applicable/not_evaluated |
| `reason_code` | string |
| `evidence_ref` | string/null |
| `evaluated_at` | timestamp/null |

**Invariant:** an allowed decision cannot have a required gate other than `pass`.

### Credential policy decision states

Credential handling is represented as three independent dimensions so credential absence cannot alter authorization outcomes:

| Dimension | Values | Meaning |
|---|---|---|
| `requirement` | `required`, `not_required` | Whether the canonical binding requires a credential source |
| `resolution_state` | `not_evaluated`, `not_required`, `resolved`, `missing`, `scope_denied` | Whether an authorized lookup resolved an allowed source |
| `usability_state` | `not_evaluated`, `not_applicable`, `usable`, `unusable` | Whether a resolved credential is active and validated for execution |

**Invariants:**

- `not_required` affects only the credential gate and never grants principal, tenant, surface, skill, target, smoke, or approval permission.
- credential lookup does not occur before principal scope, binding, surface, canonical-policy, and skill gates pass.
- a connection is usable only when its lifecycle state is active and its validation state is one of the explicitly accepted validated states.
- scope denial is decided before reading connection rows.

## 6. DeviceTrustRecord

| Field | Type |
|---|---|
| `device_id` | string |
| `tenant_id` | reference |
| `owner_subject_id` | reference/null |
| `registration_state` | active/disabled/archived/revoked; legacy `is_enabled=0` projects to disabled |
| `connector_identity_ref` | string |
| `connector_auth_state` | unknown/valid/invalid/revoked |
| `last_heartbeat_at` | timestamp/null |
| `health_state` | unknown/online/offline/degraded |
| `agent_version` | string/null |
| `supported_capabilities` | array string |
| `updated_at` | timestamp |

**Derived:** `heartbeat_fresh` is calculated by policy, not stored as permanent truth.

## 7. ApprovalGrant

| Field | Type |
|---|---|
| `approval_id` | UUID |
| `canonical_capability_id` | reference |
| `principal_id` | reference |
| `tenant_id` | reference/null |
| `target_resource_ref` | string/null |
| `device_id` | string/null |
| `request_digest` | string |
| `status` | pending/granted/denied/expired/consumed/revoked |
| `issued_at` | timestamp |
| `expires_at` | timestamp |
| `consumed_at` | timestamp/null |
| `approver_principal_id` | reference/null |

## 8. CredentialIntakeSession

| Field | Type |
|---|---|
| `session_id` | UUID |
| `tenant_id` | reference |
| `subject_id` | reference |
| `integration_key` | string |
| `auth_type` | string/enum |
| `connection_target_ref` | string |
| `purpose` | string/enum |
| `nonce_hash` | string |
| `allowed_redirect_uri` | string/null; same-origin path or exact registered HTTPS URI |
| `binding_digest` | SHA-256; binds subject, tenant, integration, auth type, target, purpose, redirect, and authority snapshot |
| `authority_snapshot_hash` | SHA-256/null; immutable tenant membership and integration-policy snapshot |
| `authority_snapshot_version` | string/null |
| `status` | pending/used/expired/revoked/error |
| `revoked_reason` | stable non-secret reason code/null |
| `created_at` | timestamp |
| `expires_at` | timestamp |
| `consumed_at` | timestamp/null |

**Invariants:**

- no secret values stored in the decision/audit model
- one session can be consumed once
- subject, tenant, integration, auth type, target, purpose, redirect, and authority snapshot cannot change after creation without invalidating `binding_digest`
- redirect URI must be same-origin or selected from the integration registry allowlist
- a changed tenant membership, tenant state, integration policy, source mode, auth type, or app state revokes a bound pending session before connection creation
- legacy sessions without binding or authority hashes remain compatible only until their existing expiry and still retain single-use enforcement

## 9. ActivationReadiness

A response projection, not necessarily a database table.

```json
{
  "workspace": "active",
  "deviceRegistration": "registered",
  "deviceReachability": "not_verified",
  "connectorHealth": "unknown",
  "credentialReadiness": "pending_validation",
  "executionReadiness": "blocked"
}
```

## State transitions

### Intake session

```text
created → consumed
created → expired
created → revoked
```

No transition out of terminal states.

### Approval

```text
pending → granted → consumed
pending → denied
pending/granted → expired
pending/granted → revoked
```

### Device registration

```text
registered → provisioned → archived
registered/provisioned → revoked
```

Health and reachability are current observations and MUST NOT overwrite lifecycle history.
