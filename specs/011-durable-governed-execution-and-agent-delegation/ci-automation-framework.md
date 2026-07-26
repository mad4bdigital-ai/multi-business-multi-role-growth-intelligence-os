# CI Automation and Degradation-Prevention Framework

## Goal

Turn CI from a pass or fail signal into an enforceable execution-safety system with structured diagnosis and future-regression prevention.

## Structured failure artifact

Every check writes a bounded JSON artifact:

```json
{
  "schema_version": "ci-diagnosis-v1",
  "check": "Syntax Check",
  "status": "failure",
  "failed_step": "Spec Kit completion gate",
  "error_code": "POST_MERGE_AUDIT_RUN_ID_REQUIRED",
  "file": "specs/example/completion.json",
  "json_path": "$.evidence.post_merge_audit.run_id",
  "evidence_summary": "Required string is missing",
  "suggested_action": "add_required_field",
  "retry_class": "repair_then_rerun",
  "secrets_included": false
}
```

A failed check without this artifact fails the `Structured Failure Artifact Gate`.

## Required gates

### Execution Contract Drift Gate

Compares runtime routes, OpenAPI, tool descriptors, handlers, semantic intents, capability keys, endpoint bindings, approval policies, retry policies, and readback contracts.

### State Machine Model Gate

Generates valid and invalid transition sequences and proves terminal states, resume, cancellation, timeouts, and compensation rules.

### Idempotency Replay Gate

Runs the same operation and key more than once and proves one effective mutation, stable receipt identity, and consistent readback.

### Unknown Outcome Fault-Injection Gate

Injects failure after provider dispatch and before response. It proves that the platform reconciles and does not replay blindly.

### Delegation Boundary Gate

Tests expiry, revoke, resource mismatch, plan drift, checksum drift, risk escalation, mutation limits, self-approval denial, and separation of duties.

### Migration Engine Matrix Gate

Runs candidate DDL against:

- current production-compatible MariaDB;
- supported upgrade candidate;
- production SQL mode and collation profiles.

It records actual schema, constraints, indexes, warnings, and rollback assessment.

### Semantic File Mutation Gate

Rejects unsafe raw mutation for JSON, YAML, OpenAPI, generated artifacts, and completion evidence. Validates parser output and deterministic serialization.

### Merge Freshness Gate

Requires current head and base SHA, all required checks on the final head, mergeability, and release readiness. A synchronized branch creates a new approval requirement.

### Evidence Completeness Gate

Validates completion files against published JSON Schema and verifies referenced PR, CI, migration, schema, deployment, and audit evidence.

### No-Secret and Tenant-Isolation Gate

Scans responses and fixtures for raw tokens, credentials, provider payloads, cross-tenant identifiers, or unbounded logs.

## Managed repair policy

CI may propose repairs for all failures. Automatic repair is limited to allowlisted, deterministic, low-risk classes under a valid delegation grant, such as:

- missing required completion field derivable from authoritative evidence;
- deterministic generated artifact refresh;
- formatting or schema normalization;
- stale branch synchronization;
- exact contract enum alignment with authoritative schema.

Automatic repair is forbidden for security policy weakening, test removal, check bypass, permission expansion, behavior change outside plan, migration modification after authorization, or any high-risk action.

## Workflow behavior

1. Cancel superseded workflow runs after head changes.
2. Run cheap contract and schema gates first.
3. Run state, policy, and unit tests.
4. Run integration, fault-injection, and engine matrix tests.
5. Publish structured diagnosis and bounded evidence.
6. Allow managed repair only under policy.
7. Rerun all affected gates on the repaired final head.

## Metrics

- diagnosis artifact coverage;
- mean time from failure to root cause;
- automatic low-risk repair success rate;
- false repair rate;
- duplicate mutation count in fault injection;
- contract drift count;
- delegation boundary violations;
- migration engine mismatch count;
- stale-head merge attempts blocked.
