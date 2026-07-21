# Feature Specification: Database-Driven Operation Fabric

**Branch**: `gpt/no-docs-agent/011-database-driven-operation-fabric-20260721`
**Status**: Specification complete; implementation pending
**Delivery**: Multi-PR
**Specification PR**: pending

## Problem

The platform already contains high-level operation contracts, operation routes, capability lifecycle logic, repository automation ledgers, patch tools, CI gates, and reconciliation helpers. However, callers still need to discover and combine low-level tools because operation routes are not consistently projected into the Admin/Tenant tool registries, execution bindings remain partially hard-coded, branch reconciliation is largely dry-run, the managed Git worker is a lease/readback abstraction rather than an isolated Git executor, and CI diagnosis does not always expose the failing step and executable recovery.

The result is unnecessary tool discovery, direct SQL inspection, capability-envelope handling, repeated response-chunk reads, fragmented failure recovery, and dependence on local connectors for operations that should run on managed infrastructure.

## User scenarios

### Platform administrator

An administrator requests: synchronize a branch, inspect code and database surfaces, add a Spec Kit, run CI, and stop before merge. One operation executes the complete governed sequence and returns commits, evidence, CI results, and explicit constraints.

### Tenant operator

A tenant invokes an approved high-level operation. The tool catalog exposes only Tenant-safe operations whose operation contract, endpoint, schema, manifest, scope, binding, and runtime readiness are all active.

### Platform developer

A developer adds or changes an operation contract, execution binding, or adapter. A compiler validates the registry graph and regenerates tool projections without manually editing multiple tool tables or duplicating handler logic.

### Incident responder

An interrupted operation resumes from its durable checkpoint. The resolver revalidates resource fingerprints, health, capability authority, and idempotency before continuing.

### Auditor

An auditor can reconstruct which contract revision, binding revision, adapter, policy, capability envelope, input digest, steps, writes, readbacks, and recovery decisions governed an operation.

## Functional requirements

- **FR-001**: Define one canonical `operation_key` for every high-level operation.
- **FR-002**: Store active operation contracts in SQL with versioned input/output schemas, scope, risk, mode, and lifecycle.
- **FR-003**: Keep executable code in registered handlers and adapters; SQL must not contain arbitrary executable source or secrets.
- **FR-004**: Resolve operation steps from a versioned operation-step registry.
- **FR-005**: Resolve eligible execution bindings dynamically by operation, capability, scope, policy, health, capacity, and compatibility.
- **FR-006**: Support prioritized fallback bindings without caller-side tool probing.
- **FR-007**: Generate Admin and Tenant tool projections from active operation, endpoint, schema, manifest, policy, and readiness evidence.
- **FR-008**: Treat `admin_platform_endpoint_tools` and Tenant tool tables as generated projections rather than primary operation authority.
- **FR-009**: Expose stable generic operation routes for context, preview, execute, status, resume, diagnosis, artifacts, and cancellation.
- **FR-010**: Derive Tenant, user, workspace, brand, and business activity from authenticated context and governed resolvers.
- **FR-011**: Reject caller-supplied ownership overrides that conflict with authenticated context.
- **FR-012**: Acquire operation-scoped capability envelopes just in time.
- **FR-013**: Renew capability authority while an operation is legitimately active and consume it only after verified use.
- **FR-014**: Bind every operation run to immutable contract, schema, binding, policy, and adapter revisions.
- **FR-015**: Persist operation runs, step runs, events, artifacts, idempotency receipts, and evidence references.
- **FR-016**: Support deterministic resume from `awaiting_input`, retryable failure, approval, callback, and recovery checkpoints.
- **FR-017**: Perform transparent bounded collection of chunked tool responses inside the orchestrator.
- **FR-018**: Return bounded summaries plus governed detail references instead of requiring callers to manually consume irrelevant chunks.
- **FR-019**: Provide a real managed ephemeral Git worker for clone/fetch/checkout/merge/validate/commit/push/readback operations.
- **FR-020**: Keep local-device Git execution as an optional binding, not a dependency for cloud repository operations.
- **FR-021**: Reconcile generated files by source ownership and registered regeneration policy, not manual conflict selection.
- **FR-022**: Distinguish source files from generated artifacts in branch comparison and merge planning.
- **FR-023**: Diagnose CI down to check, job, step, command class, normalized reason, affected paths, and safe recovery action.
- **FR-024**: Retry only typed transient failures and require readback before retrying any possible write.
- **FR-025**: Use idempotency for unsafe retryable creation, callbacks, schedules, branch writes, and operation dispatch.
- **FR-026**: Return structured JSON errors; upstream HTML error pages must be normalized and never passed through as tool results.
- **FR-027**: Support operation preview that reports selected plan, candidates, exclusions, approvals, costs, dependencies, and expected writes.
- **FR-028**: Block execution when no eligible binding has fresh health and required capabilities.
- **FR-029**: Preserve platform safety, Tenant isolation, credential policy, approval, budget, and readback as hard constraints above preferences.
- **FR-030**: Allow preferences to rank eligible bindings without creating authority.
- **FR-031**: Validate tool projections before publishing and fail closed on missing or invalid schemas.
- **FR-032**: Advance tool-list cache versions whenever projection visibility changes.
- **FR-033**: Preserve current runtime routes and direct tools during an explicit compatibility period.
- **FR-034**: Record projection source revisions and allow exact rollback to the previous projection set.
- **FR-035**: Use additive migrations with reversible or disable-first rollout.
- **FR-036**: Require same-cycle readback for registry writes, projections, Git writes, and capability consumption.
- **FR-037**: Provide kill switches by operation, binding, adapter, runtime, and projection audience.
- **FR-038**: Separate specification, shadow projection, pilot execution, active execution, and legacy retirement states.
- **FR-039**: Run no provider call, credential payload read, external send, runtime install, migration, or deployment from this specification branch.
- **FR-040**: Preserve `src/api`, `src/application`, `src/domain`, and `src/infrastructure` boundaries in future implementation.

## Non-functional requirements

- Deterministic resolution for identical authority inputs.
- Bounded database reads and worker leases.
- No unbounded retries or recursive fallback.
- No secret values in logs, artifacts, errors, tool schemas, or projections.
- Auditable contract and binding revisions.
- Backward-compatible API and tool evolution.
- Horizontal worker isolation and per-operation resource limits.

## Success criteria

- **SC-001**: A repository change request can be initiated through one projected operation tool.
- **SC-002**: The operation requires no direct caller SQL and no manual capability-envelope lookup.
- **SC-003**: A diverged branch with generated-file conflicts is reconciled by a managed worker without a local connector.
- **SC-004**: CI failure responses identify the failing step and a typed recovery action.
- **SC-005**: Admin and Tenant tool catalogs show only operations with complete active authority chains.
- **SC-006**: Projection regeneration is deterministic and rollbackable.
- **SC-007**: All writes have same-cycle readback and idempotency evidence.
- **SC-008**: Operation resume produces the same bound plan unless a new plan is explicitly approved.
- **SC-009**: Negative tests prove Tenant scope isolation, deny-wins, secret safety, and no authority from preferences.
- **SC-010**: Production cutover completes with CI, migration ledger, deployment parity, smoke tests, and post-merge audit.
