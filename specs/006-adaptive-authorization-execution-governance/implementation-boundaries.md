# Implementation Boundaries

## Purpose

Translate the architecture into repository-layer responsibilities without creating a monolithic capability service.

## Dependency direction

```text
interfaces -> application -> domain
infrastructure -> application/domain through approved abstractions
```

Domain code does not depend on HTTP, SQL drivers, provider SDKs, queues, framework request objects, or environment variables.

## Interface layer

Suggested modules:

```text
src/api/authorization-decisions.controller.*
src/api/execution-envelopes.controller.*
src/api/approval-requests.controller.*
src/api/approval-decisions.controller.*
src/api/executions.controller.*
src/api/execution-evidence.controller.*
```

Responsibilities:

- authenticate the principal;
- validate path, query, header, and body input;
- resolve request IDs and idempotency headers;
- call one application use case;
- map internal errors to the stable API error catalog;
- return bounded response models.

Forbidden:

- direct provider calls;
- deep relationship traversal;
- policy evaluation;
- credential selection;
- repository orchestration;
- approval or execution state transitions implemented in controllers.

## Application layer

Suggested use cases:

```text
evaluate-authorization.use-case.*
create-execution-envelope.use-case.*
create-approval-request.use-case.*
decide-approval.use-case.*
reserve-dispatch.use-case.*
dispatch-capability.use-case.*
verify-execution.use-case.*
reconcile-authority-drift.use-case.*
```

Responsibilities:

- coordinate domain services and repositories;
- establish transaction boundaries;
- sequence decision, envelope, approval, dispatch, and readback flows;
- enforce use-case-level invariants;
- write outbox and audit evidence;
- invoke infrastructure only through typed ports.

The application layer does not contain provider-specific serialization or transport logic.

## Domain layer

Suggested packages:

```text
src/domain/capability/
src/domain/authorization/
src/domain/relationships/
src/domain/grants/
src/domain/policy/
src/domain/approval/
src/domain/execution/
src/domain/evidence/
src/domain/reconciliation/
```

Core value objects:

```text
CanonicalCapabilityId
CapabilityVersion
SubjectRef
ResourceRef
AuthorityScope
RelationshipRevision
GrantRevision
PolicyBundleVersion
AdapterVersion
NormalizedRequestHash
RevisionVector
DecisionEffect
Obligation
ApprovalMode
ExecutionEnvelopeState
VerificationLevel
StableReasonCode
```

Core services:

```text
CapabilityResolver
AuthorizationEvaluator
RelationshipAuthorityEvaluator
GrantEvaluator
PolicyEvaluator
ObligationDeriver
AdapterCandidateResolver
ApprovalBindingValidator
EnvelopeFreshnessValidator
ReadbackComparator
```

Domain services are deterministic and side-effect-free.

## Infrastructure layer

Suggested packages:

```text
src/infrastructure/repositories/
src/infrastructure/policy-engine/
src/infrastructure/relationship-resolver/
src/infrastructure/adapters/
src/infrastructure/credential-resolution/
src/infrastructure/outbox/
src/infrastructure/reconciliation/
src/infrastructure/telemetry/
```

Responsibilities:

- SQL repository implementations;
- transaction and locking primitives;
- provider SDK and HTTP isolation;
- credential-reference resolution;
- message queue and outbox delivery;
- controller leases and checkpoints;
- metrics, logs, and traces;
- external error normalization.

## Required ports

### CapabilityRegistryPort

```text
resolveCanonicalCapability(aliasOrKey, requestedVersion)
listAliases(capabilityId)
getCapabilityVersion(capabilityId, version)
```

### RelationshipAuthorityPort

```text
evaluatePath(subject, relation, resource, scope)
getRevision(scope)
```

### GrantRepositoryPort

```text
findEffectiveGrant(subject, capability, scope, atTime)
getRevision(scope)
```

### PolicyDecisionPort

```text
evaluate(policyBundleVersion, typedInput)
```

### AdapterRegistryPort

```text
listEligibleBindings(capability, scope, context)
getCertification(adapterKey, adapterVersion)
getRevision(scope)
```

### ApprovalRepositoryPort

```text
createRequest(request)
appendDecision(decision)
findCurrentDecision(requestId)
```

### EnvelopeRepositoryPort

```text
create(envelope)
reserveDispatch(envelopeId, expectedVersion, lease)
consume(envelopeId, reservationId)
markStale(envelopeId, reason)
```

### ExecutionRepositoryPort

```text
createAttempt(execution)
appendEvidence(evidence)
updateState(executionId, expectedVersion, nextState)
```

### OutboxPort

```text
append(event, transaction)
```

## Shared enforcement kernel

The shared enforcement kernel should be a small application/domain composition, not a global mutable singleton.

It validates:

- authenticated actor and scope;
- envelope state and expiry;
- request hash;
- revision vector freshness;
- approval and obligations;
- adapter certification;
- connection and credential-reference scope;
- idempotency reservation.

It returns an immutable `EnforcedExecutionContext` consumed by the adapter.

## Transaction boundaries

### Decision creation

Read-only except optional append-only decision evidence. It must not hold database locks across external calls.

### Approval decision

Append decision, transition request state, and write outbox event in one transaction.

### Dispatch reservation

Reserve envelope, reserve idempotency identity, create execution attempt, and write outbox/audit evidence atomically before provider execution.

### Provider dispatch

Never keep a database transaction open while waiting for the provider.

### Provider acknowledgement

Append acknowledgement and update execution state in a new transaction.

### Readback

Append evidence and transition verification state with optimistic concurrency.

## Queue boundaries

Queue messages contain identifiers and hashes, not credentials or unrestricted payloads.

Minimum message fields:

```json
{
  "executionId": "id",
  "envelopeId": "id",
  "adapterKey": "key",
  "adapterVersion": "version",
  "requestHash": "sha256",
  "reservationId": "id",
  "traceId": "id"
}
```

Workers reload current authority and bounded execution material from repositories.

## Configuration boundaries

Environment configuration may select infrastructure endpoints, timeouts, and feature flags. It must not define per-tenant grants, resource authority, approval decisions, or runtime capability mappings that belong in governed registries.

## Avoided anti-patterns

- `CapabilityService.authorizeApproveExecuteVerifyAndReconcile()`;
- controllers directly querying authorization tables;
- adapters selecting credentials or tenant scope;
- policy logic embedded in route handlers;
- global catch-all helpers hiding authority decisions;
- provider responses exposed directly to clients;
- dashboard projection tables used as enforcement authority;
- transactions held during network calls;
- silent fallback from stale authority to cached allow.

## Migration compatibility layer

Existing routes call compatibility application services that:

1. preserve current request and response contracts;
2. map legacy action/skill/tool identity to canonical capability;
3. invoke shadow decision comparison;
4. continue legacy enforcement until the capability cohort is approved for cutover;
5. emit bounded migration evidence;
6. never interpret UI or display state as authority.

## File ownership

Each package and adapter family should have an explicit code owner. Changes to shared enforcement, relationship authority, approval binding, or credential scope require security review.
