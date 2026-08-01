# Data Model

## Posture

Reuse existing registries and durable operation/evidence models before proposing new tables. The entities below are logical contracts. Physical table names and migrations are deferred until the field-level reuse matrix is complete.

## Ownership hierarchy

```text
OAuth client / plugin distribution
  └─ MCP resource server
      └─ authenticated platform user
          └─ tenant membership
              └─ workspace access
                  └─ Brand/resource authority
                      └─ tool eligibility
                          └─ invocation or operation
```

No client or plugin object owns tenant data. It receives bounded delegated access through the user and platform policies.

## Logical entities

### 1. MCP client registration

Represents an allowed ChatGPT/Codex OAuth client or client-registration method.

| Field | Type | Notes |
|---|---|---|
| `client_registration_id` | UUID/string | Internal stable ID |
| `client_class` | enum | `chatgpt`, `codex`, `review`, `development`, `other_approved` |
| `client_id_fingerprint` | string | Non-secret fingerprint; raw secret is never stored here |
| `registration_mode` | enum | `cimd`, `dcr`, `predefined` |
| `status` | enum | `pending`, `active`, `disabled`, `revoked` |
| `allowed_resource` | HTTPS URI | Canonical MCP resource identifier |
| `allowed_scopes` | array/reference | Maximum policy-approved scopes |
| `environment` | enum | `development`, `staging`, `production`, `review` |
| `created_at`, `updated_at`, `revoked_at` | timestamp | Lifecycle evidence |

**Reuse candidates**: existing OAuth/application/client registries and activation policy records.  
**New persistence trigger**: no existing entity can bind client class, resource, scopes, environment, and lifecycle without overloading unrelated fields.

### 2. MCP tool definition

Canonical public-tool metadata backed by one existing capability/operation family.

| Field | Type | Notes |
|---|---|---|
| `tool_key` | string | Stable public tool name |
| `title` | string | User-facing title |
| `description` | string | Selection-oriented description |
| `input_schema_ref` | URI/key | Versioned schema |
| `output_schema_ref` | URI/key | Versioned schema or null |
| `capability_key` | string | Existing capability authority |
| `operation_family_key` | string/null | Existing operation authority for writes |
| `read_only` | boolean | Actual behavior |
| `destructive` | boolean | Actual behavior |
| `open_world` | boolean | Actual external/public effect |
| `required_scopes` | array | Minimum OAuth scopes |
| `rollout_key` | string | Tool-level enablement |
| `handler_key` | string | Internal adapter handler |
| `version` | string | Metadata/behavior version |
| `status` | enum | `draft`, `reviewed`, `active`, `disabled`, `retired` |

**Invariant**: one public tool maps to one recognizable user goal and one bounded authority path.

### 3. MCP tool catalog version

Immutable snapshot of tools advertised to a client/principal class.

| Field | Type | Notes |
|---|---|---|
| `catalog_version_id` | UUID/string | Stable ID |
| `semantic_version` | string | Release version |
| `source_sha` | SHA-40 | Exact repository source |
| `runtime_fingerprint` | SHA-256 | Deterministic metadata hash |
| `client_class` | enum | Target client class |
| `environment` | enum | Target environment |
| `tool_refs` | array/reference | Ordered tools and versions |
| `review_snapshot_id` | string/null | OpenAI review version when applicable |
| `status` | enum | `candidate`, `active`, `superseded`, `rejected`, `retired` |
| `created_at`, `activated_at` | timestamp | Lifecycle |

### 4. OAuth authorization grant

Represents user consent and resource-bound authorization. Token secrets remain in the identity/token authority, not this logical record.

| Field | Type | Notes |
|---|---|---|
| `grant_id` | UUID/string | Stable grant ID |
| `client_registration_id` | reference | Approved client |
| `principal_id` | reference | Authenticated platform user |
| `resource` | HTTPS URI | MCP resource identifier |
| `scopes` | array | Granted scopes |
| `tenant_binding_mode` | enum | `resolved_per_request`, `fixed_workspace`, `admin_policy` |
| `status` | enum | `active`, `expired`, `revoked`, `disabled` |
| `consented_at`, `expires_at`, `revoked_at` | timestamp | Lifecycle |
| `consent_policy_version` | string | Legal/policy evidence |

**Invariant**: a grant does not contain a user-selected tenant override; resource access remains resolved from current memberships and policies.

### 5. MCP invocation evidence

No-secret record for every initialization, discovery, and tool call.

