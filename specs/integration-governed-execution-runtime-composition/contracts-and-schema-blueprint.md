# Cross-Spec Contracts and Schema Blueprint

## 1. Purpose

This document defines the versioned logical contracts exchanged between Specs 013, 012, and 011. These are specification blueprints. Served OpenAPI, JSON Schema, persistence migrations, and runtime binding remain separate governed implementation work.

Every implementation MUST preserve:

- `additionalProperties: false` for authority-bearing requests unless explicitly justified;
- stable identifiers and typed enums;
- canonical hashing and schema versioning;
- tenant-scoped, no-secret projections;
- backward compatibility through explicit adapters rather than permissive field guessing.

## 2. Common envelope

All cross-spec requests and results use a bounded common envelope:

```json
{
  "schema_version": "1.0.0",
  "request_id": "req_...",
  "trace_id": "trc_...",
  "correlation_id": "cor_...",
  "tenant_ref": "ten_...",
  "issued_at": "2026-07-30T00:00:00Z",
  "secrets_included": false
}
```

Rules:

- `request_id` identifies one transport request.
- `correlation_id` may join retries or related calls but cannot be used as idempotency authority.
- `trace_id` joins stage telemetry.
- `tenant_ref` is a safe reference, not caller-selected authority.
- raw authentication assertions are not serialized into downstream contracts.

## 3. Resolved operation request

Produced by Spec 013 after schema validation and exact descriptor or bounded intent resolution.

```json
{
  "schema_version": "1.0.0",
  "resolution_mode": "exact_operation",
  "operation_key": "repository.change_set",
  "descriptor_ref": "opd_...",
  "descriptor_version": "2026-07-30.1",
  "catalog_snapshot_hash": "sha256:...",
  "operation_input": {},
  "constraints": {
    "allowed_resources": [],
    "maximum_risk": "low",
    "maximum_cost": null,
    "deadline": null
  },
  "context_pin_ref": "ctxp_...",
  "expected_context_hash": "sha256:...",
  "completion_mode": "auto",
  "response_mode": "compact",
  "idempotency_key_ref": "idem_input_present",
  "interpretation": null,
  "execution_allowed": false,
  "secrets_included": false
}
```

`resolution_mode` values:

- `exact_operation`;
- `intent_unique`;
- `compatibility_adapter`;
- `diagnostic_only`.

The contract explicitly states `execution_allowed=false`; execution authority is compiled later.

## 4. Intent interpretation result

When intent is not uniquely resolved:

```json
{
  "status": "interpretation_required",
  "normalized_intent": "...",
  "candidates": [
    {
      "operation_key": "...",
      "descriptor_version": "...",
      "reason_codes": ["intent_term_match"],
      "required_clarifications": ["target_resource"]
    }
  ],
  "provider_call_performed": false,
  "execution_allowed": false,
  "next_action": "provide_interpretation",
  "secrets_included": false
}
```

Candidate ranking evidence is bounded and cannot include hidden descriptors or secret provider metadata.

## 5. Descriptor execution metadata

Owned by Spec 013 and included in the descriptor snapshot hash.

```json
{
  "operation_key": "repository.change_set",
  "operation_kind": "mutation",
  "consequence_class": "repository_write",
  "risk_class": "low",
  "supported_lanes": ["fast", "durable"],
  "preferred_lane": "auto",
  "synchronous_budget_ms": 8000,
  "maximum_provider_calls": 4,
  "supports_durable_execution": true,
  "idempotency": {
    "required": true,
    "scope": "operation_target_input",
    "provider_native_supported": false
  },
  "approval": {
    "policy_ref": "approval.repository_change_set",
    "required_by_default": true,
    "frontier": "before_first_mutation"
  },
  "readback": {
    "required": true,
    "mode": "same_cycle",
    "contract_ref": "readback.repository_ref_and_tree"
  },
  "result_projection": {
    "default_mode": "compact",
    "full_result_supported": true,
    "chunking_supported": true
  },
  "runtime_handler": {
    "handler_key": "repository_change_set_handler",
    "boundary": "in_process"
  },
  "compatibility_adapter_ref": "legacy.repo_patch_batch_apply.v1"
}
```

## 6. Execution Capsule

Produced by Spec 012.

```json
{
  "schema_version": "1.0.0",
  "capsule_ref": "ctxc_...",
  "context_hash": "sha256:...",
  "context_revision": "ctxrev_...",
  "principal": {
    "type": "tenant_user",
    "ref": "usr_..."
  },
  "effective_subject_ref": "sub_...",
  "scope": {
    "tenant_ref": "ten_...",
    "workspace_ref": "wsp_...",
    "brand_ref": null
  },
  "target": {
    "resource_type": "repository",
    "resource_ref": "res_...",
    "connection_ref": "con_..."
  },
  "authority_path_ref": "authp_...",
  "capability_key": "repository.change_set",
  "revision_vector": {
    "authority_revision": "...",
    "capability_revision": "...",
    "registry_revision": "...",
    "credential_readiness_revision": "..."
  },
  "invalidation_dependencies": [
    {"domain": "resource", "ref": "res_...", "revision": "..."}
  ],
  "issued_at": "...",
  "expires_at": "...",
  "execution_allowed": false,
  "secrets_included": false
}
```

