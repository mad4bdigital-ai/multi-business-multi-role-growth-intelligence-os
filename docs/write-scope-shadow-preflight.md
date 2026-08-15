# Write Scope Shadow Preflight

## Purpose

This contract implements the first executable stage of the governed Write Scope lifecycle. It evaluates the catalogued Write Scopes in a deterministic **Staging/Shadow** mode and emits evidence without executing a provider mutation, database write, migration, external send, credential payload read, or Production activation.

> A shadow receipt proves that the governance decision can be evaluated and audited; it does not authorize a live mutation.

## Current boundary

The runner consumes the generated Remote MCP scope catalog and the read-only write-scope inventory. It requires `write_activation_allowed=false`, `provider_mutation_allowed=false`, `production_allowed=false`, `migration_apply_allowed=false`, and `secrets_included=false`. Every catalogued scope must remain `status=shadow`, `default_request=false`, and unbound until a later governed promotion step.

The current run covers all **six catalogued Write Scopes** and **38 classified route references**. Each scope receives a `deny_shadow_execution` preflight decision. The receipt records the required resource authority, approval, capability envelope, execution lease, same-cycle readback, and kill-switch prerequisites, while explicitly recording that execution was never attempted.

## Evidence produced

The deterministic artifact is `docs/write-scope-shadow-evidence-2026-08-15.json`. It contains the catalog and inventory fingerprints, scope-level route evidence, preflight decisions, execution effects, rollback plan state, audit receipt shape, and fail-closed safety flags. The artifact is regenerated with `npm run write-scopes:shadow` and checked with `npm run write-scopes:shadow:check`.

The rollback section is deliberately **plan-only** at this stage. It proves that rollback is required and that a rollback plan is represented, but it records `compensation_executed=false` and `rollback_executed=false` because no mutation has occurred.

## Commands

```bash
node scripts/write-scope-shadow-preflight.mjs
node scripts/write-scope-shadow-preflight.mjs --check
node scripts/test-write-scope-shadow-preflight.mjs
```

These commands are local governance checks only. They do not connect to a provider, apply a migration, write to a database, send an external request, activate Production, or enable a Write Scope.

## Promotion prerequisites

A later promotion proposal must add explicit resource-operation bindings, live resource authority, approval evidence, capability-envelope evidence, an execution lease, same-cycle schema/data readback, durable audit receipt reconciliation, rollback rehearsal evidence, a kill switch, and independent Owner attestation. Until those gates are separately approved, `write_activation_allowed` and all provider/database mutation flags remain false.