| Field | Type | Notes |
|---|---|---|
| `invocation_id` | UUID | Correlation anchor |
| `request_id` | string | Edge/request correlation |
| `client_registration_id` | reference/null | Client identity |
| `principal_class` | enum | Redacted class, not sensitive profile |
| `principal_ref` | reference/null | Internal protected reference |
| `tool_key`, `tool_version` | string/null | Null for initialization |
| `catalog_version_id` | reference/null | Advertised catalog |
| `context_fingerprint` | SHA-256/null | No raw context data |
| `authorization_decision_id` | reference/null | Capability/policy decision |
| `operation_id` | reference/null | For durable operations |
| `result_class` | enum | `success`, `denied`, `invalid`, `pending`, `failed`, `unknown` |
| `error_code` | string/null | Bounded taxonomy |
| `retryable` | boolean | Explicit retry posture |
| `latency_ms` | integer | Bounded metric |
| `redaction_status` | enum | `passed`, `blocked`, `quarantined` |
| `created_at` | timestamp | Evidence timestamp |

### 6. Confirmation receipt

Binds a user confirmation to one exact intended write.

| Field | Type | Notes |
|---|---|---|
| `confirmation_id` | UUID/string | Stable ID |
| `principal_id` | reference | Confirming user |
| `tool_key` | string | Public tool |
| `target_resource_ref` | typed reference | Canonical target |
| `intent_hash` | SHA-256 | Normalized input and transition |
| `policy_version` | string | Confirmation contract |
| `status` | enum | `issued`, `accepted`, `consumed`, `expired`, `revoked` |
| `issued_at`, `accepted_at`, `expires_at`, `consumed_at` | timestamp | Lifecycle |

**Invariant**: a receipt cannot authorize a different tool, target, principal, or input hash.

### 7. Plugin package version

Tracks source-controlled package metadata separately from a live developer connection.

| Field | Type | Notes |
|---|---|---|
| `package_version_id` | string | Stable package version |
| `plugin_name` | string | Package identity |
| `manifest_fingerprint` | SHA-256 | Deterministic package manifest hash |
| `source_sha` | SHA-40 | Repository source |
| `connection_binding_mode` | enum | `template`, `local_generated`, `review_submission` |
| `connection_technical_id_fingerprint` | string/null | Optional non-secret fingerprint only |
| `status` | enum | `draft`, `tested`, `submitted`, `approved`, `published`, `retired` |
| `review_snapshot_id` | string/null | Review version |
| `created_at`, `published_at` | timestamp | Lifecycle |

### 8. Review snapshot

Captures the exact metadata submitted and approved.

| Field | Type | Notes |
|---|---|---|
| `review_snapshot_id` | string | Portal/review identifier |
| `catalog_version_id` | reference | Tool metadata snapshot |
| `package_version_id` | reference | Package metadata snapshot |
| `mcp_endpoint_fingerprint` | string | Endpoint and TLS identity fingerprint |
| `privacy_policy_version` | string | Legal contract |
| `submission_status` | enum | `draft`, `submitted`, `changes_requested`, `approved`, `rejected`, `published` |
| `submitted_at`, `approved_at`, `published_at` | timestamp | Lifecycle |

## Context resolution model

A tool request may contain a workspace, Brand, resource, capability, or operation identifier. Resolution follows:

1. verify access token and client;
2. resolve principal and current memberships;
3. resolve tenant/workspace/Brand set through Context Kernel;
4. match supplied selectors within that set;
5. resolve capability and object-level authority;
6. construct a typed execution context;
7. reject any mismatch before data or provider access.

## Retention and privacy

- Token values and credentials are not stored in invocation evidence.
- Authorization grants follow identity-policy retention and revocation requirements.
- Invocation evidence uses the minimum identifiers needed for audit, support, abuse investigation, and operational metrics.
- Raw prompt text and full conversation history are not stored by default.
- User-facing deletion and unlink controls must distinguish grant revocation from legally/operationally required evidence retention.

## Index and performance requirements

When new persistence is justified, indexes must support:

- active client by client fingerprint and environment;
- active grant by client, principal, resource, and status;
- tool by key, version, and active rollout;
- catalog by environment, client class, and status;
- invocation by request ID, invocation ID, operation ID, principal reference, and created time;
- confirmation by principal, target, intent hash, status, and expiry;
- review/package versions by status and source SHA.

No high-cardinality raw payload or token field is indexed because it must not be stored.

## Migration decision gate

Before any migration PR:

1. map each logical field to existing schema objects;
2. classify every proposed object in `work-map-integration.json` and the canonical schema classification registry;
3. document additive DDL, indexes, foreign keys, retention, and backfill;
4. prove backup, restore, rollback, and production apply order;
5. register migration lifecycle and exact readback evidence.
