# Phase 1H Implementation — Guarded Code Contract Fallback

## Purpose

Implement task T301: retain the legacy in-code operation contract registry as a temporary migration fallback behind an explicit operational kill switch, while keeping SQL as the primary authority.

## Resolution order

1. Attempt the Phase 1G SQL runtime contract loader.
2. Return the SQL contract immediately on success without consulting the fallback switch or code registry.
3. Classify SQL failures.
4. Consider fallback only for a missing SQL contract during migration or an explicitly recognized SQL availability outage.
5. Reject fallback for revision, identity, lifecycle, status, step-count, validation, or other integrity failures.
6. Require the registered `operation_contract_code_fallback` switch action to exist and remain open.
7. Resolve only version 1 contracts from `operationContractRegistry.js`.
8. Return a deeply frozen, revision-digested legacy contract with explicit fallback evidence.

## Kill switch

The new environment switch is:

`CAPABILITY_KILL_SWITCH_OPERATION_CONTRACT_CODE_FALLBACK`

The action is read-only and therefore reports `mutation=false`, but it is explicitly switch-gated. When the switch is enabled, code fallback is blocked with a stable 503 error while SQL-primary loading remains unaffected.

## Failure policy

Fallback-eligible classes:

- `operation_runtime_contract_not_found` as a migration gap;
- recognized transient SQL/network failures;
- explicit dependency status 503 or 504.

Fail-closed classes include semantic revision mismatch, identity mismatch, lifecycle blocking, status mismatch, invalid step count, malformed readback, invalid input, and unknown implementation errors.

## Result boundary

Both SQL and fallback responses are discriminated by `resolution_source` and `contract_kind`. Fallback responses state that SQL remains primary and legacy code authority is temporary. They perform no database write, provider call, external write, runtime activation, dispatch, or secret read.

## Testing

Tests prove SQL-first behavior, migration-gap fallback, transient-outage fallback, kill-switch denial, no fallback on integrity errors, version restriction, missing static contract handling, policy registration checks, immutable fallback contracts, and input rejection before resolution.

## Scope boundaries

This phase introduces no migration, seed, route, OpenAPI change, cache write, dispatcher integration, capability acquisition, runtime activation, provider call, deployment, or merge. The fallback remains temporary migration support and is not a replacement for SQL authority.
