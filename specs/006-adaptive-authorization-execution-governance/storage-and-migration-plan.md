# Storage and Migration Plan

## Purpose

Define the target persistence model and a safe additive migration sequence. Logical resources MUST be mapped to existing SQL authorities before new tables are approved.

## Authority mapping first

Before any migration, produce a mapping table:

| Logical resource | Existing candidate authority | Decision |
|---|---|---|
| CanonicalCapability | actions, skills, endpoint/tool registries | reuse, extend, or create |
| CapabilityAlias | action/endpoint/tool mappings | reuse, normalize, or create |
| RelationshipTuple | tenant/workspace/resource grant tables | reuse, project, or create |
| CapabilityGrant | agent skill grants and scope grants | reuse with projection or extend |
| ApprovalPolicy | approval and governance registries | reuse or create versioned policy registry |
| AuthorizationDecision | execution/audit evidence | create append-only ledger if absent |
| ExecutionEnvelope | capability resolution envelope ledger | extend or create compatible envelope authority |
| ApprovalDecision | approval holds and decisions | extend with immutable binding evidence |
| AdapterBinding | tool/endpoint/provider registries | extend with certification and rollout fields |
| ExecutionEvidence | execution logs and evidence tables | extend or create append-only evidence ledger |
| ReconciliationCheckpoint | job/controller state tables | reuse or create scoped checkpoint authority |

No concept receives a new table solely because its name differs.

## Proposed physical resources

Names are provisional until authority mapping is approved.

### canonical_capabilities

Key fields:

```text
capability_id UUID or stable binary ID
capability_key VARCHAR unique with version
version INT
operation_class VARCHAR
risk_profile_key VARCHAR
approval_policy_key VARCHAR nullable
input_schema_ref VARCHAR
output_schema_ref VARCHAR
readback_contract_key VARCHAR nullable
status ENUM-like constrained value
created_at, created_by
```

Immutability: key semantic fields do not change after activation. A new version is created.

### capability_aliases

```text
alias_id
alias_type
alias_key
capability_id
capability_version
scope_type
scope_id nullable
priority
status
valid_from
valid_until
revision
```

Constraint: one deterministic highest-ranked active mapping per alias and scope.

### relationship_tuples or compatibility projection

```text
relationship_id
subject_type
subject_id
relation_key
resource_type
resource_id
tenant_id
workspace_id nullable
brand_id nullable
valid_from
valid_until
source_authority
source_row_ref
revision
status
```

If existing tables remain authoritative, this may be a view or read model rather than a writable table.

### capability_grants or compatibility projection

```text
grant_id
subject_type
subject_id
capability_id
capability_version_min
capability_version_max nullable
tenant_id
workspace_id nullable
brand_id nullable
resource_type nullable
resource_id nullable
constraints_json bounded and schema validated
status
valid_from
expires_at nullable
revision
created_at, created_by
revoked_at, revoked_by nullable
```

### approval_policies

Immutable version rows:

```text
policy_id
policy_key
version
mode
required_roles_json
minimum_approvals
self_approval_allowed
single_use
ttl_seconds
typed_confirmation_schema_json
invalidation_fields_json
risk_thresholds_json
status
published_at
```

### authorization_decisions

Append-only:

```text
decision_id
subject_ref_hash
capability_id
capability_version
action_key
resource_ref_hash
context_hash
request_hash
effect
states_json bounded
obligations_json bounded
reason_codes_json bounded
revision_vector_json bounded
issued_at
expires_at
trace_id
sensitive_values_included false
```

Avoid raw request payload storage.

### execution_envelopes

```text
envelope_id
decision_id
subject_ref_hash
capability_id
capability_version
resource_ref_hash
request_hash
adapter_key
adapter_version
approval_request_id nullable
approval_decision_id nullable
state
nonce_hash
idempotency_scope_hash
single_use
issued_at
expires_at
consumed_at nullable
row_version
```

Indexes support ready-state expiry scans and atomic reservation.

### approval_requests and approval_decisions

Requests may have lifecycle state. Decisions are append-only.

Decision fields include:

```text
approval_decision_id
approval_request_id
decision
approver_ref_hash
approver_role
bound_evidence_hash
policy_key
policy_version
decided_at
expires_at nullable
reason_code
```

### capability_adapter_bindings

```text
binding_id
capability_id
capability_version
adapter_key
adapter_version
provider_family
rollout_mode
priority
selection_conditions_json bounded
certification_id
status
valid_from
valid_until nullable
revision
```

### adapter_certifications

Append-only version evidence:

```text
certification_id
adapter_key
adapter_version
capability_version
code_revision
contract_hash
provider_contract_revision
readback_contract_version
test_run_id
result
certified_at
expires_at
revoked_at nullable
```

### capability_executions

```text
execution_id
envelope_id
attempt_number
adapter_key
adapter_version
state
reservation_id
reservation_expires_at
provider_reference_hash nullable
retry_classification
started_at
completed_at nullable
row_version
```

