# Phase 3 Slices G–H — Delegation MariaDB Certification and Runtime Binding

## Purpose

Close the implementation gap between the Slice F injected MariaDB adapter contract and a certifiable runtime binding without weakening migration, authorization, receipt, or readback governance.

This slice does not authorize a production migration by repository merge. It adds the machinery to prove the migration and lifecycle against a disposable MariaDB engine, collect live production readiness through metadata-only queries, and bind the existing adapter behind explicit default-off runtime gates.

## Reuse decisions

The implementation reuses:

- `20260725_agent_delegation_grant_persistence_contract.sql` as the only canonical delegation migration;
- `scripts/governed-migration-runner.mjs` for preflight, checksum, statement execution, and governed ledger persistence;
- `governed_migration_authorization_registry` for migration authorization;
- `governed_migration_ledger` for apply evidence;
- `agent_delegations` as the grant authority;
- `repository_automation_receipts` as the mutation receipt authority;
- `delegationGrantRepositoryMutationService.js` for transactional create, revoke, expire, idempotency, and same-cycle readback;
- the Slice F MariaDB repository adapter without introducing a second repository or persistence surface.

No new database table, public route, OpenAPI operation, provider adapter, or parallel delegation store is introduced.

## Slice G — Engine and migration certification

`delegationGrantMariaDbReadinessCollector.js` computes the repository migration checksum and statement count, then performs metadata-only readback of:

- the exact `apply` ledger entry;
- required tables, columns, indexes, and effective view;
- storage engine, schema character set, collation, strict SQL mode, JSON support, MariaDB/MySQL version, and transaction isolation;
- additive migration preflight and rollback safety while runtime binding remains disabled.

The collector delegates the final decision to `evaluateDelegationGrantMariaDbReadiness`. Missing, stale, ambiguous, or checksum-mismatched evidence remains blocked.

The dedicated GitHub Actions certification workflow starts MariaDB 11.4, bootstraps only the pre-existing base tables and governance registries, authorizes the migration only inside the disposable schema, and invokes the canonical governed migration runner with the exact typed confirmation. It then proves actual CHECK-constraint enforcement and emits a bounded JSON artifact.

Disposable authorization never implies production authorization.

## Slice H — Certified runtime binding

`delegationGrantMariaDbRuntimeBinding.js` exposes an internal binding only. Execution requires all of the following in the same process:

- `DELEGATION_GRANT_MARIADB_RUNTIME_ENABLED=true`;
- `DELEGATION_GRANT_MARIADB_RUNTIME_CERTIFIED=true`;
- an exact `DELEGATION_GRANT_MARIADB_EXPECTED_MIGRATION_SHA256` pin;
- an action allowlist containing the requested `create`, `revoke`, or `expire` action;
- fresh live readiness with exact checksum match;
- the existing typed authorization, resource-authority reference, approval hold, and request fingerprint;
- the existing pending-receipt-before-mutation and same-cycle grant/receipt readback contract.

The binding is not mounted on Express and does not create a public route. It never sets `runtime_policy_ready = 1`; effective dispatch authority remains a separate later certification decision.

## Live lifecycle certification

The disposable certification performs real MariaDB transactions for:

1. create and same-cycle grant/receipt readback;
2. revoke with expected active grant hash and readback;
3. a second create followed by expire and readback;
4. receipt reconciliation for every mutation;
5. confirmation that every persisted row retains `runtime_policy_ready = 0`.

The create contract hashes the persisted active canonical grant rather than the preview-state grant, so later revoke or expire optimistic hash checks bind to the actual stored authority.

## Production cycle

`scripts/delegation-mariadb-production-cycle.mjs` supports:

- `status`: metadata-only readiness collection;
- `dry-run`: canonical governed runner preflight without SQL apply;
- `apply`: exact typed confirmation, capability-envelope UUID, DB authorization registry, governed runner apply, ledger persistence, and same-cycle readiness certification.

Production apply additionally requires `DELEGATION_MARIADB_PRODUCTION_APPLY_MODE=authorized`. The script refuses disposable database names. Merge, CI, or disposable certification cannot satisfy this production gate.

## Completion boundary

After this PR:

- engine and lifecycle behavior can be certified on disposable MariaDB;
- production readiness can be inspected without mutation;
- production apply can run only with separately supplied live credentials and checksum-bound authorization;
- the internal runtime binding exists but remains default-off in normal runtime configuration;
- `runtime_policy_ready` remains false;
- T141 remains open until a governed production apply and certified production mutation/readback cycle are recorded, followed by any separately approved runtime exposure.
