# UEACP Shadow Reconciliation Runbook

## Purpose

The Unified Effective Authority Control Plane reconciliation loop compares registered, authorized, projected, and executable-candidate connector counts for active platform and tenant authority scopes.

The reconciler is diagnostic and non-authoritative. It does not grant execution authority, call providers, read credential payloads, or perform external writes.

## Default State

The scheduler is disabled by default.

```text
UEACP_RECONCILIATION_ENABLED=false
UEACP_RECONCILIATION_PERSIST=false
UEACP_SHADOW_EVIDENCE_MODE=disabled
```

With the default configuration, server startup reports the scheduler as disabled and creates no interval timer.

## Configuration

| Variable | Default | Bounds or values | Meaning |
| --- | --- | --- | --- |
| `UEACP_RECONCILIATION_ENABLED` | `false` | boolean | Enables the periodic scheduler. |
| `UEACP_RECONCILIATION_INTERVAL_SECONDS` | `900` | 300–86400 | Reconciliation interval. |
| `UEACP_RECONCILIATION_LIMIT` | `50` | 1–200 | Maximum authority scopes per tick. |
| `UEACP_RECONCILIATION_RUN_ON_START` | `false` | boolean | Runs one tick immediately after scheduler startup. |
| `UEACP_RECONCILIATION_PERSIST` | `false` | boolean | Requests internal shadow evidence persistence. |
| `UEACP_SHADOW_EVIDENCE_MODE` | `disabled` | `disabled`, `best_effort`, `required` | Controls decision and drift ledger persistence. |

Persistence requires both `UEACP_RECONCILIATION_PERSIST=true` and an evidence mode other than `disabled`. A persist request with disabled evidence fails closed.

## Safety Invariants

Every reconciliation result preserves these invariants:

- `authority_granted=false`
- `enforcement_mode=shadow_only`
- `legacy_runtime_authoritative=true`
- `execution_authority_changed=false`
- `provider_calls=false`
- `credential_payload_reads=false`
- `external_writes=false`
- `secrets_included=false`

The scheduler prevents overlapping ticks. A second tick started while one is active returns `overlap_prevented`.

## Rollout Sequence

1. Keep the scheduler disabled while migrations are pending.
2. Apply the governed UEACP capability and shadow-ledger migrations with checksum-bound authorization and same-cycle readback.
3. Enable preview scheduling only: `UEACP_RECONCILIATION_ENABLED=true`, `UEACP_RECONCILIATION_PERSIST=false`.
4. Review drift issue codes and count invariants for platform and tenant scopes.
5. Enable `best_effort` persistence only after the ledger schema is verified.
6. Do not enable required persistence or any enforcement cutover until shadow parity and release readiness are approved.

## Operational Signals

Structured startup and tick events:

- `ueacp_reconciliation_scheduler_start`
- `ueacp_reconciliation_scheduler_start_failed`
- `ueacp_reconciliation_tick`
- `ueacp_reconciliation_tick_failed`

Logs include status, mode, bounded summaries, and error codes only. They do not include manifests, principal identifiers, credential material, or secret values.