The capsule cannot contain credential material, raw JWT claims, raw grant payloads, or provider bodies.

## 7. Capsule validation result

```json
{
  "status": "valid",
  "capsule_ref": "ctxc_...",
  "context_hash": "sha256:...",
  "dynamic_refresh_required": true,
  "invalidated_dependencies": [],
  "next_action": "none",
  "secrets_included": false
}
```

Status values:

- `valid`;
- `expired`;
- `revision_mismatch`;
- `context_mismatch`;
- `dynamic_refresh_required`;
- `interpretation_required`;
- `blocked`.

## 8. Governance decision

Produced by Spec 011.

```json
{
  "schema_version": "1.0.0",
  "decision_ref": "govd_...",
  "decision_hash": "sha256:...",
  "disposition": "approval_required",
  "operation_key": "repository.change_set",
  "descriptor_version": "...",
  "capsule_ref": "ctxc_...",
  "context_hash": "sha256:...",
  "risk_class": "low",
  "consequence_class": "repository_write",
  "policy_evidence": [
    {"policy_ref": "...", "revision": "...", "result": "allow_with_approval"}
  ],
  "capability_evidence_ref": "cape_...",
  "authority_evidence_ref": "authe_...",
  "approval_requirement": {
    "required": true,
    "group_key": "repository_mutation",
    "policy_ref": "..."
  },
  "limits": {
    "maximum_mutations": 1,
    "maximum_cost": null,
    "maximum_risk": "low"
  },
  "dynamic_refresh": [
    "approval_state",
    "capability_envelope",
    "effective_authority",
    "resource_version",
    "connection_status",
    "expected_branch_sha"
  ],
  "readback_contract_ref": "...",
  "retry_contract_ref": "...",
  "expires_at": "...",
  "execution_allowed": false,
  "secrets_included": false
}
```

`execution_allowed` becomes true only in the final governed execution input after all required artifacts are valid.

## 9. Compiled governed plan

```json
{
  "schema_version": "1.0.0",
  "plan_ref": "plan_...",
  "plan_revision": 1,
  "plan_hash": "sha256:...",
  "operation_ref": "op_...",
  "descriptor_ref": "opd_...",
  "capsule_ref": "ctxc_...",
  "context_hash": "sha256:...",
  "governance_decision_ref": "govd_...",
  "lane_policy": {
    "requested": "auto",
    "selected": "durable",
    "reason_codes": ["external_ci_wait"]
  },
  "approval_groups": ["repository_mutation"],
  "steps": [],
  "result_aggregation": {
    "schema_ref": "...",
    "canonicalization_version": "1"
  },
  "created_at": "...",
  "expires_at": "...",
  "secrets_included": false
}
```

## 10. Plan step

```json
{
  "step_ref": "step_...",
  "step_key": "prepare_change_set",
  "depends_on": ["step_inspect_repository"],
  "operation_key": "repository.prepare_change_set",
  "operation_kind": "preparation",
  "input_projection": {
    "from_request": ["requested_changes"],
    "from_steps": ["step_inspect_repository.result_ref"]
  },
  "risk_class": "read_only",
  "consequence_class": "none",
  "resource_lock_key": null,
  "idempotency": {"required": false},
  "retry": {
    "maximum_attempts": 2,
    "backoff": "bounded_exponential",
    "retryable_codes": ["provider_rate_limited"]
  },
  "approval_group": null,
  "readback_contract_ref": null,
  "timeout_ms": 10000,
  "external_wait": false,
  "success_contract_ref": "...",
  "output_schema_ref": "..."
}
```

Mutation steps require non-null resource lock, declared idempotency, approval policy, and readback contract unless an authoritative exception is explicitly defined.

## 11. Approval bundle

```json
{
  "schema_version": "1.0.0",
  "approval_ref": "appr_...",
  "approval_hash": "sha256:...",
  "state": "approved",
  "plan_ref": "plan_...",
  "plan_hash": "sha256:...",
  "capsule_ref": "ctxc_...",
  "context_hash": "sha256:...",
  "operation_keys": ["repository.change_set", "repository.open_pull_request"],
  "step_refs": ["step_apply", "step_open_pr"],
  "resource_refs": ["res_..."],
  "resource_lock_keys": ["repository:owner/repo:ref:branch"],
  "expected_versions": {
    "branch_sha": "..."
  },
  "limits": {
    "maximum_mutations": 2,
    "maximum_cost": null,
    "risk_ceiling": "low"
  },
  "readback_contracts": ["..."],
  "approval_mode": "delegated_plan_bound",
  "approver_ref": "...",
  "issued_at": "...",
  "expires_at": "...",
  "consumed_step_refs": [],
  "secrets_included": false
}
```

