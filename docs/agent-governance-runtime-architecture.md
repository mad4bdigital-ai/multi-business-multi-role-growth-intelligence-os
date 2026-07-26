# Agent Governance Runtime Architecture

## Purpose

This runtime turns agent behavior into governed platform contracts without granting new execution authority.

## Contracts

- Response profiles resolve from global to workflow scope and affect presentation only.
- Research is internal-first. External search is included only when the resolved policy permits it.
- Research source execution is auditable and can be compiled into the sequential plan orchestrator.
- Agent handoffs use opaque, expiring, optionally one-time state IDs. Access and consumption are audited.
- External prompt-like artifacts enter quarantine with zero execution, tool, or policy authority.
- `v_skill_runtime_coverage` exposes gaps between agent skills, active grants, manifests, and prompt contracts.
- Memory scope resolution is tenant-bound and deny-by-default. Cross-scope context is visible only through active explicit `memory_scope_links`.

## API Surface

All `/platform/agent-governance/*` routes require backend authentication and an admin principal. They are intentionally excluded from the Tenant GPT OpenAPI surface.

## Data Safety

The runtime stores metadata-only quarantine summaries and governed state, not credentials, prompt previews, or raw secret-bearing prompt payloads. Every new ledger includes `secrets_included = 0`.

Database `CHECK` constraints enforce zero execution/tool/policy authority for quarantined prompt artifacts and zero-secret invariants for research and handoff ledgers.

Application guards reject sensitive field names and secret-like values recursively before persisting research queries, source evidence, or handoff state.

## Sequential Research

`resolveResearchSourcePolicy` returns `recommended_plan_steps` accepted by `compileSequentialPlanSteps`. Internal registries and workspace knowledge execute before any policy-permitted external search, followed by a citation checkpoint when required.

Research source steps cannot pass by echoing input. They require `source_evidence` from an injected governed source adapter. Citation checkpoints require an injected citation verifier and `citations_verified = true`. `/platform/agent-governance/readiness` reports missing schema, seeds, coverage gaps, and adapter blockers.

Built-in read-only adapters cover internal route registry metadata and workspace knowledge metadata linked through active `json_asset_subject_links` for the requested tenant and brand. They never load knowledge payloads. External search remains unavailable unless a governed external adapter is explicitly injected.

Plan creation and compilation share one transaction. `governed_research_plan_registry` binds tenant, idempotency key, query hash, and resolved policy. Runtime execution verifies the tenant and plan intent, then writes one idempotent evidence record per plan step, including citation checkpoints.

Each governed research plan also stores the exact resolved policy snapshot, a canonical SHA-256 snapshot hash, and a canonical compiled-step contract hash. Execution verifies both hashes before claiming any step, so later policy edits do not rewrite plan lineage and modifications to source order, step inputs, dependencies, or success criteria fail closed.

The targeted runtime test includes an in-memory end-to-end execution proof: plan creation and compilation, built-in internal registry research, evidence-ledger persistence, citation verification, and terminal plan completion.

## Execution Evidence

Governed research has three correlated SQL evidence layers:

- `execution_log`: authoritative high-level run evidence, written through `writeExecutionEvidence` and verified by trace-ID readback.
- `research_source_execution_log`: idempotent per-step source and citation evidence.
- `execution_plan_events`: append-only plan and step transition timeline.

The governed plan ID is the execution trace ID, correlation ID, resource ID, and target ID in `execution_log`. The summary records policy and plan-contract hashes plus the two detailed ledger names, but never records the raw research query. A missing `execution_log` readback fails the run response with `governed_research_execution_log_readback_failed`.

## Agent Loop Authority Bridge

`governedAgentExecutionContext.js` brings existing task-route and workflow authority resolvers plus response, research, and memory contracts into the agent loop. It defaults to exposing observe-only drift in the governed context and writes bounded readback-verified drift evidence to authoritative `execution_log`. It can fail closed before model invocation with `AGENT_AUTHORITY_BRIDGE_MODE=enforce`.

`agentPromptAssembler.js` injects a bounded governed envelope into the system prompt. The original user request remains only in the user message and is not duplicated into system instructions.
