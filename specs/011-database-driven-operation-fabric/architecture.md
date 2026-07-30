# Architecture: Database-Driven Operation Fabric

## Target control plane

```text
Caller / GPT / UI / Workflow
        ↓
Stable operation endpoint
        ↓
Operation contract resolver
        ↓
Context and authority resolver
        ↓
Step-plan compiler
        ↓
Dynamic binding resolver
        ↓
Capability / approval / budget / credential gates
        ↓
Registered execution adapter
        ↓
Durable operation events and readback
```

## Primary decision

The database defines which operation contracts, steps, bindings, schemas, policies, and projections are active. The runtime defines how allowlisted handlers and adapters execute. Neither layer replaces the other:

- SQL is lifecycle and authority data.
- Code is executable behavior.
- Generated tool rows are projections.
- Operation runs are immutable execution evidence.

## Layer responsibilities

### Interface layer

- Generic Admin and Tenant operation endpoints.
- Authentication, request validation, idempotency, and response mapping.
- No business workflow composition in route handlers.

### Application layer

- Operation context, preview, execute, status, resume, diagnosis, and cancellation use cases.
- Plan compilation, binding selection, capability lifecycle, retry, recovery, and readback coordination.

### Domain layer

- Operation contract, step, binding, adapter capability, projection, run state, failure class, and lifecycle invariants.
- Deny-wins rules and authority precedence.

### Infrastructure layer

- SQL repositories.
- GitHub REST and managed Git worker adapters.
- CI, local connector, browser, workflow, and provider adapters.
- Credential references, queues, leases, and artifact stores.

## Runtime components

1. `OperationContractRepository`
2. `OperationStepRepository`
3. `OperationBindingRepository`
4. `ExecutionAdapterCatalog`
5. `OperationProjectionCompiler`
6. `OperationPlanCompiler`
7. `OperationBindingResolver`
8. `OperationCapabilityLifecycle`
9. `OperationRunRepository`
10. `ManagedGitWorkerAdapter`
11. `CiDiagnosisAdapter`
12. `GeneratedArtifactCoordinator`

## State model

```text
requested
→ context_loading
→ planning
→ awaiting_input | awaiting_approval | ready
→ running
→ awaiting_callback | retrying | recovering
→ validating
→ completed | partial | blocked | failed | cancelled
```

Every state transition is an append-only event. A resumed operation revalidates the resource fingerprint, authority, health, and idempotency receipt before continuing.

## Authority invariants

- Operation key does not imply execution authority.
- Endpoint presence does not imply tool exposure.
- Tool exposure does not imply Tenant visibility.
- Preference does not imply capability.
- Binding priority does not bypass policy or health.
- A successful transport response does not imply operation success without readback.
- A generated projection is not canonical unless its source revision and compiler version are recorded.

## Compatibility posture

Current direct tools and code-side operation contracts remain available during shadow and dual-read phases. Cutover occurs operation by operation, with exact rollback to the previous projection revision and code fallback controlled by kill switch.
