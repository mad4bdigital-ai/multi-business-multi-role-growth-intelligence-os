# Platform Adapter Contract Kernel

## Purpose

T030 adds adapter binding, certification, deterministic selection, readback contract, execution evidence, and drift classification contracts.

This PR is intentionally contract-only. It does not call providers, mutate external systems, persist locks, execute migrations, or cut over enforcement.

## Adapter binding

An adapter binding describes the adapter key, provider key, capability, boundary, resource type, supported operations, certification requirements, readback contract hash, drift policy hash, and priority.

All bindings force `provider_apply_allowed: false`, `mutation_allowed: false`, `enforcement_cutover: false`, and `secrets_included: false`.

## Certification

Certification revalidates the T023 concurrency control before marking a binding as `certified_contract_only`. Certification verifies the binding hash, concurrency readiness, readback contract presence, drift policy presence, and no-provider-apply boundaries.

## Deterministic selection

Selection filters bindings by capability, boundary, and resource type, then sorts by priority, adapter key, and binding hash. The selection returns a stable selection hash and never executes the selected adapter.

## Readback and drift

Readback contracts bind a resource reference, expected state, and readback fields. Evidence must include the contract hash and observed state. Drift classification compares observed state with expected state and returns either `adapter_drift_none` or `adapter_drift_detected`.

## Non-goals

This PR does not implement provider adapter execution, external writes, persistence, migration execution, canary enforcement, production rollout, or pilot execution. T040+ pilot work remains blocked until these contracts are connected to safe runtime surfaces in a later PR.
