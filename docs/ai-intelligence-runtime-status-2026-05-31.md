# AI Intelligence Runtime activation status — 2026-05-31

## Summary

The AI Intelligence Runtime & Governance Layer foundation is active for planning, decision briefs, database lifecycle review, repo conflict readiness, and audit evidence. It is not active for direct mutation or destructive execution.

## Activated surfaces

- Platform engine registry and policies
- Repository conflict planning
- Database table lifecycle registry
- Database lifecycle reporting views
- Database lifecycle report snapshot foundation
- Tool search from governed `agent_tool_index`
- Growth/retention dry-run review engines
- Credential lifecycle metadata review
- Backup snapshot dry-run review
- Recovery failure taxonomy registry
- Validator result log foundation

## Verified dry-run paths

### Repository conflict

`repo_conflict_resolution_engine` has been verified for:

- `http-generic-api/package.json` package JSON conflict planning
- medium-risk `json_script_insert` strategy
- de-duplicated validators
- apply-readiness envelope with `will_execute=false`
- migration SQL conflicts routed to `manual_only`

### Database lifecycle

`database_table_lifecycle_engine` has been verified for:

- `database:*` dry-run planning
- lifecycle reporting views
- audit writeback
- `runtime_unclassified = 0`

### Growth and retention

Dry-run review paths have been verified for:

- `session_events` through `session_memory_lifecycle_engine`
- `telemetry_spans` through `observability_lifecycle_engine`
- `json_assets` through `platform_graph_memory_lifecycle_engine`
- repair backup snapshots through `repair_archive_engine`
- `api_credentials` through `credential_governance_engine`

## Current lifecycle report highlights

Growth hotspots include:

- `session_events`
- `json_assets`
- `gpt_session_turns`
- `platform_graph_nodes`
- `execution_log`
- `telemetry_spans`
- `platform_graph_edges`
- `audit_log`

High-risk review surfaces include:

- backup snapshots
- credential registries/placeholders
- session memory logs
- observability logs
- platform graph canonical memory

## Explicit non-goals in this phase

The following remain intentionally unavailable:

- direct repo apply executor
- database drop/truncate/delete
- archive execution
- credential value reads
- model-executed tools
- tenant-exposed admin engine routes

## Next recommended work

1. Wire validator runner output into apply-readiness checks so `passed` validator result refs are required before apply.
2. Add policy update proposal surfaces informed by validator failures, recovery taxonomy, and lifecycle reports.
3. Add an automated lifecycle report snapshot schedule after admin approval defines cadence and retention.
4. Design a separate repo conflict apply executor with scope guard, diff, validators, readback, and approval gates.
5. Draft an ADR for the intelligence runtime architecture.
