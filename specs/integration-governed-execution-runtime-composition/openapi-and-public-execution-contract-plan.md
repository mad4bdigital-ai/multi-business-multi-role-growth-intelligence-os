# OpenAPI and Public Execution Contract Plan

## 1. Purpose

This document defines the additive public/API contract direction for Spec 013 execution operations. It does not authorize serving routes in the current specification PR.

The public shell must be stable, bounded, principal-scoped, consequence-aware, and backed by Specs 012 and 011. It must not expose provider-specific orchestration or imply that generic transport grants authority.

## 2. Proposed operation set

```text
POST /system/executions/intent
POST /system/executions/operations
GET  /system/executions/{operationId}
GET  /system/executions/{operationId}/result
POST /system/executions/{operationId}/cancel
POST /system/executions/{operationId}/resume
```

Final path naming follows existing System Layer conventions and OpenAPI operation-count constraints.

## 3. Authentication and authorization

- reuse existing supported bearer/API-key schemes by surface;
- authenticate before descriptor/context resolution;
- Tenant access requires active tenant-scoped identity and effective subject where necessary;
- Admin/service access does not bypass target/resource authority;
- operation status/result/cancel/resume re-authorize current principal and target visibility;
- unauthorized hidden operation/result references are non-enumerating;
- route-level auth is necessary but not sufficient for execution.

## 4. `executeIntent`

### Request

```json
{
  "intent": "inspect the repository, prepare a bounded repair, validate it, and open a pull request",
  "constraints": {
    "resource_refs": [],
    "maximum_risk": "low",
    "deadline": null,
    "maximum_cost": null
  },
  "context_pin_ref": null,
  "completion_mode": "auto",
  "response_mode": "compact",
  "idempotency_key": "caller-generated"
}
```

### Validation

- `intent`: non-empty, bounded length;
- `constraints`: strict allowlist;
- no raw credential/provider endpoint/tool handler fields;
- idempotency required when resolution may reach mutation;
- unknown fields rejected.

### Outcomes

- `200`: completed synchronously;
- `202`: durable accepted, approval required, interpretation required, waiting, or reconciliation state;
- `400`: malformed request;
- `401/403/404`: authentication/visibility/authority behavior;
- `409`: idempotency/context/state conflict;
- `422`: well-formed but ambiguous/unexecutable plan where chosen by final API style;
- structured upstream/internal errors.

No provider call occurs for `interpretation_required`.

## 5. `executeOperation`

### Request

```json
{
  "operation_key": "repository.change_set",
  "operation_input": {},
  "constraints": {},
  "context_pin_ref": "ctxp_...",
  "expected_context_hash": "sha256:...",
  "completion_mode": "auto",
  "response_mode": "compact",
  "idempotency_key": "caller-generated"
}
```

Exact lookup does not require catalog page traversal.

The caller does not need to supply:

- provider endpoint;
- capability key;
- runtime handler;
- policy key;
- approval policy;
- readback adapter;
- connection secret.

These are server-resolved through descriptor/context/governance authorities.

## 6. Completion modes

### `auto`

Platform selects fast or durable based on compiled plan and policy.

### `sync`

A preference, not authority. The platform may:

- complete synchronously;
- reject unsupported mode before mutation; or
- promote to durable before mutation.

### `durable`

Operation identity is committed before execution and status/result APIs are used.

The mode cannot weaken durability required by operation/risk class.

## 7. Response modes

### Compact

Required fields:

- operation ID;
- state and terminal classification;
- selected lane;
- summary;
- blocker/approval/reconciliation state;
- receipt/readback summaries;
- changed resource references;
- projection status;
- canonical next action;
- full result reference/hash where available;
- no-secret flag.

### Full

Includes authorized bounded detail and may use pagination/chunking.

Full mode cannot expose raw secret/provider payloads solely because the caller requested detail.

## 8. Consequential metadata

A static generic route cannot accurately declare all possible operation consequences.

Required model:

- route declares that consequences are resolved dynamically and that state-changing operations require governed confirmation/approval;
- operation descriptor contains consequence/risk/approval/readback metadata;
- response before dispatch exposes resolved consequence and required approval;
- Custom GPT or client confirmation flow follows the selected operation contract;
- CI proves that mutation descriptors cannot appear non-consequential.

If the consumer platform requires static `x-openai-isConsequential`, the served Custom GPT surface should expose bounded operation-specific shells or a safe policy that treats the generic execution submission as consequential whenever mutation is possible. The final served design must be reviewed against current Custom GPT contract limits before runtime activation.

## 9. Durable acceptance response

```json
{
  "ok": true,
  "operation_id": "op_...",
  "state": "ready",
  "lane": "durable",
  "accepted": true,
  "started": true,
  "resolved_operation": {
    "operation_key": "...",
    "consequence_class": "...",
    "risk_class": "..."
  },
  "next_action": "wait",
  "links": {
    "status_ref": "op_...",
    "result_ref": null
  },
  "secrets_included": false
}
```

`started=true` means server-side execution began or was durably queued; it does not mean provider mutation occurred.

## 10. Interpretation-required response

```json
{
  "ok": true,
  "state": "interpretation_required",
  "operation_id": null,
  "candidates": [],
  "clarification_schema": {},
  "provider_call_performed": false,
  "next_action": "provide_interpretation",
  "secrets_included": false
}
```

