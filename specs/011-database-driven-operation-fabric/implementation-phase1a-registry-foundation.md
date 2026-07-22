# Phase 1A Implementation — Operation Registry Foundation

## Purpose

Implement the first additive persistence slice of Spec 011 without activating runtime resolution or applying a database migration. This slice establishes the versioned operation, operation-step, and execution-binding contracts needed by the Database-Compiled Binding Graph.

## Files

- `http-generic-api/migrations/20260723_operation_registry_foundation.sql`
- `http-generic-api/test-operation-registry-foundation.mjs`
- `http-generic-api/scripts/test-manifest.mjs`

## Authority boundaries

The new registries are orchestration metadata only.

- `operation_registry` defines versioned operation contracts.
- `operation_step_registry` defines ordered or DAG step contracts.
- `operation_execution_bindings` stores selectors that reference existing capability, endpoint-export, dispatch-binding, resource-authority, credential-scope, approval, and readback authorities.
- `v_operation_registry_foundation` provides bounded non-secret readiness readback.

The migration does not duplicate provider URLs, credentials, endpoint schemas, or executable transport configuration.

## Lifecycle posture

All new rows default to `draft`. No seed rows are introduced, so the migration cannot activate an operation, binding, runtime, or GPT tool by itself.

Activation and revision immutability remain future service-layer work. A later slice must validate referenced handler, capability, dispatch, export, policy, and resource-authority keys before promoting a row from `shadow` to `active`.

## Validation

The contract test verifies:

- all three tables and the bounded readback view exist in the migration;
- version, step, and binding uniqueness constraints are present;
- operation foreign keys and resolution indexes are present;
- the execution binding references existing platform authority keys;
- readback is required by default;
- the migration contains additive DDL only;
- no secret-bearing or provider-transport fields are introduced;
- explicit no-provider, no-external-send, and no-secret safety markers are present.

## Rollback and disable-first posture

Before production application, the governed migration plan must include:

1. schema validation in an isolated database;
2. same-cycle table, index, foreign-key, and view readback;
3. zero-row verification after apply;
4. disable-first rollback by preventing registry writes and reads;
5. explicit reviewed removal SQL only while the tables remain unused and empty.

No migration application, database write, runtime activation, deployment, or merge is performed by this implementation branch.

## Follow-up

The next slice should add repository access and deterministic compilation logic, including strict JSON Schema validation, ambiguity rejection, revision hashing, and immutable compiled manifest persistence. Runtime projection and tool export remain out of scope until registry and compiler tests pass in shadow mode.
