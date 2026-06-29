# Architecture

## Architectural intent

The feature is a composition of small deterministic services around existing registries. It is not a global mutable `CapabilityService` and does not merge authorization, credential selection, provider transport, and readback into one class.

## Logical components

### 1. Inventory collectors

One adapter per source family reads bounded active rows and emits `SurfaceDescriptor` values. Missing tables or schema incompatibility produce source-status evidence instead of silent omission.

### 2. Surface normalizer

Normalizes keys, methods, paths, exposure, status, execution readiness, tags, and source provenance. It does not infer authority.

### 3. Canonical identity resolver

Maps surface aliases to one immutable capability identity. It consumes existing source links, semantic capabilities, endpoint aliases, binding registries, and compatibility maps. Multiple equally valid identities block compilation.

### 4. Effect and risk classifier

Deterministically derives effect and risk from explicit declarations and approved semantics. Input-dependent rules are represented as bounded predicates, not arbitrary code.

### 5. Requirement compiler

Produces an immutable `RequirementSet` containing principal, scope, resource, grant, connection, credential, approval, envelope, idempotency, certification, quota, audit, readback, rollback, and compensation requirements.

### 6. Manifest compiler

Combines identity, classification, requirements, bindings, provenance, and rollout state into a versioned manifest hash. Compilation is idempotent for identical source revisions.

### 7. Projection compiler

Builds Admin and Tenant projection candidates from manifests. It never creates callable authority by itself. Reconciliation is separate, gated, audited, and read back.

### 8. Shared enforcement kernel

Evaluates one invocation against the current manifest and authority evidence. It returns immutable `EnforcedExecutionContext` or a stable denied decision. It does not call providers.

### 9. Adapter resolver and dispatcher

Selects one certified adapter with deterministic ranking, reserves idempotency, writes pre-dispatch evidence, invokes infrastructure, and records acknowledgement.

### 10. Readback verifier

Executes a capability-specific readback contract, records observed state, and classifies verified success, mismatch, or unknown effect.

### 11. Reconciler and debt controller

Detects source drift, stale manifests, unsafe exports, missing contracts, stale certifications, and runtime mismatches. It updates persistent debt and operational attention through governed lifecycle operations.

## Layer allocation

### API/interface

- authenticate principal;
- validate strict schemas and pagination;
- derive request/idempotency identifiers;
- invoke one application use case;
- map stable errors;
- return bounded no-secret models.

### Application

- coordinate collectors and repositories;
- define transaction boundaries;
- compile and persist manifests;
- reserve dispatch and idempotency;
- sequence acknowledgement/readback/reconciliation;
- write outbox and evidence.

### Domain

- `CanonicalCapabilityId`
- `SurfaceDescriptor`
- `EffectClass`
- `RiskClass`
- `RequirementSet`
- `GovernanceManifest`
- `ProjectionEligibility`
- `AdapterCandidate`
- `ReadbackContract`
- `DecisionReason`

Domain services are deterministic and side-effect-free.

### Infrastructure

- SQL repositories and advisory locks;
- provider HTTP/SDK adapters;
- credential-reference resolution;
- certification and evidence storage;
- outbox and telemetry;
- bounded cache keyed by manifest revision.

## Required ports

```text
CapabilityInventoryPort.collect(source, cursor, limit)
CanonicalCapabilityPort.resolve(surfaceDescriptor)
PolicyAuthorityPort.resolve(capability, surface, context)
RelationshipAuthorityPort.evaluate(subject, resource, scope)
GrantAuthorityPort.findEffective(subject, capability, resource)
ConnectionPort.resolveValidated(scope, provider, policy)
CertificationPort.resolveCurrent(capability, adapter, revisions)
ProjectionRepositoryPort.compareAndPlan(manifest)
EnvelopeRepositoryPort.createReserveConsume(...)
AdapterRegistryPort.listEligible(manifest, context)
ExecutionEvidencePort.append(event)
ReadbackRegistryPort.resolve(contractKey, version)
CapabilityDebtPort.reconcile(gaps)
```

## Transaction boundaries

- Collection and preview are read-only.
- Manifest persistence writes compilation run, manifest, source links, gaps, and outbox evidence atomically.
- Projection apply reserves a reconciliation run and writes exports plus readback in one bounded transaction where possible.
- Dispatch reservation persists envelope consumption, idempotency identity, execution attempt, and outbox evidence before provider execution.
- No SQL transaction remains open during provider calls.
- Provider acknowledgement and readback are separate transactions with optimistic concurrency.

## Cache policy

Caches are advisory and keyed by manifest version and source revision. A cache hit cannot bypass current actor, resource, credential, approval, certification, or envelope validation. Stale or missing revision evidence forces a fresh resolve or denial.

## Failure isolation

A collector or provider family failure degrades only affected capabilities. It must not convert unknown state into allow, and must not block unrelated read-only capabilities unless shared authority is unavailable.
