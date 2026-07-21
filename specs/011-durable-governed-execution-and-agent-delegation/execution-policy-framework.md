# Execution Policy Framework

## Policy evaluation order

```text
principal
→ tenant and workspace membership
→ semantic intent
→ resource authority
→ execution contract
→ risk classification
→ delegation grant
→ capability and quota
→ preflight and validation
→ dispatch
→ reconciliation
→ readback
→ evidence
```

A later stage cannot repair or override a denial from an earlier authority stage.

## Mandatory policies

### P-001 No untracked mutation

Deny a mutation unless a durable operation ID, step ID, idempotency scope, plan reference, and pending receipt exist before dispatch.

### P-002 No success without readback

A provider success response is dispatch evidence, not completion. Completion requires the declared readback contract.

### P-003 Unknown outcome before retry

A transport failure after dispatch moves the step to `reconciliation_required`. Retry is forbidden until absence is proven or idempotency guarantees a safe replay.

### P-004 Plan-bound authority

Approval and delegation are valid only for the approved plan, intent, resource, mode, risk, checksum or SHA, and expiry.

### P-005 No self-expansion

An Agent cannot create, approve, renew, or modify a grant in a way that expands its own authority. Renewal must preserve or narrow the original bindings.

### P-006 Human on drift

Any unapproved drift pauses execution and returns a typed human action. The platform cannot reinterpret a broad goal as approval for new scope.

### P-007 Engine-native migration validation

Static SQL analysis cannot authorize apply. A compatible database engine must execute the DDL in isolation and return schema and rollback evidence.

### P-008 Freshness-bound merge

Merge approval is bound to exact head and base SHA plus required checks. Any SHA change invalidates the approval.

### P-009 Generator authority

When a generator owns an artifact, manual patching is forbidden. The authoritative source is changed and the generator is rerun.

### P-010 Semantic structured-file mutation

JSON uses JSON Pointer or object merge, YAML and OpenAPI use AST paths, Markdown evidence uses section keys, and source code uses AST or stable semantic anchors where supported.

### P-011 Structured boundaries

All boundary errors use stable machine-readable codes, bounded details, request or operation IDs, and `secrets_included=false`.

### P-012 Canonical next action

Every operation response states what is proven, unknown, blocked, and the one next safe action.

## Retry policy classes

| Class | Automatic retry | Required action |
|---|---|---|
| Read-only deterministic | Yes, bounded | Record attempts |
| Idempotent mutation | Reconcile, then retry if absent | Receipt and readback |
| Non-idempotent mutation | No automatic replay | Reconcile and require proof |
| Destructive or irreversible | No | Human decision and recovery plan |

## Delegation policy decision

The decision engine returns:

```json
{
  "decision": "allow|deny|await_user|await_reviewer",
  "policy_key": "delegated_plan_bound_v1",
  "grant_id": "uuid",
  "risk_tier": "low",
  "bindings_verified": true,
  "drift_detected": false,
  "reason_code": "WITHIN_DELEGATED_PLAN",
  "next_action": "dispatch"
}
```

## Policy versioning

Policies are versioned and immutable after use. An operation stores the evaluated policy version. Updating a policy affects new evaluations only; active operations re-evaluate at step boundaries and pause if the new policy is stricter.

## Fail-closed conditions

- missing or ambiguous execution contract;
- invalid principal or membership;
- resource mismatch;
- expired or revoked delegation;
- missing idempotency scope;
- missing pending receipt;
- validation not run or stale;
- unknown mutation outcome;
- changed checksum or SHA;
- missing readback contract;
- unstructured provider error that cannot be safely classified;
- evidence or response would expose secrets or cross-tenant data.
