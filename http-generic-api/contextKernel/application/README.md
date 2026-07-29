# Context Kernel Application Use Cases

Phase 4 coordinates the framework-independent domain kernel and repository ports. It does not expose routes, call providers directly, read credentials, or replace production resolvers.

## Use cases

- `createContextResolutionService` reads authorized scope, resource graph, exact connection, capability readiness, and optional pin evidence before invoking the deterministic domain decision policy.
- `createContextPinService` delegates create, read, and invalidation operations to the injected context-pin repository. The current Phase 3 SQL adapter remains read-only and rejects writes explicitly.
- `createContextSwitchService` prepares context switches, computes transitive invalidation, and only invalidates a prior pin through an explicit `apply` call.
- `createExecutionPlanService` compiles immutable plan descriptors and validates context revision, context hash, candidate identity, capability readiness, expiry, and approval requirements. Compilation never authorizes execution.
- `createUnknownOutcomeReconciliationService` reads ledger evidence and invokes an injected readback port when needed. It never performs an automatic retry.

## Safety boundaries

- No Express, HTTP, provider SDK, environment, or SQL imports.
- No hidden persistence or automatic external write.
- No raw credential, token, secret, execution-context, or evidence payload is retained in returned values.
- Mutation plans require capability readiness evidence.
- High-risk and mutation plans require approval before validation can allow execution.
- Unknown outcomes always return `retryAllowed: false`; a confirmed-not-applied result requires a new plan rather than replaying the existing attempt.