## 12. Governed execution input

This is the final cross-spec contract consumed by `DispatchGovernedOperation`.

```json
{
  "schema_version": "1.0.0",
  "operation_ref": "op_...",
  "request_ref": "req_...",
  "resolved_operation": {},
  "descriptor": {},
  "execution_capsule": {},
  "governance_decision": {},
  "plan": {},
  "approval_bundle_ref": "appr_...",
  "idempotency": {
    "key_hash": "sha256:...",
    "scope_hash": "sha256:..."
  },
  "selected_lane": "durable",
  "response_mode": "compact",
  "execution_allowed": true,
  "dynamic_validation_required": true,
  "secrets_included": false
}
```

The dispatcher MUST reject `execution_allowed=false` and independently validate all hashes/references rather than trusting this boolean alone.

## 13. Dynamic mutation-frontier result

```json
{
  "status": "ready",
  "operation_ref": "op_...",
  "step_ref": "step_apply",
  "validated": {
    "approval": true,
    "capability_envelope": true,
    "effective_authority": true,
    "resource_version": true,
    "connection_status": true,
    "expected_sha": true,
    "idempotency_reservation": true,
    "resource_lock": true
  },
  "current_versions": {},
  "drift": [],
  "execution_allowed": true,
  "secrets_included": false
}
```

Status values:

- `ready`;
- `approval_required`;
- `context_re_resolution_required`;
- `drift_detected`;
- `blocked`;
- `reconciliation_required`.

## 14. Provider dispatch result

```json
{
  "dispatch_classification": "request_accepted",
  "provider_ref": "github",
  "target_ref": "res_...",
  "provider_request_hash": "sha256:...",
  "provider_operation_ref": "safe_bounded_ref",
  "http_status": 201,
  "retryable": false,
  "possible_mutation": true,
  "raw_payload_included": false,
  "secrets_included": false
}
```

Classifications include:

- `not_dispatched`;
- `request_rejected_before_mutation`;
- `request_accepted`;
- `confirmed_provider_success`;
- `confirmed_provider_failure`;
- `unknown_outcome`;
- `reconciliation_required`.

## 15. Mutation receipt

```json
{
  "schema_version": "1.0.0",
  "receipt_ref": "rcpt_...",
  "operation_ref": "op_...",
  "step_ref": "step_apply",
  "attempt_ref": "att_...",
  "target_ref": "res_...",
  "idempotency_scope_hash": "sha256:...",
  "provider_request_hash": "sha256:...",
  "outcome": "confirmed_success",
  "expected_precondition_hash": "sha256:...",
  "observed_postcondition_hash": "sha256:...",
  "readback_ref": "rbk_...",
  "result_hash": "sha256:...",
  "reconciliation_state": "not_required",
  "recorded_at": "...",
  "secrets_included": false
}
```

## 16. Readback evidence

```json
{
  "readback_ref": "rbk_...",
  "receipt_ref": "rcpt_...",
  "contract_ref": "readback.repository_ref_and_tree",
  "status": "matched",
  "expected_state_hash": "sha256:...",
  "observed_state_hash": "sha256:...",
  "observed_version": "...",
  "source_authority": "provider_read_api",
  "collected_at": "...",
  "secrets_included": false
}
```

## 17. Execution status projection

```json
{
  "operation_ref": "op_...",
  "state": "awaiting_approval",
  "lane": "durable",
  "plan_ref": "plan_...",
  "current_steps": [],
  "progress": {
    "total": 6,
    "succeeded": 3,
    "running": 0,
    "blocked": 1,
    "terminal": 3
  },
  "blocker": {
    "type": "approval_required",
    "approval_ref": "appr_..."
  },
  "projection_status": "pending",
  "next_action": "provide_approval",
  "secrets_included": false
}
```

## 18. Compact result

```json
{
  "operation_ref": "op_...",
  "state": "completed",
  "terminal_classification": "confirmed_success",
  "summary": "...",
  "changed_resources": [
    {"resource_ref": "res_...", "change_class": "updated"}
  ],
  "receipts": [
    {"receipt_ref": "rcpt_...", "outcome": "confirmed_success"}
  ],
  "readbacks": [
    {"readback_ref": "rbk_...", "status": "matched"}
  ],
  "projection_status": "pending",
  "next_action": "retrieve_full_result",
  "full_result": {
    "result_ref": "result_...",
    "result_hash": "sha256:...",
    "expires_at": "..."
  },
  "secrets_included": false
}
```

