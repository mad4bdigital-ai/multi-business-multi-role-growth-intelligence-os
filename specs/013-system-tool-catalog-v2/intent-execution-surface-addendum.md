# Spec 013 Addendum: Intent Execution Surface

## Status and ownership

This addendum extends `013-system-tool-catalog-v2` after its catalog, direct lookup, intent-to-capability discovery, cursor, parity, and compatibility contracts.

The catalog remains a discovery and descriptor surface. Catalog presence, lookup, or intent resolution never grants execution authority. Spec 011 owns execution lifecycle and orchestration. Spec 012 owns execution context. This addendum owns the stable public shell that submits an intent or exact operation to those authorities and projects the result back to Custom GPT, Admin, Tenant, and other API clients.

## Evidence for the extension

Catalog V2 solves disappearance and first-page scanning by providing stable ordering, snapshot-bound cursors, direct lookup, principal scope, read-only intent resolution, and descriptor/runtime parity. The current generic system and GPT contracts still center on listing tools and calling one named tool at a time. That makes discovery reliable, but it leaves multi-step orchestration to the caller.

The missing functional layer is an additive execution surface that uses the catalog as descriptor authority while delegating context and execution to Spec 012 and Spec 011.

## Public operations

### `executeIntent`

Used when the caller expresses a goal and constraints but does not know the exact canonical operation.

Minimum request:

```json
{
  "intent": "inspect the repository, prepare the bounded repair, validate it, and open a pull request",
  "constraints": {},
  "context_pin_ref": null,
  "service_mode": "self_serve",
  "completion_mode": "auto",
  "response_mode": "compact",
  "idempotency_key": "..."
}
```

The server performs principal-scoped intent resolution, returns interpretation when ambiguous, and never treats semantic similarity as authority.

### `executeOperation`

Used when the canonical operation is already known.

```json
{
  "operation_key": "repository.change_set",
  "operation_input": {},
  "context_pin_ref": "...",
  "expected_context_hash": "...",
  "completion_mode": "auto",
  "response_mode": "compact",
  "idempotency_key": "..."
}
```

### `getExecution`

Returns operation state, current step, blockers, approval frontier, projection status, and canonical next action.

### `getExecutionResult`

Returns the authorized compact or full result projection and integrity metadata.

### `cancelExecution`

Requests governed cancellation. Cancellation does not imply provider compensation and returns explicit compensation state.

### `resumeExecution`

Resumes only a resumable durable operation after its declared blocker has been satisfied. It cannot widen or recreate authority.

## New functional requirements

### Intent and exact-operation dispatch

- **FR-IE-001**: `executeIntent` MUST resolve against the principal-visible Catalog V2 descriptor snapshot and MUST return `interpretation_required` when more than one materially valid operation remains.
- **FR-IE-002**: `executeOperation` MUST resolve one exact visible descriptor by stable operation key without catalog-page traversal.
- **FR-IE-003**: Neither operation may dispatch until Spec 012 returns a valid execution capsule and Spec 011 returns an allowed governed execution decision.
- **FR-IE-004**: Intent ranking, catalog visibility, descriptor presence, and compatibility aliases MUST NOT create execution, resource, credential, approval, or provider authority.
- **FR-IE-005**: Provider-specific endpoint and capability keys SHOULD be server-resolved outputs, not required caller inputs, except in explicit diagnostic or compatibility modes.

### Descriptor execution metadata

- **FR-IE-006**: Callable descriptors MUST declare operation kind, risk class, latency class, supported lanes, synchronous budget, durable support, idempotency requirement, approval policy reference, readback requirement, result projection, and compatibility adapter where applicable.
- **FR-IE-007**: Descriptor metadata MUST be versioned and included in the catalog snapshot/hash used to compile execution.
- **FR-IE-008**: A descriptor/runtime mismatch for execution metadata MUST fail closed before provider dispatch.
- **FR-IE-009**: Changes to consequential metadata MUST invalidate affected compiled plans and approvals.

### Completion and response modes

- **FR-IE-010**: `completion_mode=auto` allows the platform to choose fast or durable execution under Spec 011 policy.
- **FR-IE-011**: `completion_mode=sync` MAY be requested but MUST be rejected or upgraded to durable execution when the compiled plan cannot safely fit the synchronous budget.
- **FR-IE-012**: `completion_mode=durable` MUST return an execution identity after durable acceptance and begin execution without requiring another model call.
- **FR-IE-013**: `response_mode=compact` MUST return operation ID, state, next action, receipt summary, readback summary, changed-resource references, projection state, and optional full-result reference.
- **FR-IE-014**: `response_mode=full` MUST preserve current authorization, response bounds, pagination/chunking, and no-secret behavior.
- **FR-IE-015**: Compact mode changes transport shape only and MUST NOT discard authoritative result or evidence.

