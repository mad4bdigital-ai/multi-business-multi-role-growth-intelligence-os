# Implementation Quickstart

## 1. Current status

This branch contains specification artifacts only. Do not run migrations, seed runtime registries, connect providers, or deploy from this branch.

## 2. Read order

1. `.specify/memory/constitution.md`
2. `docs/spec-kit-governance.md`
3. this specification `README.md`
4. `research.md`
5. `spec.md`
6. `concerns.md`
7. `operation-paths.md`
8. `plan.md`
9. `data-model.md`
10. contracts and checklists
11. `tasks.md`

## 3. Prepare an implementation slice

For each implementation PR:

1. synchronize a new branch from current `main`;
2. identify the exact task IDs and requirements;
3. run interruption readiness;
4. inspect current files again because this is a fast-moving brownfield repository;
5. create a scoped implementation manifest or evidence file under this spec;
6. implement the smallest additive slice;
7. update canonical sources, not generated outputs directly;
8. run targeted and required CI;
9. record head/base SHA, migrations, feature flags, rollout, rollback, and unresolved gaps.

Suggested readiness command:

```bash
cd http-generic-api
npm run readiness:interruptions
```

## 4. Contract validation

The draft contracts are specification inputs. Before exposing routes:

```bash
cd http-generic-api
npm run schemas:guard
npm run frontend:dispatch:check
```

Add a Spec 014 contract-baseline test that parses:

- `contracts/retail-commerce-operations.openapi.yaml`;
- `contracts/commerce-events.schema.json`;
- `contracts/commerce-provider-adapter.schema.json`.

The test must assert OpenAPI 3.1, JSON Schema 2020-12, stable operation IDs, no secret-like examples, and draft-only/non-runtime classification until the route PR.

## 5. First recommended code slice

Start with domain policy only:

```text
src/domain/commerce/errors.js
src/domain/commerce/inventoryStateMachine.js
src/domain/commerce/reservationPolicy.js
src/domain/commerce/paymentStateMachine.js
src/domain/commerce/offlineAllocationPolicy.js
src/infrastructure/commerce/adapters/commerceAuthorityAdapter.js
```

Add deterministic unit tests. Do not add SQL or public routes in the first slice.

## 6. Database slice rules

Before any migration:

- finalize table and index names;
- review the latest migration numbering and lifecycle registry;
- dry-run with the governed migration runner;
- ensure tenant/workspace leading keys;
- define collation and identifier contracts;
- register lifecycle, owner, backup, retention, and rollback;
- keep migration additive and feature disabled.

Do not edit production or apply migrations merely because this specification exists.

## 7. Context Kernel slice

Add Commerce Context repository ports and read-only resolution first. Verify:

- one backend/domain binding;
- tenant/workspace membership;
- brand/location/channel constraints;
- resource authority;
- context revision/hash;
- no caller override;
- no tenant-specific branches.

Mutation implementation begins only after context parity tests pass.

## 8. Reservation pilot

The first behaviorally meaningful pilot is unique-item reservation in `platform_native` sandbox mode.

Required evidence:

- two concurrent attempts, one success;
- same idempotency key, same result;
- changed payload, conflict;
- stale expected version, conflict;
- expired reservation, one release;
- transaction rollback leaves no reservation or Outbox row;
- commit writes domain state and Outbox;
- cross-tenant and wrong-location rejection;
- safe operation readback.

## 9. ERPNext adapter pilot

Do not begin with production credentials.

1. create provider profile and adapter manifest in fixture/sandbox state;
2. implement readiness and read-only product/inventory methods;
3. implement custom Frappe atomic reservation if required;
4. run adapter contract suite;
5. verify normalized conflict and unknown-outcome behavior;
6. mark behaviorally certified only from sandbox evidence;
7. keep provider execution disabled until separate enablement.

## 10. Frontend development

The HTML demos are reference artifacts, not files to copy into production unchanged.

Build RetailOS modules under the governed `/platform` surface. Use:

- shared design tokens;
- same-origin API;
- fail-closed surface policy;
- no service keys in browser;
- Arabic RTL and English locale dictionaries;
- exact API state labels;
- mobile/tablet/desktop viewport tests;
- production-disabled QA Sandbox.

## 11. Provider and worker development

Every worker must have:

- SQL/Outbox source of truth;
- deterministic claim identity;
- bounded concurrency;
- retry classification;
- dead letter;
- health/lag metrics;
- no-secret logs;
- replay-safe provider identity;
- readback when outcome can be unknown.

## 12. Completion evidence

A slice is not complete at transport success. Record:

- validation state;
- execution state;
- delivery state;
- provider acknowledgement/readback;
- compensation/rollback state;
- production deployment parity when deployed.

Update `completion.json` only from authoritative evidence.
