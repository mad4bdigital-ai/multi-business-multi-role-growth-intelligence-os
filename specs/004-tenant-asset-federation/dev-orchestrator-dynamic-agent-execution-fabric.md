# Dev Orchestrator Dynamic Agent Execution Fabric

**Status:** design-only extension for PR #1898
**Runtime authorized:** No. **Migrations:** No. **Provider dispatch:** No. **Credential access:** No.

## 1. Decision

Adopt one dynamic execution fabric that resolves a complete execution candidate instead of binding workflows directly to a provider, browser, or agent framework.

```text
trigger
→ tenant and business-activity resolution
→ orchestration plan
→ logical agent
→ surface binding
→ execution adapter
→ agent runtime
→ model provider
→ tool/session/data/output policy
→ execution
→ readback, evidence, cost and learning
```

The platform remains the authority for identity, tenant isolation, business activity, permissions, budget, approval, durable effects, and readback. External surfaces are execution options only.

## 2. Core separations

| Concept | Responsibility |
|---|---|
| Trigger | Starts or resumes work. |
| Orchestrator | Builds and supervises the plan. |
| Logical agent | Stable business capability independent of transport. |
| Surface binding | Connects a logical agent to a published or installed surface. |
| Execution adapter | Implements browser, official API, local runtime, or model API transport. |
| Agent runtime | Runs skills, memory, tools, handoffs, and agent loops. |
| Model provider | Supplies model inference when the selected runtime requires it. |
| Connected app | Gives an external agent governed access to platform tools and context. |

OpenRouter is a model-provider/router lane. ChatGPT Custom GPT and Gemini Gem are interactive agent surfaces. Browser Bridge is an execution adapter. Workspace Agents API is an official agent execution adapter. Hermes and OpenClaw are agent runtimes that may themselves use local or remote model providers.

## 3. Entrypoints

Supported design-time trigger families:

- `tenant_gpt_prompt`
- `manual_ui_start`
- `manual_starter_template`
- `prompt_intent`
- `n8n_trigger`
- `scheduled_trigger`
- `webhook_trigger`
- `platform_event`
- `api_trigger`
- `approval_resume`
- `recovery_resume`
- `agent_callback`

All entrypoints call the same orchestration kernel. Entrypoints may propose goals and preferences, but they may not select an otherwise ineligible runtime or bypass business-activity resolution.

## 4. Execution lanes

| Lane | Examples | Best fit |
|---|---|---|
| `interactive_agent_surface` | ChatGPT Custom GPT, Gemini Gem | Exact published assistant behavior and user subscription-backed interaction. |
| `official_agent_api` | ChatGPT Workspace Agents API | Scheduled or backend-started agent runs with official transport. |
| `connected_app` | Mad4B MCP app in ChatGPT Workspace | Governed platform context, tools, approvals and callbacks. |
| `managed_local_agent` | Hermes, OpenClaw | Local or dedicated execution, skills, channels, cron and custom models. |
| `model_api` | OpenRouter, direct OpenAI/Gemini/Qwen | Synchronous, high-throughput or structured inference. |
| `local_model` | Ollama, llama.cpp-compatible runtimes | Privacy- or cost-biased workloads with capacity evidence. |
| `platform_native` | Platform sub-agents and rule engines | Deterministic governed tasks and internal orchestration. |

## 5. Resolution order

1. Resolve principal, tenant, workspace and business activity.
2. Resolve eligible logical agents from registry authority.
3. Resolve surface bindings compatible with activity, mode and tools.
4. Apply platform and tenant hard constraints.
5. Apply inherited workspace, brand, workflow, agent and user preferences.
6. Read live adapter, session, credential, quota and capacity health.
7. Score remaining candidates for quality, cost, latency, privacy and reliability.
8. Reserve budget, concurrency token, session and worker lease.
9. Persist an immutable execution plan and fallback plan.
10. Execute, validate output, read back effects and write evidence.

A prompt is never authority to choose an adapter. A user preference ranks eligible candidates only.

## 6. Interactive orchestration

```text
User
→ Tenant GPT
→ platform orchestration action
→ selected sub-agents across browser/API/local lanes
→ result envelopes
→ governance and synthesis
→ Tenant GPT response
```

The Tenant GPT may request additional agents, explain progress, and collect approvals. Execution authority remains in the platform.

## 7. Autonomous orchestration

```text
n8n / scheduler / event
→ create orchestration run
→ selected sub-agents
→ callback or platform readback
→ continue workflow, store report, or create approval task
```

Autonomous mode must define behavior for missing input, expired sessions, rate limits, approval requirements, partial results, unknown effects and callback failure.

## 8. Fallback rules

Fallback is typed and ordered. It may switch surface, adapter, runtime or model provider only when the next candidate remains compatible with the original data, budget, output and effect policies.

No paid fallback is silent. No fallback occurs after a committed external effect unless durable-effect recovery explicitly permits it. Browser failure may fall back to an official API or local runtime; model API failure may fall back to another approved provider; exact-surface requirements may instead return `blocked_exact_surface_unavailable`.

## 9. Modes and authority

- `observe`: read and analyze only.
- `propose`: create recommendations or action proposals.
- `delegate`: invoke approved read-only or plan-only sub-agents.
- `act`: execute an approved bounded effect through the platform.
- `authority`: operate under an explicit durable authority grant.

Browser and local agents do not gain direct effect authority. They emit action requests that the platform validates against capability envelopes, typed approvals, idempotency and readback requirements.

## 10. Implementation boundary

This PR defines contracts only. Future implementation must preserve interface → application → domain → infrastructure boundaries, reuse the current adapter, concurrency, approval, budget and capability kernels, and land runtime routes, migrations and tests in separate implementation PRs.