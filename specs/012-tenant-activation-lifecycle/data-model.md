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

## DynamicResolutionOperationPolicy

ADR-004 requires a governed versioned policy record for every protected Tenant Resolution operation. The final implementation may extend an existing endpoint/capability policy registry or add an Activation/Resolution projection when existing semantics are insufficient.

| Field | Type | Rules |
|---|---|---|
| `policy_key` | string | Stable primary identity |
| `policy_version` | integer/string | Monotonic/versioned |
| `operation_id` | string | Stable public OpenAPI operation ID |
| `parent_action_key` | string/null | Registered action authority |
| `endpoint_key` | string/null | Registered endpoint authority |
| `http_method` | enum | Registered method |
| `route_pattern` | string | Normalized declared route |
| `protected_resource` | URI origin | Must equal the accepted resource for this policy |
| `required_scopes_json` | JSON array | One or more stable broad scopes |
| `eligible_roles_json` | JSON/null | Role policy; not a substitute for membership |
| `required_capabilities_json` | JSON array | Dynamic capability gates |
| `object_authority_rule_key` | string | Tenant/workspace/case/approval ownership policy |
| `workspace_brand_app_constraints_json` | JSON/null | Additional governed boundaries |
| `risk_tier` | enum | `low`, `medium`, `high`, `critical` |
| `approval_class` | string/null | Plan/approval class where required |
| `typed_confirmation_required` | boolean | Active policy requirement |
| `idempotency_required` | boolean | Required for unsafe retryable operations |
| `idempotency_scope_key` | string/null | Deterministic scope definition |
| `readback_contract_key` | string/null | Authoritative completion/reconciliation contract |
| `retry_policy_key` | string/null | Registered retry/rate policy |
| `status` | enum | `active`, `disabled`, `deprecated`, `expired` |
| `effective_at` | timestamp | Required |
| `expires_at` | timestamp/null | Optional bounded expiry |
| `created_by` | string | Audited principal/reference |
| `created_at` | timestamp | Required |
| `updated_at` | timestamp | Required |

Required uniqueness/validation:

- one active unambiguous policy per registered operation identity and effective time;
- route/method/operation/action/endpoint mappings must not conflict;
- missing or ambiguous policy fails closed;
- scope values must come from the accepted stable scope catalog;
- critical policy changes invalidate or bypass stale caches;
- policy activation is audited and contract-parity tested.

## ResolutionScopeCatalog

The stable scope catalog contains `tenant.resolution.read`, `manage`, `diagnose`, `repair`, and `approve`. New scopes require a distinct user-understandable consent category and a new reviewed decision; new routes normally reuse an existing scope with dynamic role/capability/object/approval policy.

## GovernedInteractivePolicyQuestionnaire

ADR-005 defines a reusable platform intake and policy-compilation model. The physical implementation must reuse existing policy, approval, audit, and registry tables where semantics fit and introduce only additive schema where required.

### QuestionnaireDefinition

| Field | Type | Rules |
|---|---|---|
| `questionnaire_key` | string | Stable domain/purpose identity |
| `version` | string/integer | Immutable published version |
| `domain_key` | string | Activation, Resolution, onboarding, integrations, agent runtime, notifications, rollout, or data governance |
| `purpose_key` | string | Specific policy outcome |
| `applicable_actor_roles_json` | JSON | Who may start/use the questionnaire |
| `applicable_context_rule_key` | string/null | Tenant tier, mode, app, stage, risk, etc. |
| `schema_json` | JSON Schema | Answer contract |
| `ui_schema_json` | JSON/null | Presentation/progressive-disclosure hints only |
| `policy_template_key` | string | Compiler target template |
| `compiler_key` | string | Deterministic compiler implementation/version |
| `impact_model_key` | string | Preview calculator |
| `approval_policy_key` | string | Approval/typed-confirmation resolver |
| `status` | enum | `draft`, `active`, `deprecated`, `disabled`, `expired` |
| `effective_at` | timestamp | Required for active version |
| `expires_at` | timestamp/null | Optional |

### QuestionDefinition

