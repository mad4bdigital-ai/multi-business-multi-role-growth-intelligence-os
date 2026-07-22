# Data Model: Tenant GPT Activation Lifecycle

## Design rules

- SQL remains authoritative.
- Prefer existing tables and additive projections when semantics match.
- Never store raw access tokens, raw authorization codes, client secrets, provider credentials, or unbounded request/response dumps.
- Every mutable record has stable identity, tenant scope where applicable, timestamps, lifecycle state, and audit/readback support.
- Cross-tenant foreign-key relationships are prohibited unless explicitly platform-global.
- Timestamps use UTC/ISO 8601 at API boundaries.

## Existing entities to inventory and preserve

### OAuth client configuration

Stores registered client ID, secret reference, callbacks, scopes, status, and version. Secret values remain in credential authority, not in specification/runtime config responses.

### OAuth authorization code record

Expected fields:

- record ID;
- code hash/JTI reference;
- user ID;
- tenant ID;
- client ID;
- callback URI hash/normalized URI;
- scope;
- protected resource;
- status (`issued`, `consumed`, `expired`, `revoked`);
- created, expiry, consumed timestamps;
- request/correlation reference.

### Membership and workspace

Authoritative user-to-tenant membership and tenant workspace readiness/status, roles/scopes, and bootstrap state.

### Session context

Tenant/user-scoped session, policy, creation/reuse status, prior session references, and bounded summaries.

### Connected system and connector installation

Per-tenant/per-app connection, mode, installation, health, credential reference, and last validation evidence.

## Proposed lifecycle entities

ADR-001 adopts a hybrid physical model. The existing general operation ledger remains authoritative for shared operation identity, ownership, idempotency, fingerprint, general status, timestamps, and audit correlation. The logical Activation entities below form an Activation-specific projection linked by the same `operation_id`. Inventory tasks T001-T003 and mapping task T014 will decide which existing tables can be reused and which additive projection tables are required.

### ActivationOperation

Represents one user-visible activation lifecycle.

| Field | Type | Rules |
|---|---|---|
| `operation_id` | UUID/string | Primary stable identity |
| `tenant_id` | UUID/string | Required; verified principal |
| `user_id` | UUID/string | Required; verified principal |
| `session_id` | UUID/string/null | Set after session resolution |
| `client_id` | string | Registered OAuth client |
| `resource` | URI origin | Registered protected resource |
| `mode` | enum | `managed`, `dedicated`, `mixed` |
| `idempotency_key_hash` | string/null | Never store raw key when avoidable |
| `operation_fingerprint` | string | Deterministic correlation/reconciliation |
| `status` | enum | Lifecycle state below |
| `current_stage` | enum | Stage catalog below |
| `retryable` | boolean | Current classification |
| `deployment_sha` | string/null | Runtime observation |
| `created_at` | timestamp | Required |
| `updated_at` | timestamp | Required |
| `completed_at` | timestamp/null | Terminal completion |
| `version` | integer | Optimistic concurrency |

### ActivationStageAttempt

One attempt to execute or validate a stage.

| Field | Type | Rules |
|---|---|---|
| `stage_attempt_id` | UUID/string | Primary key |
| `operation_id` | FK | Required |
| `stage_key` | enum | Stage catalog |
| `attempt_number` | integer | Unique per operation/stage |
| `status` | enum | `pending`, `running`, `succeeded`, `degraded`, `failed`, `unknown_outcome`, `cancelled` |
| `error_code` | string/null | Stable machine code |
| `retryable` | boolean | Required |
| `source_type` | string | SQL, gateway, provider, deployment, etc. |
| `request_id` | string/null | Correlation |
| `started_at` | timestamp | Required |
| `ended_at` | timestamp/null | Required when terminal |
| `latency_ms` | integer/null | Bounded non-negative |

Unique index: `(operation_id, stage_key, attempt_number)`.

### ActivationEvidenceItem

Bounded evidence linked to operation/stage.

| Field | Type | Rules |
|---|---|---|
| `evidence_id` | UUID/string | Primary key |
| `operation_id` | FK | Required |
| `stage_attempt_id` | FK/null | Optional stage link |
| `evidence_type` | string | Stable catalog |
| `source_authority` | string | Registry/table/provider/readback |
| `status` | enum | `present`, `missing`, `invalid`, `stale`, `partial` |
| `summary_json` | JSON | Bounded and redacted |
| `source_reference` | string/null | No secrets |
| `observed_at` | timestamp | Required |
| `fresh_until` | timestamp/null | Optional freshness |
| `sensitive_values_included` | boolean | Must be false for GPT-visible evidence |

### ActivationDelivery

Tracks response delivery separately from operation execution.

| Field | Type | Rules |
|---|---|---|
| `delivery_id` | UUID/string | Primary key |
| `operation_id` | FK | Required |
| `channel` | enum | `chatgpt_action`, `status_poll`, `operator` |
| `status` | enum | `prepared`, `sent`, `failed`, `expired` |
| `payload_hash` | string | Detect duplicate delivery |
| `attempt_count` | integer | Bounded |
| `last_error_code` | string/null | Stable code |
| `created_at` | timestamp | Required |
| `delivered_at` | timestamp/null | Set on success |

### ActivationAcknowledgement

Consumer acknowledgement state.

