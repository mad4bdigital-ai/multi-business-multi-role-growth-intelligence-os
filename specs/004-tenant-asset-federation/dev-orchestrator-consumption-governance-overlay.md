# Dev Orchestrator, OpenRouter, and Consumption Governance Overlay

**Status:** design overlay for PR-1898
**Scope:** design-only, no runtime enforcement
**Implementation authorized:** No
**Provider calls authorized:** No
**Credential or secret mutation authorized:** No
**Database migration included:** No
**Production mutation authorized:** No

This document maps the proposed dynamic Dev Orchestrator, OpenRouter model lane, optional `openai-agents-js` runtime, and intelligence-consumption governance onto the Spec Kit in PR #1898. It is a cross-plane overlay; it does not replace the shared asset fabric, Effective Runtime Manifest, FinOps, model governance, durable workflow/effect commit, data governance, or artifact/knowledge provenance.

## 1. Placement in the existing PR architecture

```text
Custom GPT UI Surface
(Admin / Tenant Assistant)
        ↓
Intent, Preference, Approval, and Explanation Surface
        ↓
Consumption Domain Resolver
        ↓
Budget + Privacy + Approval + Data-use Policy
        ↓
Dynamic Mode Selector
        ↓
Model Router / OpenRouter Runtime API
        ↓
Agents Runtime / optional openai-agents-js thin layer
        ↓
Sub-Agent Registry
        ↓
Governed Platform Tools / Durable Workflow / Effect Commit
        ↓
Readback + Consumption Ledger + Learning Loop
```

The platform remains the authority. Any agent runtime, including `openai-agents-js`, is only an orchestration runtime. It must never become an independent permission, execution, credential, billing, or data-governance authority.

## 2. Dual-agent operating model

```text
Front-end Agent Surface
= Custom GPT UI admin/tenant assistants
= human-facing command, explanation, preference, approval, and decision surface

Back-end Orchestration Agent
= Dev/Platform Orchestrator cloud loop
= autonomous observer, summarizer, classifier, proposer, router, and delegation planner
```

Both surfaces share the same Platform Control Plane: session context, summaries, objectives, intents, preferences, tenant/workspace/brand assets, agent registry, skill/workflow registry, approval holds, budget policy, model policy, operational attention, execution logs, and readback.

Neither surface may silently apply policy, update Brand Core, dispatch providers, mutate repositories, read credentials, or commit external Effects. Those actions must resolve through governed platform authority.

## 3. Dynamic orchestration modes

Every request, event, or scheduled run resolves a mode before selecting model, tool, or sub-agent.

| Mode | Auto allowed? | Primary outputs | Escalation |
|---|---|---|---|
| `observe` | Yes | summary, classification, intent, objective, health/readback snapshot | incomplete evidence or limit exhaustion |
| `propose` | Yes, advisory only | signal, proposal, preference inference, runbook suggestion | task creation, policy activation, paid fallback |
| `delegate` | Yes, read-only or plan-only by default | sub-agent plan, specialist review, delegation proposal | local agent, execution envelope, provider dispatch |
| `act` | No | governed execution via platform tools and durable workflows | requires capability envelope, typed confirmation, readback |
| `authority` | No | high-risk determination, conflict resolution, policy certification | human/platform admin approval always required |

Design invariant:

```text
dynamic mode selection is allowed
dynamic uncontrolled execution is not allowed
```

## 4. Consumption governance layer

Every intelligence action must declare:

```text
who benefits
who pays
who approves
what data was used
where the output is written
what fallback is allowed
```

These are separate resolver fields:

| Field | Question |
|---|---|
| `consumer_domain` | user, tenant, brand, platform, shared infrastructure, or mixed? |
| `benefit_owner` | Who receives primary value? |
| `budget_owner` | Who pays or sponsors the model/tool consumption? |
| `approval_owner` | Who can approve escalation or apply? |
| `memory_scope` | Where does learning/context persist? |
| `output_policy` | Where may the result be written? |

Recommended lanes:

```text
user personal lane
tenant/workspace lane
brand/business asset lane
platform internal lane
shared infrastructure lane
mixed lane
```

Mixed lane rule: tenant raw data may create platform signals only through purpose, lawful basis/consent, provenance, residency, retention, provider/model, and redaction policy gates. Tenant budget must not fund general platform improvement unless explicitly sponsored. Platform budget must not silently fund tenant premium work unless declared as sponsored.

## 5. OpenRouter runtime vs management

```text
OpenRouter Runtime API
= model dispatch lane
= openrouter/free, specific :free candidates, and approved paid fallbacks

OpenRouter Management API
= key lifecycle, usage monitoring, rotation, tenant/workspace key limits, and budget isolation
= not the model completion path
```

MVP should use the Runtime API only through a platform-managed secret reference. Management API should enter later when per-tenant/workspace keys, limits, rotation, or usage monitoring are required.