### execution_evidence

Append-only:

```text
evidence_id
execution_id
evidence_type
source_type
source_reference_hash nullable
observed_revision nullable
evidence_hash
reason_code nullable
observed_at
sensitive_values_included false
```

### reconciliation_checkpoints

```text
controller_key
scope_key
cursor_value
last_observed_revision
last_success_at
last_error_code
retry_count
lease_owner nullable
lease_expires_at nullable
row_version
```

## Index strategy

Candidate indexes:

```text
capability_aliases(alias_type, alias_key, scope_type, scope_id, status, priority)
relationship_tuples(tenant_id, subject_type, subject_id, relation_key, resource_type, resource_id, status)
capability_grants(tenant_id, subject_type, subject_id, capability_id, status, expires_at)
authorization_decisions(capability_id, effect, issued_at)
execution_envelopes(state, expires_at)
execution_envelopes(idempotency_scope_hash)
approval_decisions(approval_request_id, decided_at)
capability_adapter_bindings(capability_id, capability_version, rollout_mode, status, priority)
capability_executions(envelope_id, attempt_number)
execution_evidence(execution_id, evidence_type, observed_at)
reconciliation_checkpoints(controller_key, scope_key)
```

Index design requires query plans and production cardinality review.

## Partitioning and retention

High-volume append-only decisions and evidence may require time partitioning after measured volume justifies it. Do not introduce partitioning before access patterns and retention are proven.

Potential retention classes:

- authorization decisions: medium-term audit retention;
- approvals and high-impact execution evidence: long-term governed retention;
- parity evidence: shorter bounded retention after migration closeout;
- reconciliation checkpoints: current state plus limited history;
- operational metrics: observability retention policy.

## Migration phases

### M0 — Census and authority mapping

- inventory existing tables and views;
- identify canonical owner per concept;
- detect duplicated authorities;
- measure row counts and update rates;
- approve reuse versus additive resources.

### M1 — Additive schemas

- create only approved missing resources;
- add nullable or default-safe columns;
- create indexes using production-safe methods;
- record migration checksum, statements, and ledger run ID.

### M2 — Read compatibility

- deploy repositories that can read legacy authority and new resources;
- keep legacy execution unchanged;
- expose diagnostics and counts;
- validate tenant scope and query performance.

### M3 — Backfill

- run bounded idempotent batches;
- checkpoint progress;
- record source and target counts/hashes;
- quarantine invalid or ambiguous rows;
- never auto-promote ambiguous aliases or relationships.

### M4 — Shadow decisions

- generate adaptive decisions using mapped authority;
- compare against legacy behavior;
- classify mismatches;
- prohibit provider mutation from adaptive paths.

### M5 — Controlled writes

- write append-only decisions, envelopes, approvals, and evidence;
- retain legacy enforcement;
- use internal-write pilot for state transitions and idempotency.

### M6 — Canary reads and enforcement

- cut over one capability cohort;
- monitor parity, latency, denials, readback, and reconciliation;
- preserve feature-flag rollback.

### M7 — Compatibility consolidation

- route legacy wrappers through the new kernel;
- stop duplicated writes only after parity and rollback evidence;
- document deprecation windows.

### M8 — Destructive cleanup

A separate explicitly approved migration may remove obsolete schema only after:

- no active readers or writers;
- retention and audit obligations satisfied;
- backup and rollback plan approved;
- production verification complete.

## Backfill correctness

Each batch records:

```json
{
  "migrationKey": "key",
  "batchId": "id",
  "sourceCursor": "cursor",
  "sourceCount": 1000,
  "targetInserted": 990,
  "targetUpdated": 0,
  "quarantined": 10,
  "sourceHash": "sha256",
  "targetHash": "sha256",
  "completedAt": "ISO-8601"
}
```

Quarantined rows require explicit resolution. They do not receive guessed mappings.

## Dual-write policy

Dual-write is used only when unavoidable and must define:

- authoritative write order;
- transaction boundary;
- retry behavior;
- divergence detection;
- reconciliation owner;
- cutover and stop date.

Transactional outbox or one-authority-plus-projection is preferred over uncontrolled dual-write.

## Rollback

For additive migrations, rollback usually disables new reads/writes and preserves schema. Dropping newly created tables is not the default rollback when they contain evidence.

Rollback evidence includes:

- feature-flag state;
- active readers/writers;
- queue backlog;
- controller state;
- source and target counts;
- expected and deployed code revisions;
- unresolved external effects.

## Migration blockers

- unknown canonical authority;
- incompatible tenant ownership semantics;
- ambiguous aliases without resolution policy;
- missing revision strategy;
- no bounded backfill plan;
- no query performance evidence;
- no rollback path;
- destructive change mixed with initial rollout;
- evidence ledger unable to exclude sensitive values.