Candidate count and evidence are bounded.

## 11. Approval-required response

```json
{
  "ok": true,
  "operation_id": "op_...",
  "state": "awaiting_approval",
  "approval": {
    "approval_ref": "appr_...",
    "plan_hash": "sha256:...",
    "context_hash": "sha256:...",
    "consequence_class": "repository_write",
    "risk_class": "low",
    "operations": [],
    "resources": [],
    "limits": {},
    "expires_at": "..."
  },
  "next_action": "provide_approval",
  "secrets_included": false
}
```

No raw policy/grant/credential payload is returned.

## 12. Status operation

`GET /system/executions/{operationId}` returns:

- current state/version;
- lane;
- plan progress counts;
- active/waiting/blocked step summaries;
- approval/reconciliation/cancellation/compensation state;
- projection state;
- canonical next action;
- terminal result reference when authorized.

It does not return every event or provider body by default.

Cursor/pagination may expose bounded event summaries through a separately reviewed diagnostic operation if needed.

## 13. Result operation

Query options:

```text
mode=compact|full
cursor=<snapshot-bound-cursor>
limit=<bounded>
```

Response integrity:

- result ID/hash;
- projection schema/version;
- snapshot/chunk hash;
- expiry;
- no-secret flag.

Unauthorized/hidden access is non-enumerating.

## 14. Cancel operation

Request requires expected state version or an idempotent cancellation key.

Response distinguishes:

- cancellation requested;
- already terminal;
- active mutation reconciliation required;
- compensation required/in progress;
- cancelled terminally.

Cancellation does not claim provider rollback.

## 15. Resume operation

Resume is permitted only for declared resumable states:

- approval/interpretation/context blocker resolved;
- external wait ready;
- retry-scheduled step due;
- reconciliation permits continuation;
- projection strong-mode blocker repaired.

Request cannot change intent, target, operation input, plan hash, or authority scope. Such changes require a new request/plan.

## 16. Idempotency transport

Preferred support:

- explicit request body field for Custom GPT compatibility where headers are inconvenient;
- optional standard/custom idempotency header for API clients;
- if both are present they must match;
- raw key never returned or logged;
- conflict response identifies operation reference only when authorized.

## 17. Error responses

All 5xx/upstream errors are structured and include:

- stable code;
- stage;
- retryable;
- possible mutation;
- reconciliation required;
- operation/receipt reference where available;
- canonical next action;
- request ID;
- no-secret marker.

HTML error bodies are never forwarded as the public error contract.

## 18. OpenAPI schema components

Proposed components:

```text
ExecuteIntentRequest
ExecuteOperationRequest
ExecutionAcceptedResponse
ExecutionStatusResponse
ExecutionCompactResult
ExecutionFullResultPage
ExecutionInterpretationRequired
ExecutionApprovalRequired
ExecutionCancellationRequest
ExecutionCancellationResponse
ExecutionResumeRequest
ExecutionErrorResponse
ResolvedOperationSummary
ApprovalBundleProjection
MutationReceiptProjection
ReadbackProjection
ProjectionStatus
FullResultReference
CanonicalNextAction
```

## 19. Schema constraints

- OpenAPI 3.1;
- strict object fields for authority-bearing input;
- bounded strings/arrays/maps;
- stable enums/error codes;
- formats/patterns for hashes/references;
- no arbitrary URL as handler/result authority;
- request/response examples for read, mutation, durable, ambiguity, approval, unknown outcome, projection failure, cancel/resume;
- no raw secret schema fields;
- shared canonical generation chain respected.

## 20. Compatibility with Catalog V2

Catalog V2 remains available for:

- browsing;
- exact descriptor lookup;
- diagnostic intent-to-capability discovery;
- observability and parity;
- long-tail legacy calls.

Execution surface reuses descriptor snapshots and does not create another registry.

`listTools` and `callTool` remain until certified retirement. A legacy call may translate to exact operation only through a declared adapter.

## 21. Custom GPT design

Preferred Custom GPT instructions:

1. use exact operation when known;
2. use intent execution for multi-step goals;
3. do not orchestrate internal steps after durable acceptance;
4. poll/read status only when needed or when instructed by the operation state;
5. request approval/clarification using returned contract;
6. use compact result for outcome/next action;
7. retrieve full result only when detail is needed;
8. use legacy tools for diagnostics or uncertified operations.

The served action set must stay within current platform operation/schema constraints and pass Custom GPT Contract Guard.

## 22. API rollout sequence

1. schema document only;
2. generated artifact validation;
3. route factory disabled;
4. internal service-auth exact read;
5. Admin/Tenant exact read;
6. durable status/result;
7. low-risk mutation;
8. Custom GPT exact-operation preference;
9. bounded intent execution;
10. percent rollout and compatibility observation.

## 23. Contract acceptance tests

- operation IDs unique/stable and authorized;
- exact descriptor after item 200;
- ambiguity causes zero provider calls;
- sync-to-durable promotion before mutation;
- compact/full result hash parity;
- result non-enumeration;
- cancel/resume state-version conflicts;
- no target/input change on resume;
- correct dynamic consequential metadata;
- structured transient/unknown-outcome errors;
- legacy adapter semantic equivalence;
- operation/schema count and Custom GPT guard;
- no-secret/size/pagination bounds.