# Phase 4 — Reconciliation and Readback Wave

## Delivery scope

This wave completes T160–T166 as one integrated reconciliation layer. It composes existing repository, execution-ledger, migration, deployment, and provider readback primitives behind one deterministic outcome contract.

## Reuse-first architecture

The wave does not replace existing reconcilers. It provides a composition kernel around:

- the Context Kernel unknown-outcome reconciliation service;
- the repository reconciliation orchestrator and its lease/readback contracts;
- governed migration ledger and schema-readiness collectors;
- deployment/runtime parity projections;
- provider-specific readback adapters;
- durable receipts and idempotency boundaries from Phase 1.

## Canonical outcomes

Every reconciled mutation is classified as exactly one of:

- `confirmed_success` — required readbacks prove the expected state;
- `confirmed_failure` — required readbacks prove that the mutation was not applied;
- `unknown_outcome` — dispatch may have occurred but evidence is inconclusive;
- `reconciliation_required` — evidence is missing, incomplete, stale, or conflicting.

Narrative, HTTP status, or transport failure alone cannot prove provider outcome.

## Read-before-retry

A prior `unknown_outcome` or `reconciliation_required` result blocks retry. Retry becomes eligible only when all required readback sources prove absence and the caller presents a stable idempotency key. The kernel never performs an automatic retry itself.

## Reconciliation domains

### Repository and pull request

Compares repository refs and pull-request state with expected head/base bindings. Existing repository orchestration remains the mutation authority; this adapter is read-only.

### Migration schema and ledger

Compares engine schema evidence with the governed migration ledger, including checksum/status parity. Static validation is not treated as apply evidence.

### Deployment and production parity

Compares deployment metadata with runtime readback. A deployment receipt without runtime parity remains incomplete.

### Provider adapter

Compares provider state with the internal mutation ledger through injected provider-specific inspection ports. No provider write is exposed by the reconciliation kernel.

## Duplicate-mutation fault injection

The certification injects a transport failure after the first mutation has been applied. The outcome remains unknown until readback. Because reconciliation proves the mutation exists, the retry gate remains closed and the applied count stays exactly one.

## Safety boundaries

- no public route is added;
- no Production migration is applied;
- no Production database or provider write is performed;
- reconciliation adapters are read-only and fail if they report mutation;
- evidence containing secret-like fields is rejected;
- readbacks and evidence are bounded and fingerprinted;
- automatic retry is always false;
- existing repository, migration, deployment, and provider authorities remain authoritative.

## Completion mapping

| Task | Evidence |
|---|---|
| T160 | deterministic canonical outcome classifier |
| T161 | `assertReadBeforeRetry` absence-proof gate |
| T162 | repository/PR reconciler adapter |
| T163 | migration schema/ledger reconciler adapter |
| T164 | deployment/runtime parity reconciler adapter |
| T165 | provider/internal-ledger adapter contract |
| T166 | post-apply transport-failure duplicate-mutation certification |
