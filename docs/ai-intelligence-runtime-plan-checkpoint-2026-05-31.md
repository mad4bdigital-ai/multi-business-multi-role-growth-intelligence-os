# AI Intelligence Runtime Plan Checkpoint

Date: 2026-05-31

## Current State

The platform is now on a SQL-first, registry-first path for engine governance, recovery evidence, and resource authority. The current `main` checkpoint includes the AI Intelligence Runtime foundation, database lifecycle governance, OpenAPI tenant alias guards, recovery/resource-authority documentation, and bounded local connector command output.

This checkpoint is a planning and verification report. It does not authorize new mutation paths by itself.

## Completed

### Engine, Policy, Strategy, Skill, and Audit Foundation

Implemented by the Sprint 65 governance migrations and runtime modules:

- `platform_engine_registry`
- `platform_engine_policy_registry`
- `platform_engine_policy_rules`
- `platform_engine_strategy_registry`
- `platform_engine_skill_prompt_registry`
- `platform_engine_execution_runs`
- `agent_intelligence_runtime_*` registries

Supported tool surfaces include:

- `platform_engine_list`
- `platform_engine_task_plan`
- `platform_engine_resolve_intent`
- `platform_engine_decision_brief`
- `platform_engine_capability_check`
- `platform_engine_run_history`
- `platform_engine_feedback_summary`
- `platform_engine_execution_envelope`

Current status:

- diagnose and planning surfaces are active
- apply execution remains gated and not generally enabled
- no dynamic code is executed from SQL policy rows
- high-risk operations require approval gates

### First Engines

Seeded and documented engines:

- `repo_conflict_resolution_engine`
- `database_table_lifecycle_engine`

`repo_conflict_resolution_engine` is the first policy-driven repo maintenance engine. It supports dry-run conflict planning through declarative strategy keys and policy rules.

`database_table_lifecycle_engine` is the first database governance engine. It classifies live tables and generates lifecycle registration plans without dropping, archiving, truncating, or mutating data.

### Database Lifecycle Governance

Implemented:

- `database_table_lifecycle_registry`
- lifecycle classification policy
- dry-run register plan
- read-only reporting views

Documented priorities:

- classify tables missing from `data_migration_inventory`
- assign owner engine/workflow/action metadata
- define retention and cleanup policy for high-growth logs
- classify backup/repair tables as snapshots, not live runtime tables

### OpenAPI Tenant Alias Governance

Current source-of-truth rule:

- `http-generic-api/openapi.yaml` is canonical
- split schemas are generated from `openapi.yaml`
- tenant aliases are declared with `x-tenant-gpt-operationId`
- `listTools` binds only to `GET /system/tools`
- `callTool` binds only to `POST /system/tools/call`
- `/gpt/tools` and `/gpt/tools/call` remain admin dispatcher routes and must not carry tenant aliases

Regression surfaces:

- `http-generic-api/scripts/split-openapi.mjs`
- `http-generic-api/test-openapi-split-governance.mjs`
- `docs/openapi-split-governance.md`
- `GPT_Tenant_Connector_Knowledge.md`
- `GPT_Tenant_Connector_Instructions.md`

### Recovery and Resource Authority Checkpoint

Added governance checkpoint:

- `docs/platform-governance-recovery-resource-authority-2026-05-31.md`

Promoted platform layers:

```text
Evidence
  -> Recovery / Retry / Conflict Handling
    -> Certification / Checkpoint
```

and:

```text
Policy
  -> Resource Authority
    -> Export
```

Core rule:

```text
Create freely under governance.
Publish or mutate only with authority.
Recover only with evidence.
```

Resource authority now applies to tenant, user, brand, and externally owned writes including CMS, Google Drive, GitHub repo patch, n8n activation, Cloudflare DNS, local connector config, CRM, email, social, and generated asset upload.

### Local Connector Oversized Response Guard

Merged fix:

- PR `#482`
- commit `f8ab3ee`

`connector_ps` now uses the same normalized bounded CLI response contract as `connector_github`.

Connector command success must be read from:

- `ok`
- `command_ok`
- `exitCode`
- `exit_code`

Large command output is bounded and reports:

- `stdout_truncated`
- `stderr_truncated`
- `stdout_length_chars`
- `stderr_length_chars`
- `output_limit_chars`

Regression tests:

- `node local-connector/test-github-result-guard.mjs`
- `node local-connector/test-ps-native-exit-guard.mjs`

