# Implementation Plan: Governed Execution Runtime Composition

## Delivery model

Delivery is multi-PR and gate-driven. No implementation phase may be marked complete from this specification PR.

The implementation order is dependency constrained:

```text
X0 Evidence Baseline
  -> X1 Contract Composition Shadow
  -> X2 Unified In-Process Read
  -> X3 DAG Read and Preparation
  -> X4 Approval Frontier
  -> X5 Ledger and Projection Split
  -> X6 Fast-Lane Mutation
  -> X7 Durable Lane
  -> X8 Public Execution Surface
  -> X9 Percent Rollout and Closeout
```

## Phase ownership

| Phase | Primary owner | Required dependencies | Runtime authority at start |
|---|---|---|---|
| X0 | Spec 011 | merged Catalog V2 baseline | legacy only |
| X1 | Specs 011/012/013 | telemetry baseline and owner manifests | shadow only |
| X2 | Specs 011/012 | zero unexplained shadow mismatch | selected read-only pilot |
| X3 | Spec 011 | unified read dispatcher and locks | read/preparation pilot |
| X4 | Spec 011 | stable compiled plan and context binding | approval planning only, then bounded pilot |
| X5 | Spec 011 | authoritative receipt/readback contract | dual-write shadow |
| X6 | Spec 011 | ledger/outbox and approval certification | one reversible low-risk mutation |
| X7 | Spec 011 | durable state, lease, resume, reconciliation | one long-running pilot |
| X8 | Spec 013 | certified context and execution paths | selected public cohorts |
| X9 | all owners | C0–C6 evidence and rollback drills | percentage controlled |

## PR slicing

The canonical PR A–S breakdown is defined in `implementation-map-and-pr-slicing.md`. Each implementation PR must:

- affect one bounded architectural concern;
- declare the owner Spec and requirement IDs;
- preserve `runtime_authority=false` where the phase is shadow or schema-only;
- include deterministic tests and evidence;
- declare migration, deployment, provider, and secret impact;
- provide rollback and readback criteria;
- remain fresh against its base before merge.

## Persistence strategy

Use expand/migrate/contract:

1. reuse current execution, receipt, audit, and outbox surfaces where contracts are sufficient;
2. add schema only when a required invariant cannot be represented safely;
3. validate migrations statically and against a production-compatible engine;
4. dual-write or shadow-compare before authority cutover;
5. backfill with bounded resumable operations and reconciliation;
6. remove legacy persistence only after measured zero dependency and rollback proof.

## Runtime strategy

- preserve all legacy call paths initially;
- introduce one framework-independent `DispatchGovernedOperation` boundary;
- create Execution Capsules beside existing resolution before consuming them;
- compare descriptor, context, authority, approval, consequence, and readback vectors in shadow;
- cut over selected reads before mutations;
- enable graph concurrency first for read/preparation branches;
- add exact approval frontier before any multi-step mutation continuation;
- separate authoritative ledger completion from optional projections only after payload/order/hash parity;
- pilot fast and durable mutations independently;
- publish public execution operations only after internal certification;
- retire compatibility only through a later reviewed contract change.

## Benchmark strategy

X0 records matched fixtures for:

- exact single read;
- intent single read;
- reversible single mutation;
- six-step mixed graph;
- repository task to PR and CI handoff;
- durable external wait;
- projection-heavy session;
- cross-tenant and stale-authority negative cases.

Every later benchmark must retain the same principal, context, descriptor, provider fixture, authority, approval, input, result, readback, receipt, audit, and projection obligations.

## Rollout strategy

Rollout R0–R10 is detailed in `rollout-migration-compatibility-and-rollback.md` and progresses through:

- instrumentation;
- no-dispatch shadow;
- internal read cohort;
- read/preparation DAG;
- approval-frontier pilot;
- projection shadow;
- reversible low-risk mutation;
- durable operation;
- public schema and selected execution cohort;
- percent expansion;
- closeout and separately governed retirement.

Each expansion requires:

- no unresolved safety mismatch;
- passing rollback drill;
- exact-head CI;
- current base and deployment evidence where applicable;
- no increase in duplicate mutation, cross-tenant access, stale approval, unknown-outcome replay, or missing readback.

## Closeout

The final closeout PR must record:

- all merged implementation PRs and SHAs;
- migrations, checksums, engine evidence, ledger runs, and schema readback where applicable;
- deployment and Production SHAs where applicable;
- benchmark artifacts and safety equality results;
- shadow mismatch disposition;
- fault-injection, restart, disconnect, and rollback results;
- projection reconciliation evidence;
- compatibility usage and retirement state;
- final owner-Spec and integration traceability.