## 6. Optional openai-agents-js runtime

If adopted, `openai-agents-js` must be a thin orchestration runtime over platform authority.

Platform decides first:

```text
consumer domain
mode
budget owner
approval owner
allowed tools
allowed sub-agents
model policy
privacy policy
output policy
```

The Agents SDK may then coordinate manager/sub-agent calls, handoffs, agents-as-tools, function tools, sessions, human-in-the-loop interruptions, and tracing. Initial use must block sandbox, shell, file editing, repo mutation, external send, credential read, and direct DB write outside governed dispatch.

## 7. Sub-agent use from existing registry

The existing agent registry is the source of sub-agent profiles. Dev Orchestrator does not copy agents.

Initial eligible read-only/plan-only profiles include:

```text
system_intelligence_agent
system_governance_agent
governance_audit_agent
provider_ops_agent
execution_agent
brand_agent
growth_agent
seo_agent
market_agent
content_ops_agent
revenue_agent
product_agent
```

Example:

```json
{
  "orchestrator": "dev_orchestrator_agent",
  "sub_agent_profile": "governance_audit_agent",
  "mode": "delegate_read_only",
  "execution_allowed": false,
  "output": "review_or_proposal",
  "requires_approval_before_apply": true
}
```

## 8. Free-model limit fallback

When OpenRouter free limits are reached, default behavior is degradation, not silent paid escalation.

```text
1. cache/reuse recent summary or signal
2. queue/defer until next budget window
3. batch/compress multiple jobs into one model call
4. rule-based low-confidence fallback
5. specific allowlisted :free model if eligible
6. paid fallback only if budget policy permits or user/admin approves
7. surface choice to Custom GPT UI
```

Mode-specific defaults:

| Mode | On limit |
|---|---|
| `observe` | cache, defer, rule-based; no paid fallback by default |
| `propose` | batch, defer, ask if urgent |
| `delegate` | reduce sub-agents, defer, ask budget owner |
| `act` | pause and request approval; no continuation after committed Effect |
| `authority` | human/platform admin approval, fresh estimate, manifest revalidation |

## 9. Future authorities

Future implementation should introduce registry authorities, not hardcoded behavior:

```text
orchestrator_feature_catalog
orchestrator_consumption_domain_registry
orchestrator_consumption_ledger
orchestrator_mode_registry
orchestrator_budget_policy_registry
orchestrator_model_policy_registry
orchestrator_privacy_policy_registry
orchestrator_output_policy_registry
orchestrator_sub_agent_routing_policy
orchestrator_decision_ledger
model_usage_ledger
orchestrator_backlog_queue
```

## 10. Integration order

```text
Phase 1 — Accounting and separation
Add consumer_domain, benefit_owner, budget_owner, approval_owner, mode, model_policy, and output_policy to Dev Agent runs/proposals.

Phase 2 — Dynamic observe/propose
OpenRouter free-first for summaries, classification, signal extraction, and proposal generation. No paid automatic fallback.

Phase 3 — Delegate read-only
Use existing agent registry as sub-agent profiles. No execution, repo mutation, shell, or external send.

Phase 4 — Optional openai-agents-js thin runtime
Use only as orchestration runtime after platform policies have resolved mode, tools, agents, budget, and privacy.

Phase 5 — OpenRouter Management API
Introduce managed key limits, rotation, usage monitoring, and tenant/workspace budgets.

Phase 6 — Act/Authority modes
Enable only with capability envelopes, typed confirmation, durable workflow/effect commit, candidate-specific estimate/reservation, and same-cycle readback.
```

## 11. Acceptance scenarios to add later

- Tenant session summary is generated under tenant/user consumption and does not create platform improvement records unless redaction policy permits.
- Platform issue signal derived from tenant session is privacy-filtered, charged to platform budget, and stores evidence pointer without raw tenant content.
- OpenRouter free limit is reached in observe mode and the job is deferred instead of paid fallback.
- Paid model fallback is requested in propose mode and blocks until budget-owner approval.
- `openai-agents-js` manager agent invokes a sub-agent only as a governed read-only tool.
- Sub-agent attempts a denied tool action and the platform dispatcher returns a stable denial before execution.
- Model fallback after a committed Tool Effect is blocked and routed through durable workflow recovery.
- Custom GPT UI displays proposed preference, budget owner, mode, and approval requirement before activation.
- Platform internal proposal cannot alter tenant assets without tenant approval.
- Tenant budget is not used for platform-wide improvement unless an explicit sponsored policy exists.

## 12. Review conclusion

This overlay fits PR-1898's architecture, but it should remain a cross-plane operating model. The key addition is the Consumption Governance Layer: every intelligence action must declare who benefits, who pays, who approves, what data was used, where the output is written, and what fallback is allowed.