### Compatibility

- **FR-IE-016**: `listTools` and `callTool` remain supported during migration.
- **FR-IE-017**: A compatible legacy tool call MAY be translated into `executeOperation` through a declared adapter and MUST produce equivalent authority, mutation, readback, receipt, and result semantics.
- **FR-IE-018**: Tools without a certified execution adapter continue through the legacy path and are not silently reinterpreted.
- **FR-IE-019**: Compatibility retirement requires usage telemetry, contract parity, rollback proof, and a separately reviewed versioned change.

### Status, result, and continuation

- **FR-IE-020**: Every accepted execution MUST expose one canonical state and next action.
- **FR-IE-021**: Result retrieval MUST be tenant-scoped, principal-authorized, bounded, integrity-hash verified, and non-enumerating for unauthorized callers.
- **FR-IE-022**: Chunk continuation remains available for genuinely large full results, but clients MUST NOT be forced to retrieve all chunks to learn whether the operation succeeded, what changed, or what action is next.
- **FR-IE-023**: A result reference MUST identify the result projection and hash, not a raw provider payload or unrestricted storage URL.

### Consequential-operation declaration

- **FR-IE-024**: OpenAPI consequential metadata MUST be derived from the resolved operation consequence contract rather than a blanket static value on a generic call shell.
- **FR-IE-025**: A generic shell MUST project when an operation requires confirmation, approval, or durable execution before dispatch.
- **FR-IE-026**: No public schema may imply that a state-changing operation is non-consequential merely because it is transported through a generic endpoint.

### Observability

- **FR-IE-027**: Metrics MUST distinguish catalog list, lookup, intent resolution, exact-operation resolution, legacy call, compatibility translation, fast execution, durable execution, ambiguity, approval pause, chunk use, and fallback.
- **FR-IE-028**: Metrics MUST record model/tool round trips and continuation calls without recording prompt bodies, secrets, or unbounded result payloads.

## Functional outcomes

1. The Custom GPT can request one intent execution rather than orchestrating every internal step through repeated `callTool` calls.
2. Exact known operations skip semantic resolution and catalog traversal.
3. A compact receipt communicates success, mutation identity, readback, blockers, and next action without mandatory chunk continuation.
4. Existing clients continue to use Catalog V2 and legacy tool calls during phased adoption.
5. Consequential behavior is derived from the selected operation, not hidden behind a generic endpoint declaration.

## Acceptance scenarios

- **AC-IE-001**: An exact operation after descriptor item 200 executes through direct lookup without listing prior pages.
- **AC-IE-002**: An ambiguous natural-language intent returns bounded candidates and performs no provider call.
- **AC-IE-003**: A six-step durable plan begins after one `executeIntent` request and does not require one caller round trip per step.
- **AC-IE-004**: A legacy call and exact-operation call for the same certified adapter produce matching receipt and result hashes.
- **AC-IE-005**: A compact mutation response reports success and readback while its full result remains retrievable by authorized reference.
- **AC-IE-006**: An unauthorized principal receives a non-enumerating result lookup failure.
- **AC-IE-007**: A declared sync request is upgraded to durable before mutation when the plan exceeds the synchronous budget.
- **AC-IE-008**: A descriptor consequence or readback contract drift invalidates the compiled plan before dispatch.

## Delivery slices

1. **IE0 schema-only draft**: request/response schemas and operation metadata with no route or runtime authority.
2. **IE1 read-only shadow**: `executeOperation` resolves and compares against legacy calls without dispatch.
3. **IE2 read-only fast lane**: selected read operation executes through the unified dispatcher.
4. **IE3 durable read workflow**: status and full-result retrieval pilot.
5. **IE4 low-risk mutation pilot**: exact approval and readback, legacy adapter parity.
6. **IE5 Custom GPT percent rollout**: prefer intent/operation surface, preserve legacy fallback.
7. **IE6 compatibility closeout**: retire only certified unused legacy orchestration patterns.

## Performance and quality gates

- at least 60 percent fewer caller round trips for a representative 3-6 step workflow;
- direct exact-operation resolution does not depend on catalog size or page position;
- compact mode removes mandatory continuation for success/next-action discovery;
- no regression in descriptor visibility, principal scoping, authority, approval, readback, result integrity, or compatibility coverage;
- all state-changing operations expose correct consequential metadata after resolution.