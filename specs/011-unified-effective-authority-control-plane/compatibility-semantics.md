# Connector Readiness Compatibility Semantics

## Purpose

This document defines the backward-compatible meanings of the legacy connector readiness terms `active`, `connected`, and `ready` for the Unified Effective Authority Control Plane (UEACP).

These terms are derived compatibility projections. They are not independent sources of authority and must never override the canonical readiness dimensions, blocked reason codes, source revisions, or code-level safety invariants.

## Canonical readiness dimensions

The canonical connector readiness record evaluates these dimensions independently:

- registry status
- authorization status
- configuration status
- installation status
- credential status
- connectivity status
- certification status
- freshness status
- execution readiness

Consumers that can read the dimensional record must use it directly. The compatibility terms exist only for legacy consumers that cannot yet consume the dimensional contract.

## `active`

`active` means the connector is present in the authoritative registry and its registry lifecycle status permits consideration.

`active=true` does not mean that the connector:

- is authorized for the current actor or subject;
- has valid configuration or credentials;
- is installed or reachable;
- is certified;
- is fresh;
- may execute an operation.

A missing, unknown, disabled, revoked, deleted, or conflicting registry status projects to `active=false`.

## `connected`

`connected` means current bounded connectivity evidence classifies the connector as connected for the evaluated scope.

`connected=true` does not mean that the connector:

- is authorized for the requested capability or operation;
- is correctly configured for every operation;
- has current certification;
- is fresh enough for execution;
- is execution-ready.

A missing, unknown, stale, failed, unreachable, or conflicting connectivity result projects to `connected=false`.

## `ready`

`ready` means the canonical `execution_readiness` result is `ready` for the evaluated scope and operation, and every dimension required by that connector and operation is affirmative.

Required dimensions may include:

- registry status permits consideration;
- authorization is granted;
- configuration is valid;
- required installation is present;
- required credential evidence is available and valid;
- connectivity is connected;
- required certification is valid;
- evidence freshness is acceptable;
- no blocking reason code remains.

A missing, unknown, stale, degraded, blocked, conflicting, or unevaluated required dimension projects to `ready=false`.

## Compatibility implications

The compatibility projection obeys these implications:

```text
ready=true  => active=true
ready=true  => connected=true
active=true !=> connected=true
active=true !=> ready=true
connected=true !=> active=true
connected=true !=> ready=true
```

`connected=true` with `active=false` is possible when external connectivity evidence exists for a registry record that is no longer eligible. This state must remain non-executable and should surface a blocked or drift reason.

## Projection and authority rules

1. Compatibility fields are computed from the same evaluated readiness record as the dimensional fields.
2. Compatibility fields must not be persisted back as authoritative status.
3. Compatibility fields must not broaden actor, subject, tenant, workspace, resource, capability, operation, endpoint, certification, or credential scope.
4. Compatibility fields must not suppress blocked reason codes or dimensional evidence.
5. Unknown, missing, stale, conflicting, or invalid evidence fails closed.
6. `ready=true` never grants execution authority by itself. Execution still requires the current effective-authority decision, manifest binding, approval or delegation evidence where required, idempotency controls, and same-cycle critical revalidation.
7. Legacy consumers may display compatibility fields, but enforcement and new projections must use the canonical dimensional contract.
8. No compatibility projection may read or expose credential payloads, tokens, keys, or provider authentication bodies.

## Source-of-truth precedence

When a compatibility field conflicts with dimensional evidence, the dimensional evidence and blocked reason codes win. The compatibility field must be recomputed and the mismatch should be treated as projection drift.

Precedence is:

```text
code-level safety invariants
> current effective-authority decision and version evidence
> canonical readiness dimensions and blocked reason codes
> derived compatibility fields
```

## Examples

| Registry | Connectivity | Other required dimensions | Compatibility result |
|---|---|---|---|
| active | connected | all affirmative | `active=true`, `connected=true`, `ready=true` |
| active | connected | certification expired | `active=true`, `connected=true`, `ready=false` |
| active | unreachable | otherwise affirmative | `active=true`, `connected=false`, `ready=false` |
| revoked | connected | otherwise affirmative | `active=false`, `connected=true`, `ready=false` |
| unknown | unknown | unevaluated | all compatibility fields are `false` |

## Migration rule

Legacy consumers may continue reading `active`, `connected`, and `ready` during migration. New consumers must read the canonical dimensions. Removal of the compatibility fields requires measured consumer migration, parity evidence, rollback readiness, and an explicitly approved cutover.