| Field | Type | Rules |
|---|---|---|
| `ack_id` | UUID/string | Primary key |
| `operation_id` | FK | Required |
| `delivery_id` | FK/null | Optional |
| `state` | enum | `acknowledged`, `rejected`, `expired` |
| `actor_type` | enum | `tenant_user`, `client`, `operator` |
| `actor_id` | string/null | Bounded internal identifier |
| `created_at` | timestamp | Required |

### ActivationReconciliationAttempt

Tracks unknown-outcome resolution.

| Field | Type | Rules |
|---|---|---|
| `reconciliation_id` | UUID/string | Primary key |
| `operation_id` | FK | Required |
| `stage_attempt_id` | FK | Required |
| `attempt_number` | integer | Unique per stage attempt |
| `readback_contract_key` | string | Registry-resolved contract |
| `status` | enum | `pending`, `executed`, `not_executed`, `conflicting`, `still_unknown`, `failed` |
| `evidence_id` | FK/null | Readback evidence |
| `started_at` | timestamp | Required |
| `ended_at` | timestamp/null | Terminal |

### DeploymentObservation

Records main/deployed parity relevant to diagnosis.

| Field | Type | Rules |
|---|---|---|
| `observation_id` | UUID/string | Primary key |
| `environment` | enum | `production`, `dev` |
| `main_sha` | string/null | GitHub observation |
| `deployed_sha` | string/null | Host/runtime observation |
| `status` | enum | `current`, `deploying`, `stale`, `diverged`, `unknown` |
| `health_status` | string/null | Bounded |
| `observed_at` | timestamp | Required |
| `source_reference` | string/null | Governed reference |

### ActivationAttentionItem

Operational issue projection.

| Field | Type | Rules |
|---|---|---|
| `attention_id` | UUID/string | Primary key |
| `tenant_id` | string/null | Null only for platform-wide issue |
| `operation_id` | FK/null | Optional |
| `source_type` | string | Auth, gateway, session, provider, deploy, delivery |
| `severity` | enum | `info`, `low`, `medium`, `high`, `critical` |
| `lifecycle_status` | enum | `open`, `acknowledged`, `investigating`, `resolved`, `ignored` |
| `code` | string | Stable |
| `summary` | string | Bounded/no secret |
| `first_seen_at` | timestamp | Required |
| `last_seen_at` | timestamp | Required |
| `resolved_at` | timestamp/null | Optional |

## Stage catalog

1. `oauth_authorize`
2. `identity_verify`
3. `oauth_code_issue`
4. `oauth_token_exchange`
5. `gateway_verify`
6. `membership_resolve`
7. `session_context`
8. `workspace_resolve`
9. `bootstrap_config`
10. `connection_resolve`
11. `provider_validate`
12. `tool_discovery`
13. `dispatch_prepare`
14. `dispatch_execute`
15. `readback`
16. `response_prepare`
17. `delivery`
18. `acknowledgement`
19. `reconciliation`
20. `deployment_verify`

## Operation state machine

### Non-terminal states

- `created`
- `authenticating`
- `authorized`
- `resolving_session`
- `bootstrapping`
- `validating`
- `preparing_tools`
- `ready`
- `executing`
- `readback_pending`
- `delivery_pending`
- `acknowledgement_pending`
- `retry_scheduled`
- `unknown_outcome`
- `reconciling`

### Terminal or stable reported states

- `active`
- `degraded`
- `authorization_gated`
- `validation_rate_limited`
- `contract_degraded`
- `failed`
- `cancelled`
- `rolled_back`

`degraded`, `authorization_gated`, `validation_rate_limited`, and `contract_degraded` may be stable user-visible outcomes while allowing a later linked retry operation.

## Transition rules

- `created → authenticating|authorized` depending on entry evidence.
- `authorized → resolving_session` only after gateway/principal verification.
- `resolving_session → bootstrapping|authorization_gated|degraded`.
- `bootstrapping → validating|ready|degraded`.
- `validating → ready|degraded|validation_rate_limited|contract_degraded`.
- `ready → active` for readiness-only activation, or `ready → executing` for an approved action.
- Any mutation stage with ambiguous transport → `unknown_outcome → reconciling`.
- `executing → readback_pending → active|degraded|failed`.
- User response lifecycle proceeds independently through delivery and acknowledgement records.
- Terminal success cannot be entered without required evidence/readback.

## Concurrency and idempotency

- Optimistic versioning protects operation transitions.
- Unique operation fingerprint/idempotency scope prevents duplicate active operation for the same semantic request where required.
- Authorization-code consumption must be atomic.
- Stage attempt numbering is monotonic per operation/stage.
- Delivery retries use delivery identity and payload hash, not operation replay.
- Reconciliation attempts never execute the original mutation directly.

## Retention

Final durations require security/legal approval. Proposed categories:

- OAuth code records: short operational/security window after expiry/consumption.
- Operation/stage/evidence: incident and audit retention.
- Delivery/acknowledgement: shorter product support retention unless audit requires longer.
- Deployment observations: release/audit retention.
- Raw diagnostic dumps: disabled by default; bounded, elevated, shortest retention.

## Migration questions

- Can existing execution/operation tables express activation stages and delivery/ack states?
- Does an existing evidence registry support freshness and no-secret constraints?
- Are tenant/user/session columns consistently collated and indexed?
- What foreign-key policy is appropriate for long-retained evidence when sessions/users are deleted?
- Which states belong in normalized tables versus projections/materialized summaries?
