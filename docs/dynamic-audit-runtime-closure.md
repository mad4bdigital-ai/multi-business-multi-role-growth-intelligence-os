# Dynamic Audit Runtime Closure

This workstream closes the governed Dynamic Audit runtime pipeline with an additive scheduler ledger, bounded evidence producers, explicit event lifecycle, readiness checks, and checkpoint readback.

Safety boundaries:
- no MySQL triggers;
- no raw provider payloads;
- no credential or secret values;
- no inferred deployed commit SHA;
- no public API contract change.

## Runtime performance controls

The recurring audit bridge advances a durable `last_audit_log_id` cursor stored in
`platform_runtime_config`, so each cycle uses a primary-key range instead of
rescanning the complete audit history. Rollups select only indexed
`observed`/`pending_rollup` rows; idempotent target writes remain the duplicate
protection boundary before events transition to `rolled_up`.

The scheduler uses a lightweight runtime-readiness query for every cycle. The
full JSON evidence-quality view remains an explicit deep-audit surface and is
not executed inside the five-minute critical path. Setting the scheduler config
`enabled=false` causes both startup and already-scheduled cycles to skip before
acquiring a lock or writing evidence.

At startup, the scheduler performs a bounded INSERT-authority probe against
`dynamic_audit_scheduler_runs` inside a transaction and rolls the probe back.
`ER_TABLEACCESS_DENIED_ERROR`, `ER_ACCESS_DENIED_ERROR`, and equivalent database
access-denied outcomes are classified as `write_authority_unavailable`; the
interval is not created, the warning is emitted once, and the result contains
`started=false`, `reason=write_authority_unavailable`, and
`secrets_included=false`. If the same failure appears during a cycle, the cycle
returns `ok=false`, `skipped=true`, stops the scheduler handles, and later cycles
short-circuit without repeating the denied write. This behavior does not grant,
migrate, deploy, or restart Production.