| Field | Type | Rules |
|---|---|---|
| `question_key` | string | Stable within questionnaire version |
| `questionnaire_key/version` | FK | Immutable parent version |
| `label` | string | User-readable |
| `description/help_text` | string | Explain impact and terminology |
| `answer_type` | enum | Boolean, enum, number, string, multi-select, structured object |
| `allowed_values_json` | JSON/null | Registry values only |
| `constraints_json` | JSON | Bounds/patterns/cardinality |
| `required` | boolean | Context-aware requirement |
| `visibility_rule_key` | string/null | Deterministic conditional display |
| `dependency_questions_json` | JSON/null | Prior-answer dependencies |
| `risk_weight` | number/null | Input to governed risk model |
| `default_strategy_key` | string/null | Profile/recommendation source |

### QuestionnaireSession

| Field | Type | Rules |
|---|---|---|
| `session_id` | string/UUID | Stable identity |
| `tenant_id` | string | Verified principal scope |
| `user_id` | string | Verified principal scope |
| `questionnaire_key/version` | FK | Pinned for session lifetime |
| `context_snapshot_json` | JSON | Bounded, no-secret, compiler-relevant context |
| `status` | enum | `open`, `ready_for_preview`, `submitted`, `expired`, `cancelled` |
| `created_at` | timestamp | Required |
| `expires_at` | timestamp | Required |
| `version` | integer | Optimistic concurrency |

### QuestionnaireAnswer

| Field | Type | Rules |
|---|---|---|
| `answer_id` | string/UUID | Stable identity |
| `session_id` | FK | Required |
| `question_key` | string | Must exist in pinned questionnaire version |
| `answer_json` | JSON | Schema-validated and bounded |
| `source` | enum | `user`, `recommended_profile`, `admin_override` |
| `created_at/updated_at` | timestamp | Audited |

Answers never become runtime authority and must not contain credentials or raw secrets.

### PolicyCompilation

| Field | Type | Rules |
|---|---|---|
| `compilation_id` | string/UUID | Stable identity |
| `session_id` | FK | Required |
| `compiler_key/version` | string | Provenance |
| `template_key/version` | string | Provenance |
| `normalized_input_hash` | string | Deterministic replay/audit |
| `compiled_policy_json` | JSON | Candidate policy |
| `safety_validation_json` | JSON | Bounds and blocked rules |
| `risk_tier` | enum | `low`, `medium`, `high`, `critical` |
| `required_approval_class` | string/null | Derived |
| `status` | enum | `compiled`, `invalid`, `blocked` |
| `created_at` | timestamp | Required |

Same pinned inputs and versions must produce the same normalized policy output.

### ImpactPreview

| Field | Type | Rules |
|---|---|---|
| `preview_id` | string/UUID | Stable identity |
| `compilation_id` | FK | Required |
| `affected_resources_json` | JSON | Tenants/apps/stages/operations |
| `user_experience_json` | JSON | Expected bounded behavior |
| `security_impact_json` | JSON | Permissions and immutable safeguards |
| `performance_cost_json` | JSON/null | Evidence-backed estimate with uncertainty |
| `compatibility_impact_json` | JSON | Clients/policies/cutoffs |
| `rollout_json` | JSON | Shadow/canary/GA |
| `rollback_json` | JSON | Prior policy/version or disable plan |
| `warnings_json` | JSON | Explicit incomplete/blocked evidence |
| `created_at` | timestamp | Required |

### PolicyProposal

| Field | Type | Rules |
|---|---|---|
| `proposal_id` | string/UUID | Stable identity |
| `compilation_id` | FK | Required |
| `tenant_id` | string/null | Null only for platform policy with admin authority |
| `policy_type` | string | Registered policy domain |
| `proposed_version` | string/integer | Immutable candidate |
| `resource_uri` | string | Approval/resource authority binding |
| `status` | enum | `draft`, `submitted`, `approved`, `rejected`, `activation_pending`, `active`, `superseded`, `rolled_back`, `expired` |
| `effective_at/expires_at` | timestamp/null | Governed activation window |
| `supersedes_policy_id` | string/null | Version lineage |
| `created_by` | string | Audited principal |
| `created_at/updated_at` | timestamp | Required |

### PolicyApproval

