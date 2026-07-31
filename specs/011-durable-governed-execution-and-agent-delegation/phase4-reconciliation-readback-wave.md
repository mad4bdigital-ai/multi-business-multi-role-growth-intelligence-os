# Phase 4 — Reconciliation and Readback Wave

## Scope

This wave implements Spec 011 tasks T160–T166 as one reusable, read-only reconciliation layer. It composes existing repository, migration, deployment, provider, durable-receipt, idempotency, and Context Kernel readback primitives. It does not create a parallel mutation authority.

## Canonical outcomes

Every mutation outcome is classified as exactly one of:

- `confirmed_success`: every required source proves the expected state;
- `confirmed_failure`: every required source proves absence of the mutation;
- `unknown_outcome`: dispatch may have occurred but readback is inconclusive;
- `reconciliation_required`: evidence is missing, incomplete, stale, cross-operation, or conflicting.

HTTP status, transport failure, receipt lifecycle status, and narrative are not sufficient outcome evidence.

## Same-operation evidence

Recovered success and proven absence require verified evidence bound to the same operation ID. Evidence produced for another operation cannot close the current mutation and cannot authorize a retry. Optional observers do not change the required-source quorum.

## Read-before-retry

A prior `unknown_outcome` or `reconciliation_required` blocks replay. Retry eligibility requires:

1. a stable idempotency key;
2. `confirmed_failure` reconciliation;
3. completed absence proof from every required source;
4. verified same-operation evidence.

The kernel returns a decision only. It never performs an automatic retry.

## Reconciliation domains

### Repository and pull request

Compares repository refs and pull-request state against expected head/base and PR bindings. Existing repository orchestration remains mutation authority.

### Migration schema and ledger

Compares engine schema evidence with the governed migration ledger. Static validation is not treated as apply evidence.

### Deployment and runtime parity

Compares deployment metadata with runtime readback. A deployment receipt without runtime parity remains incomplete.

### Provider and internal ledger

Compares provider state with the internal mutation ledger through injected provider-specific inspection ports. No provider write is exposed.

## Duplicate-mutation certification

Fault injection applies the first mutation and then simulates transport failure. Reconciliation proves the mutation exists, the retry gate remains closed, and the applied count remains exactly one.

## Safety boundaries

- no public route;
- no Production migration or database write;
- no provider dispatch or external write;
- no runtime authority change;
- read-only adapters reject any reported mutation;
- secret-like fields are rejected;
- evidence is deterministic and fingerprinted;
- automatic retry remains false.

## Task mapping

| Task | Delivery |
|---|---|
| T160 | Canonical deterministic outcome classifier |
| T161 | Same-operation read-before-retry gate |
| T162 | Repository and pull-request reconciler |
| T163 | Migration schema and ledger reconciler |
| T164 | Deployment and runtime parity reconciler |
| T165 | Provider and internal-ledger reconciler contract |
| T166 | Post-apply transport-failure duplicate-mutation certification |