## 19. Full result reference and retrieval

A result reference contains no unrestricted storage URL.

Retrieval requires:

- current authenticated principal;
- tenant/resource authorization;
- operation/result binding;
- non-expired reference;
- pagination or chunk cursor bound to snapshot/hash;
- no-secret projection.

Unauthorized or hidden results return a non-enumerating not-found response.

## 20. Cancellation request/result

Request:

```json
{
  "operation_ref": "op_...",
  "reason_code": "user_requested",
  "expected_state_version": 12
}
```

Result:

```json
{
  "state": "cancelling",
  "active_mutation_state": "reconciliation_required",
  "compensation_state": "not_evaluated",
  "next_action": "reconcile",
  "secrets_included": false
}
```

Cancellation never claims that committed effects were reversed.

## 21. Resume request/result

Resume requires:

- resumable current state;
- expected operation state version;
- blocker resolution evidence;
- still-valid plan/context/approval or explicit revalidation;
- no authority widening.

A resume request cannot replace the operation target or input.

## 22. Error contract

All errors are structured:

```json
{
  "ok": false,
  "error": {
    "code": "context_revision_mismatch",
    "stage": "mutation_frontier_validation",
    "retryable": false,
    "operation_ref": "op_...",
    "step_ref": "step_...",
    "details": {
      "next_action": "refresh_context"
    }
  },
  "request_id": "req_...",
  "secrets_included": false
}
```

No raw stack, SQL, credential, token, provider secret, or unbounded body is exposed.

## 23. Stable error taxonomy

### Resolution and schema

- `request_schema_invalid`;
- `operation_not_found`;
- `operation_not_visible`;
- `interpretation_required`;
- `descriptor_runtime_mismatch`;
- `unsupported_completion_mode`.

### Context

- `context_unresolved`;
- `context_ambiguous`;
- `context_expired`;
- `context_revision_mismatch`;
- `context_hash_mismatch`;
- `context_re_resolution_required`;
- `connection_unavailable`;
- `target_substitution_forbidden`.

### Authority and approval

- `authority_denied`;
- `capability_not_ready`;
- `capability_envelope_missing`;
- `capability_envelope_expired`;
- `approval_required`;
- `approval_expired`;
- `approval_revoked`;
- `approval_binding_mismatch`;
- `delegation_scope_exceeded`.

### Plan and execution

- `plan_invalid`;
- `plan_cycle_detected`;
- `plan_revision_mismatch`;
- `lane_policy_violation`;
- `resource_lock_conflict`;
- `claim_lost`;
- `fencing_token_stale`;
- `operation_not_resumable`;
- `operation_terminal`.

### Idempotency and provider

- `idempotency_key_required`;
- `idempotency_conflict`;
- `provider_rejected_before_mutation`;
- `provider_rate_limited`;
- `provider_timeout_before_dispatch`;
- `provider_unknown_outcome`;
- `reconciliation_required`;
- `readback_unavailable`;
- `readback_mismatch`.

### Projection and result

- `result_not_found`;
- `result_reference_expired`;
- `result_hash_mismatch`;
- `response_chunk_persistence_unavailable`;
- `projection_delivery_failed`;
- `projection_dead_lettered`.

## 24. HTTP status guidance

- 200: completed/status/result read;
- 202: durable accepted, waiting, approval, or reconciliation state;
- 400: invalid schema or unsupported request semantics;
- 401: authentication required;
- 403: known authenticated caller lacks authority where non-enumeration is not required;
- 404: absent or hidden descriptor/result/resource;
- 409: state, version, idempotency, lock, approval, or context conflict;
- 410: expired result reference where safe to reveal;
- 422: well-formed but unexecutable plan or interpretation requirement when modeled as validation;
- 429: provider or platform rate limit;
- 500: unexpected internal failure before possible mutation;
- 502/503/504: structured upstream failure with explicit possible-mutation and reconciliation classification.

## 25. Versioning policy

- additive optional response fields may be introduced within a minor version;
- new required request fields require a versioned contract or server-derived default with no authority impact;
- enum expansion must be reviewed for client behavior;
- authority-bearing semantic changes require plan/descriptor/cache invalidation;
- removal requires usage evidence and a separately reviewed major or dated contract change;
- legacy adapters declare source contract version and target operation version.

## 26. Contract parity tests

Required tests include:

- exact schema validation and unknown-field rejection;
- canonical hash stability across key ordering;
- descriptor snapshot invalidation after consequence metadata change;
- capsule and plan hash mismatch rejection;
- approval binding drift matrix;
- certified legacy/exact-operation semantic equivalence;
- compact/full result hash equality;
- unauthorized result non-enumeration;
- structured 502/503/504 unknown-outcome envelopes;
- no-secret and bounded-evidence checks for every contract.