## Verified Evidence

Recent local verification:

- `git status --short --branch` showed `main...origin/main`
- `node local-connector/test-github-result-guard.mjs` passed
- `node local-connector/test-ps-native-exit-guard.mjs` passed
- OpenAPI tenant alias search confirms `listTools` and `callTool` are on `/system/tools` and `/system/tools/call`
- `split-openapi.mjs` contains duplicate tenant alias validation
- `test-openapi-split-governance.mjs` asserts tenant aliases are unique and bound to the system layer

Known non-blocking local warning:

- Git prints `unable to access 'C:\Users\IT/.config/git/ignore': Permission denied`
- This has not blocked status, branch, commit, push, pull, or merge operations

## What Remains

### P0

1. Add recovery capability registry rows for:
   - `github.job_logs.get`
   - `github.check_annotations.get`
   - `github.ci.wait_for_sha`
   - `github.ci.summarize_sha`
   - `github.required_checks.summary`
   - `repo.patch.error.classify`
   - `repo.patch.context_recover`
   - `repo.patch.no_match.diagnose`
   - `github.pr.merge_idempotent`

   Status: foundation added in `http-generic-api/migrations/174_sprint65_recovery_capability_taxonomy_foundation.sql`. Runtime apply remains out of scope.

2. Add a CI failure taxonomy table or registry family for:
   - `pending`
   - `failed_with_logs`
   - `cancelled_by_newer_run`
   - `skipped_by_path_filter`
   - `guard_failed`
   - `schema_contract_failed`
   - `unit_test_failed`
   - `stale_run`

   Status: foundation added in `platform_recovery_failure_taxonomy`. See `docs/recovery-capability-taxonomy-foundation.md`.

3. Add an execution envelope validator that blocks apply when any required gate is missing:
   - scope guard
   - approval gate
   - validator gate
   - resource authority gate
   - audit evidence shape

4. Add resource authority registry foundation:
   - resource resolution
   - ownership claim
   - active grant
   - scoped credential
   - policy gate
   - audit evidence
   - readback

5. Add exact regression coverage for:
   - `connector_ps` bounded output through auth-host relay
   - GitHub CLI auth-required classification through connector route
   - OpenAPI split regeneration parity
   - tenant schema importer operation count and operation IDs

### P1

1. Add repo conflict diagnose/plan APIs that consume the engine registry instead of ad hoc rules.
2. Add read-only recovery run history and failure summary surfaces.
3. Backfill `database_table_lifecycle_registry` from live `information_schema` census.
4. Add retention/growth policy for:
   - `session_events`
   - `gpt_session_turns`
   - `telemetry_spans`
   - `audit_log`
   - `execution_log`
   - `json_assets`
   - `platform_graph_nodes`
   - `platform_graph_edges`
5. Classify backup/repair table families with retention and safe-drop review windows.

### P2

1. Add apply executor behind approval, validator, and resource authority gates.
2. Add feedback learning from execution outcomes without allowing self-modifying policy.
3. Add cross-engine planner that can choose between repo recovery, schema cleanup, release readiness, provider smoke, and resource authority engines.
4. Add dashboard/report views for:
   - active engines
   - blocked runs
   - high-risk approvals
   - failed validators
   - lifecycle coverage

## Decision Boundaries

Do not implement broad mutation paths until these gates exist:

- no DB-stored executable code
- declarative strategy keys only
- dry-run by default
- resource authority before external writes
- exact validator coverage before apply
- audit evidence before completion claim
- tenant GPT schema remains the five MCP-style operations

Tenant GPT schema must remain:

```text
activateSession
listTools
callTool
writeSessionTurn
endSession
```

Tenant capability expansion must happen through registry-backed `listTools` and `callTool`, not direct tenant exposure of admin, connector, provider-bootstrap, or platform management routes.

## Next Safe Implementation Slice

Recommended next branch:

```text
gpt/recovery-capability-taxonomy-foundation
```

Recommended scope:

- migration only
- no runtime apply executor
- add recovery capability registry rows
- add CI failure taxonomy registry/table
- add read-only tool schemas for CI summary and failure classification
- add tests that confirm the new tools are read-only and do not expose secrets

Stop condition for that slice:

- migrations are syntactically valid
- registry rows are present and idempotent
- tests assert no apply/mutation capability is introduced
- docs link the new taxonomy from this checkpoint and the AI runtime governance doc
