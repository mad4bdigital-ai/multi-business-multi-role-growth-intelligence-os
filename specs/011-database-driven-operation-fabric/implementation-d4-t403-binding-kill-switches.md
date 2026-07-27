# D4 T403 Implementation — Adapter and Runtime Kill Switches

## Purpose

Implement Spec 011 task T403 as an operational, fail-closed kill-switch policy for operation-binding adapters and runtimes. The policy is evaluated before T401 scoring and T402 fallback planning, so a disabled adapter or runtime becomes a T400 hard exclusion.

## Configuration authority

The policy reuses the repository's existing environment-based kill-switch convention and accepts four variables:

- `OPERATION_BINDING_KILL_SWITCH_ALL_ADAPTERS`;
- `OPERATION_BINDING_KILL_SWITCH_ALL_RUNTIMES`;
- `OPERATION_BINDING_KILL_SWITCH_ADAPTER_KEYS`;
- `OPERATION_BINDING_KILL_SWITCH_RUNTIME_KEYS`.

Global variables use the existing capability kill-switch boolean parser. Target lists are comma-separated exact keys, bounded to 500 entries and 50,000 characters. Keys are normalized, deduplicated, sorted, and validated against the same safe-key form used by the binding compiler. Empty or malformed list entries fail with a typed 503 configuration error instead of being ignored.

## Hard exclusions

A matched adapter adds `adapter_kill_switch_enabled`. A matched runtime adds `runtime_kill_switch_enabled`. If both match, both deterministic reason codes are preserved. Kill switches are evaluated independently of health, capacity, cost, reliability, preference, or fallback rank.

## Revision authority

The resolved kill-switch policy has a deterministic SHA-256 hash. The eligibility report exposes only this policy hash and bounded counts, never raw environment values. The compiler includes the policy hash in `source_revision_hash`, so changing a kill switch invalidates an older compiled source revision even when registry rows are unchanged.

## Security and authority boundary

The policy reads no credential payload and never returns environment values. Snapshot output contains global booleans, target counts, target-list hashes, environment variable names, and the policy hash. A kill-switch decision only removes candidates. It cannot create a candidate, restore an excluded candidate, select a candidate, authorize dispatch, execute fallback, call a provider, perform an external write, or change runtime activation.

## Scope boundaries

T403 adds application policy, eligibility integration, compiler revision evidence, focused tests, and documentation only. It adds no migration, route, OpenAPI change, database write, provider call, credential read, external write, deployment, merge, or runtime activation.
