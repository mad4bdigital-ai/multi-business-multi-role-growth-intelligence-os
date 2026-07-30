# Tasks: Governed Execution Runtime Composition

This task file is the completion-gate entrypoint. Detailed task definitions and acceptance gates remain authoritative in `tasks-and-gates.md` and `implementation-map-and-pr-slicing.md`.

## X0 — Evidence baseline

- [ ] X001 Instrument legacy execution stages, correlations, SQL/provider/internal-HTTP/model counts, response size, and critical path.
- [ ] X002 Publish no-secret matched benchmark fixtures and safety-vector baselines.
- [ ] X003 Prove instrumentation does not change runtime decisions or results.

## X1 — Contract composition shadow

- [ ] X101 Implement Execution Capsule and composed governed-input contracts in shadow mode.
- [ ] X102 Compare legacy and composed descriptor, context, authority, consequence, approval, and readback decisions.
- [ ] X103 Classify every mismatch with one owner and no provider dispatch.

## X2 — Unified in-process read

- [ ] X201 Add one internal `DispatchGovernedOperation` boundary for a selected read.
- [ ] X202 Route Admin, Tenant, and Custom GPT adapters through the same bounded read path.
- [ ] X203 Remove localhost loopback for the selected in-process handler and prove result parity.

## X3 — DAG read and preparation

- [ ] X301 Implement ready-set scheduling, bounded concurrency, leases, fencing tokens, and deterministic aggregation.
- [ ] X302 Add resource-lock conflict serialization and disjoint-read concurrency evidence.
- [ ] X303 Stop ordinary child-plan creation in the certified pilot.

## X4 — Approval frontier

- [ ] X401 Compile exact plan/context/resource/version/risk/readback approval bundles.
- [ ] X402 Complete authorized preparation before approval and continue compatible steps server-side.
- [ ] X403 Prove every declared drift class invalidates approval before mutation.

## X5 — Ledger and projection split

- [ ] X501 Define and implement the atomic reservation, pending receipt, readback, result, event, and outbox protocol.
- [ ] X502 Shadow Drive, JSONL, search, analytics, and notification projections with payload/order/hash parity.
- [ ] X503 Add retry, dead-letter, reconciliation, and optional strong-projection semantics without provider replay.

## X6 — Fast-lane mutation

- [ ] X601 Certify one reversible low-risk mutation with dynamic frontier validation.
- [ ] X602 Persist receipt and same-cycle readback before compact success.
- [ ] X603 Pass disconnect and unknown-outcome fault injection with zero duplicate mutation.

## X7 — Durable lane

- [ ] X701 Certify one long-running repository, CI, deployment-observation, or external-wait workflow.
- [ ] X702 Implement durable status, resume, cancel, approval pause, result retrieval, restart recovery, and compensation state.
- [ ] X703 Prove resume never creates a second provider mutation.

## X8 — Public execution surface

- [ ] X801 Publish schema-only intent, exact-operation, status, result, cancel, and resume contracts.
- [ ] X802 Enable selected read and low-risk operation cohorts only after internal certification.
- [ ] X803 Preserve legacy list/call behavior and prove certified adapter equivalence.

## X9 — Rollout and closeout

- [ ] X901 Expand traffic only through passing safety, performance, parity, and rollback gates.
- [ ] X902 Generate authoritative owner-Spec and integration closeout evidence.
- [ ] X903 Retire duplicate or legacy paths only through a separate reviewed and reversible contract change.

## Specification PR boundaries

- [x] Owner requirements and namespaces are assigned without duplicate authority.
- [x] Architecture, contracts, states, threats, persistence, failures, benchmarks, rollout, rollback, and acceptance are documented.
- [x] Catalog V2 baseline dependency is merged and recorded.
- [x] Owner and extension manifests are registered.
- [x] This PR keeps runtime, provider, database, migration, deployment, Production, and protected-branch authority disabled.
