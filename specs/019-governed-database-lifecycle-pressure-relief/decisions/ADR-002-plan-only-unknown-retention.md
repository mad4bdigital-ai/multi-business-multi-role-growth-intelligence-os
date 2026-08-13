# ADR-002 — Unknown Retention Is Plan-Only

## Decision

When a resource lacks an approved retention/archive policy or its semantics cannot be proven, the planner returns a structured blocked/plan-only result and the executor remains disabled.

## Rationale

Age alone is not a safe retention rule for execution payloads, audit lineage, sessions, or regulatory logs. The response-chunk TTL case is not a general permission to delete other domains.

## Consequence

`platform_engine_execution_runs`, session/transcript records, and audit-sensitive resources require separate domain review and preservation/restore contracts before mutation.
