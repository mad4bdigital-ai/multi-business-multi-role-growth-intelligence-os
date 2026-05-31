# AI Intelligence Runtime & Governance Layer

## Purpose

The AI Intelligence Runtime & Governance Layer turns platform decisions into governed, auditable plans before any runtime side effect is allowed. It separates model reasoning, policy evaluation, tool selection, execution readiness, validation, and audit feedback.

The current phase is a foundation and dry-run activation phase. The layer can diagnose, plan, score readiness, and write audit evidence. It does not execute repo mutations, database destructive operations, archive jobs, or credential reads.

## Core invariant

```text
AI proposes
Policy constrains
Engines plan
Validators verify
Audit remembers
Humans approve high risk
Execution stays separate
```

## Architectural boundaries

### Interface boundary

Admin HTTP routes expose read, diagnose, planning, decision brief, and audit-history surfaces:

- `platform_engine_list`
- `platform_engine_task_plan`
- `platform_engine_resolve_intent`
- `platform_engine_decision_brief`
- `platform_engine_capability_check`
- `platform_engine_runs`
- `platform_engine_feedback_summary`
- `database_table_lifecycle_decision_brief`
- `database_table_lifecycle_register_plan`
- `ai_model_run_plan`
- `ai_tool_search`

Tenant GPT OpenAPI must not expose platform engine admin routes unless a separate tenant-safe contract is explicitly designed.

### Application boundary

`platformEngineRegistry.js`, `platformEngineOrchestration.js`, `agentIntelligenceRuntime.js`, and `databaseTableLifecycle.js` coordinate registry reads, policy resolution, skill contract selection, decision scoring, and audit writeback.

### Domain/policy boundary

SQL registries are the authority for engine, policy, strategy, rule, and skill binding. Database rows may name policies, validators, strategies, tools, and constraints, but they must not store executable implementation code.

### Infrastructure boundary

Provider credentials, GitHub App credentials, local connector credentials, and database access stay in governed backend/runtime layers. Local device GitHub CLI is break-glass only; normal repository work uses the auth-host GitHub App / DB-backed route.

## Runtime planes

### Decision plane

Produces a decision brief and ranked decision options. The decision model role is scoring assistance only; deterministic hard gates cannot be overridden by model output.

### Policy plane

Resolves active policies and rules from SQL registries. Policies define scope guards, validators, allowed/blocked resources, approval thresholds, risk defaults, and permitted modes.

### Skill plane

Binds tasks to skill contracts. A skill contract defines required tools, forbidden tools, validators, success criteria, and fallback behavior.

### Tool/index plane

`agent_tool_index` is a derived, governed index of callable tools. Search returns concise manifest details such as description, method, and path without exposing the raw tool catalog or secrets.

### Evaluation/audit plane

`platform_engine_execution_runs` records dry-run and diagnostic planning evidence. Audit payloads are sanitized before writeback and redact keys matching secret, token, password, API key, authorization, or credential patterns.

### Lifecycle plane

`database_table_lifecycle_registry` records ownership, usage status, retention class, cleanup strategy, growth policy, and risk metadata for runtime tables. Reporting views summarize coverage, high-risk tables, hotspots, credentials, placeholders, and backup snapshots.

## Active engines

### `repo_conflict_resolution_engine`

Current state: active for diagnose, dry-run planning, and apply-readiness envelopes.

Allowed in this phase:

- package JSON conflict planning
- schema conflict diagnosis/planning
- markdown/text section planning
- high-risk migration/auth conflicts classified as manual-only
- readiness envelope generation

Not allowed in this phase:

- direct repo mutation
- force push
- secret reads
- migration apply
- execution without scope guard, validators, and readback

### `database_table_lifecycle_engine`

Current state: active for lifecycle census, registry planning, reporting, and audit.

Allowed in this phase:

- classify tables
- populate lifecycle metadata
- build dry-run register plans
- expose read-only reporting views

Not allowed in this phase:

- drop
- truncate
- delete
- archive execution
- destructive cleanup

### Growth and retention review engines

The following engines are active for dry-run review only:

- `session_memory_lifecycle_engine`
- `observability_lifecycle_engine`
- `platform_graph_memory_lifecycle_engine`
- `repair_archive_engine`
- `credential_governance_engine`

They produce retention, compaction, backup snapshot, and credential lifecycle review plans. Archive, delete, and credential-value access remain outside this phase.

## Current database lifecycle reporting views

- `v_database_lifecycle_status_summary`
- `v_database_lifecycle_owner_coverage`
- `v_database_lifecycle_growth_hotspots`
- `v_database_lifecycle_placeholder_review`
- `v_database_lifecycle_high_risk_review`
- `v_database_lifecycle_credential_review`
- `v_database_lifecycle_backup_snapshot_review`

These views are read-only visibility surfaces over `database_table_lifecycle_registry`.

## Apply readiness versus execution

An apply-readiness envelope can return `can_apply: true` when policy, scope guard, validators, approval, and readback requirements are satisfied. This does not execute anything.

The current readiness envelope has these hard boundaries:

```text
will_execute: false
no_execution: true
no_repo_mutation: true
model_executes_tools: false
tool_execution_runtime_separate: true
```

A future apply route must be a separate governed surface with scope validation, dry-run diff, validator execution, readback, audit, and approval gates.

## Operating procedure

### Repo conflict decision

1. Run intent resolution or decision brief.
2. Confirm matched policy and selected strategy.
3. Confirm scope guard passed.
4. Confirm validators are present and de-duplicated.
5. Confirm no blockers.
6. Treat `can_apply` as readiness only, not execution.
7. Use a separate approved apply route only after it exists and passes readback.

### Database lifecycle review

1. Run lifecycle census/reporting views.
2. Check growth hotspots and high-risk reviews.
3. Review placeholders by owner engine.
4. Produce dry-run retention/compaction/archive candidate plans.
5. Require explicit approval before any archive/drop/delete workflow is introduced.

### Credential review

1. Use metadata-only credential review.
2. Never read or return secret values.
3. Treat credential placeholders as owner-review required.
4. Rotation/revocation must use a dedicated credential workflow, not the lifecycle reporting views.

## Current maturity

Implemented:

- SQL engine/policy/strategy/rule/skill registries
- lifecycle registry populated across runtime tables
- lifecycle reporting views
- dry-run task plans
- decision briefs
- apply-readiness envelope inside decision brief
- audit writeback with redaction
- tool search from governed derived index
- validator de-duplication

Still pending:

- separate apply executor
- validator result log table
- failure taxonomy table
- policy update proposal workflow
- automated lifecycle report snapshots
- tenant-safe read-only projection where needed
- full ADR for the intelligence runtime architecture

## Safety rules

- Default to dry-run.
- Keep destructive operations outside the planning layer.
- Do not expose raw tool catalogs to model calls.
- Do not expose secret values in reports, tool search, audit, or plans.
- Do not let model output override hard gates.
- Add tests for behavior changes.
- Update docs when surfaces, policies, or contracts change.
