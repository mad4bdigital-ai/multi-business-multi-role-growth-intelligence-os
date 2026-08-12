# Dev Orchestrator Current Platform and Database Surface Reuse Map

**Status:** design-time inventory captured before implementation. No database rows or schemas are changed by PR #1898.

## 1. Reuse-first decision

The Dynamic Agent Execution Fabric must compose existing platform authorities before proposing new tables, routes or registries. A future migration is allowed only for a demonstrated semantic gap.

## 2. Existing agent and surface authority

| Current surface | Reuse role |
|---|---|
| `agents` | Logical agent identity and lifecycle. |
| `agent_surface_catalog` | Existing agent-surface catalog. |
| `tenant_agent_surface_deployments` | Tenant-specific surface activation/deployment state. |
| `user_agent_surface_preferences` | User-level surface preferences. |
| `agent_workflow_bindings` | Agent-to-workflow compatibility. |
| `agent_tool_bindings` | Agent tool profile relationships. |
| `agent_skills` and `agent_skill_grants` | Skill definitions and grants. |
| `agent_model_runs` | Model-run evidence where applicable. |

At inventory time, tenant surface deployment and user preference tables existed but contained no active configuration rows. This is an empty-data state, not proof that new tables are required.

## 3. Browser runtime authority

| Current surface | Reuse role |
|---|---|
| `browser_runtime_registry` | Runtime identity, provider and capability class. |
| `browser_runtime_bindings` | Target/use-case binding. |
| `browser_runtime_policy` | Domain, action, approval and reuse policy. |
| `browser_runtime_capabilities` | Supported browser operations. |
| `browser_runtime_sessions` | Governed session lifecycle. |
| `platform_resource_adapters` | Adapter association with governed resources. |

Observed registry entries included active Browser4 and native Edge connector surfaces, plus planned or candidate managed/browser-agent surfaces. A ChatGPT Custom GPT or Gemini Gem bridge should extend these authorities rather than introduce a separate browser registry.

## 4. Local and managed agent runtime authority

| Current surface | Reuse role |
|---|---|
| `dev_agent_runtime_registry` | Hermes, OpenClaw and other runtime profiles. |
| `dev_agent_provider_registry` | Runtime provider families. |
| `dev_agent_runtime_provider_profiles` | Runtime/provider combinations and model profiles. |
| `device_runtime_alias_registry` | Device/runtime alias resolution. |
| `remote_runtime_targets` | Approved remote or local-path targets. |
| `local_connector_user_configs` | User/device connector references and health metadata. |
| `connected_execution_sessions` | Connected worker/session lifecycle. |

Observed catalog entries already represented Hermes, OpenClaw and OpenClaude agent surfaces and planned managed runtime profiles.

## 5. Model-provider authority

| Current surface | Reuse role |
|---|---|
| `ai_model_providers` | Provider identity, status and tool capability. |
| `ai_model_registry` | Model catalog. |
| runtime/model policy registries | Task profiles, eligibility and fallback policy. |
| budget and quota authority | Reservations, ceilings and fallback authorization. |

OpenRouter remains an active provider/router option. Browser Bridge, Workspace Agent, Hermes and OpenClaw are not inserted into the model-provider registry unless they actually expose model inference as a provider endpoint.

## 6. Workflow and orchestration authority

| Current surface | Reuse role |
|---|---|
| `workflows` and `workflow_runs` | Workflow identity and run history. |
| `workflow_runtime_bindings` | JS, n8n and future runtime binding. |
| `platform_orchestration_stages` | Orchestration stages. |
| `platform_orchestration_edges` | Stage dependency graph. |
| `platform_orchestration_plugins` | Governed orchestration extensions. |
| `platform_orchestration_state_snapshots` | Durable state snapshots. |
| `execution_plans`, `execution_plan_steps`, `execution_plan_events` | Immutable plans and event history. |
| `agent_chain_events` | Agent-chain progress and handoff evidence. |

The new trigger and starter contract should compile into these execution-plan and workflow surfaces rather than create a second job state machine.

## 7. Identity and connected-app authority

| Current surface | Reuse role |
|---|---|
| `user_app_connections` | OAuth, MCP, API key, bearer, webhook and other connection references. |
| `workspace_app_links` | Workspace-level application links and permission mode. |
| `workspace_registry` | Workspace identity and lifecycle. |
| OAuth activation/session surfaces | User and tenant resolution for Tenant GPT and connected apps. |

ChatGPT Workspace and the Mad4B connected MCP app should use these connection and workspace authorities. Tokens and browser sessions remain credential-store references, never inline settings.

## 8. Governance authority

| Current surface | Reuse role |
|---|---|
| `capability_resolution_envelope_ledger` | Immutable dispatch authority evidence. |
| approval holds and scoped approval kernel | Human approval binding. |
| budget/quota authority registry | Spend and capacity authority. |
| adapter contract kernel | Adapter selection and readback contract. |
| execution concurrency kernel | Idempotency, leases and stale-plan protection. |
| durable workflow/effect contract | Commit, compensation and unknown-effect recovery. |

## 9. Semantic gaps to validate in a future implementation PR

Potential gaps, not approved migrations:

- typed trigger/starter catalog if current workflow metadata cannot represent it;
- surface-binding compatibility predicates if current catalog fields are insufficient;
- generalized multi-scope preference operators and revisions;
- browser identity queue and lease metadata not already represented by concurrency/session surfaces;
- signed callback registration if current webhook references are insufficient;
- per-run candidate scoring evidence if execution events cannot hold it.

Each gap requires column-level proof, additive migration design, rollback, indexes, seed ownership and API/test updates.

## 10. Current runtime maturity notes

- browser and local runtime registries exist with mixed active, available, planned and candidate states;
- workflow runtime bindings include active JS and n8n entries;
- OpenRouter provider authority is active;
- several connector/local surfaces remain health- or adapter-dependent;
- existence of a row or URL is not transport validation;
- `active` requires same-cycle execution and readback evidence.

## 11. Implementation boundary

No SQL, seed, schema, row mutation, credential intake or runtime registration is part of this document or PR #1898.