| Field | Type | Rules |
|---|---|---|
| `approval_id` | string/UUID | Stable identity |
| `proposal_id` | FK | Required |
| `approval_class` | string | Must satisfy compiled requirement |
| `decision` | enum | `approved`, `rejected`, `expired`, `revoked` |
| `approved_by` | string | Governed principal/reference |
| `typed_confirmation_hash` | string/null | Never store reusable plain confirmation |
| `proposal_hash` | string | Invalidates approval on drift |
| `resource_uri` | string | Exact bound resource |
| `created_at/expires_at` | timestamp | Bounded |

### PolicyActivation and PolicyReadback

Activation records the approved proposal, exact policy version, previous version, idempotency identity, effective time, activation result, and runtime registry readback. A policy is not reported active until authoritative registry readback confirms the exact version and resource.

### PolicyRollback/Supersession

Rollback is a new governed operation that restores a prior valid version or disables the policy according to domain rules. It must preserve audit lineage, reconcile in-flight operations, and verify runtime readback.

## ActivationStageSloPolicy

The first ADR-005 domain adapter compiles questionnaire answers into a versioned policy with fields such as:

- `stage_key`;
- `operation_profile`;
- `activation_mode`;
- `dependency_class`;
- `tenant_tier`;
- `soft_deadline_ms`;
- `hard_deadline_ms`;
- `overall_budget_ms`;
- `max_attempts`;
- `backoff_policy_key`;
- `freshness_window_seconds`;
- `degradation_policy`;
- `availability_target`;
- `alert_policy_key`;
- `safety_bounds_version`;
- `questionnaire/template/compiler provenance`;
- `status/effective/expiry/version`.

Runtime safety ceilings and mandatory security/tenant/idempotency/reconciliation rules are not configurable by this policy.

## DeploymentEvidenceExposurePolicy

ADR-006 defines a versioned policy controlling bounded deployment-evidence presentation without granting access beyond the principal's immutable audience ceiling.

| Field | Type | Rules |
|---|---|---|
| `policy_key` | string | Stable identity |
| `policy_version` | string/integer | Immutable active version |
| `operation_id_or_pattern` | string | Registered applicability; no arbitrary caller pattern |
| `principal_class` | enum | `tenant_user`, `tenant_admin`, `platform_admin`, `service` |
| `maximum_exposure_level` | enum | `none`, `opaque`, `diagnostic`, `admin_full` |
| `default_exposure_level` | enum | Must not exceed maximum |
| `include_parameter_allowed` | boolean | Whether bounded detail can be requested |
| `freshness_window_seconds` | integer | Positive and within safety limits |
| `classification_policy_key` | string | Current/deploying/stale/diverged/unknown rules |
| `public_release_id_source_key` | string | Opaque release identifier authority |
| `header_enabled` | boolean | Optional `Deployment-Revision` channel |
| `attention_policy_key` | string/null | Alert/operational-attention mapping |
| `status` | enum | `active`, `disabled`, `deprecated`, `expired` |
| `effective_at` | timestamp | Required |
| `expires_at` | timestamp/null | Optional |
| `questionnaire_provenance_json` | JSON/null | ADR-005 definition/template/compiler/proposal versions |
| `created_by` | string | Audited principal/reference |
| `created_at/updated_at` | timestamp | Required |

Immutable rules:

- Tenant principals can never resolve `admin_full`.
- Public `runtime_version` is opaque and is not authorization, idempotency, or ordering authority.
- Full Git SHA, branch, repository, host path, credentials, and infrastructure topology remain Admin-only.
- Missing/stale/invalid deployment evidence classifies as `unknown`, never false `current`.
- Deployment mismatch never creates OAuth reconnect guidance.
- Policy activation requires exact-version registry readback and critical cache invalidation.

## DeploymentObservation linkage

`DeploymentObservation` remains the authoritative internal evidence projection. Public/Tenant output is derived through the active exposure policy and release-ID adapter. Historical activation operations retain the observation applicable at request time and are not rewritten when a later deployment converges.

## Migration questions

- Can existing execution/operation tables express activation stages and delivery/ack states?
- Does an existing evidence registry support freshness and no-secret constraints?
- Are tenant/user/session columns consistently collated and indexed?
- What foreign-key policy is appropriate for long-retained evidence when sessions/users are deleted?
- Which states belong in normalized tables versus projections/materialized summaries?
