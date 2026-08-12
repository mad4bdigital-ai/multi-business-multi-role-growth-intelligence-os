# Dev Orchestrator Implementation Contracts

**Status:** design-only deepening for PR #1898  
**Scope:** no runtime mutation, no provider dispatch, no credentials, no migrations.

This document converts the operating maps into future implementation contracts. The platform remains the authority; the orchestrator, OpenRouter, and any `openai-agents-js` runtime are execution aids only.

---

## 1. Contract-first run envelope

Every orchestrator run must resolve this envelope before model, sub-agent, or tool use:

```json
{
  "run_source": "user_request | session_closed | operational_alert | pr_event | scheduler",
  "feature_key": "tenant_session_summary",
  "consumer_domain": "user | tenant | brand | platform | shared_infra | mixed",
  "benefit_owner": {"type": "tenant", "id": "..."},
  "budget_owner": {"type": "tenant", "id": "..."},
  "approval_owner": {"type": "tenant_admin", "id": "..."},
  "mode": "observe | propose | delegate | act | authority",
  "model_policy_key": "free_first_low_risk_text_v1",
  "privacy_policy_key": "tenant_to_platform_redacted_signal_v1",
  "output_policy_key": "proposal_only_v1",
  "fallback_policy_key": "free_limit_defer_no_paid_default_v1",
  "readback_required": true
}
```

If any required resolver is missing, stale, conflicting, or ambiguous, consequential use fails closed.

---

## 2. Required registries

| Registry | Purpose |
|---|---|
| `orchestrator_feature_catalog` | Declares each feature and its default domain, mode, output, privacy, budget, and fallback policies. |
| `orchestrator_consumption_domain_registry` | Defines user, tenant, brand, platform, shared infra, and mixed lanes. |
| `orchestrator_mode_registry` | Defines observe/propose/delegate/act/authority semantics and escalation boundaries. |
| `orchestrator_budget_policy_registry` | Defines budget owner, free-first behavior, paid fallback, daily/request limits, and 402/429 behavior. |
| `orchestrator_model_policy_registry` | Defines OpenRouter/free, allowlisted fallback candidates, data eligibility, and no-unlisted overrides. |
| `orchestrator_privacy_policy_registry` | Defines source/target domain data-use, redaction, evidence pointer, retention, and retraction rules. |
| `orchestrator_output_policy_registry` | Defines which outputs may be written automatically and which require approval/envelope. |
| `orchestrator_sub_agent_routing_policy` | Maps intent/domain/asset target to eligible sub-agent profiles and allowed tools. |
| `orchestrator_decision_ledger` | Records why mode/model/sub-agent/output/fallback decisions were selected. |
| `model_usage_ledger` | Records provider/model usage, limit hits, 402/429, fallback, and budget owner. |
| `orchestrator_backlog_queue` | Stores deferred jobs and retry windows. |

---

## 3. Mode contracts

```text
observe:
  auto_allowed=true
  writes=summary, classification, health/readback snapshot
  no paid fallback by default

propose:
  auto_allowed=true advisory_only
  writes=signal, proposal, preference inference, runbook suggestion
  approval required before task, policy, Brand Core, workflow, or paid fallback

delegate:
  auto_allowed=true read_only_or_plan_only
  writes=sub-agent review, delegation plan, proposal
  execution_allowed=false by default

act:
  auto_allowed=false
  requires capability envelope, typed confirmation, durable workflow/effect commit, readback

authority:
  auto_allowed=false
  requires human/platform approval, evidence bundle, candidate-specific budget reservation
```

Escalation must be explicit:

```text
observe -> propose -> delegate -> act -> authority
```

No run may silently skip to a higher-risk mode.

---

## 4. OpenRouter policy contract

```json
{
  "model_policy_key": "free_first_low_risk_text_v1",
  "primary": "openrouter/free",
  "fallbacks": [
    {"model": "allowlisted-:free-model", "cost_class": "free", "requires_capability_match": true},
    {"model": "openai/gpt-4o-mini", "cost_class": "paid_low", "requires_budget_owner_approval": true}
  ],
  "require_allowlist": true,
  "allow_unlisted_runtime_override": false,
  "fallback_after_committed_effect_allowed": false
}
```

OpenRouter Runtime API is the model dispatch lane. OpenRouter Management API is only for key lifecycle, limits, rotation, and usage monitoring; it is not a completion path.

---

## 5. Free-limit fallback ladder

When free limits or quota pressure occur:

```text
1. cache/reuse recent summary or signal
2. defer until next budget window
3. batch/compress multiple jobs into one model call
4. rule-based low-confidence fallback
5. allowlisted specific :free model if independently eligible
6. paid fallback only with budget-owner approval or explicit policy
7. surface the decision to Custom GPT UI
```

Mode-specific defaults:

| Mode | On limit |
|---|---|
| observe | cache, defer, rule-based; no paid fallback |
| propose | batch, defer, ask if urgent |
| delegate | reduce sub-agents, defer, ask budget owner |
| act | pause; no continuation after committed effect |
| authority | human/platform approval and fresh estimate |

---

## 6. Sub-agent delegation contract

```json
{
  "orchestrator": "dev_orchestrator_agent",
  "sub_agent_profile": "governance_audit_agent",
  "mode": "delegate_read_only",
  "execution_allowed": false,
  "allowed_tools": ["read_context", "review_proposal", "generate_signal"],
  "denied_tools": ["repo_patch", "db_write", "provider_dispatch", "external_send", "credential_read", "local_shell"],
  "requires_approval_before_apply": true
}
```

Sub-agent routing examples:

| Intent | Domain | Sub-agents |
|---|---|---|
| objective extraction | user, tenant | `system_intelligence_agent` |
| governance review | tenant, platform | `governance_audit_agent` |
| Brand Core proposal | brand | `brand_agent`, `growth_agent` |
| SEO opportunity | brand | `seo_agent`, `content_ops_agent` |
| provider readiness | tenant, platform | `provider_ops_agent` |
| execution planning | tenant, platform | `execution_agent`, `governance_audit_agent` |
| platform issue clustering | platform | `system_intelligence_agent`, `governance_audit_agent` |

Sub-agents never receive secrets and never bypass governed dispatch.

---

## 7. Privacy and mixed-lane contract

Mixed-lane events split outputs:

```text
tenant-origin event
  -> tenant-facing summary/proposal
     budget_owner=tenant or sponsored
     memory_scope=tenant

  -> platform-facing bug/signal/runbook candidate
     budget_owner=platform
     memory_scope=platform ops
     raw_tenant_content_allowed=false
     evidence_pointer_allowed=true
     redaction_required=true
```

Rules:

- Tenant raw data is not copied into platform memory.
- Platform signals store evidence pointers and redacted summaries.
- Tenant budget does not fund platform-wide improvement unless sponsored.
- Platform budget does not silently fund tenant premium work unless sponsored.

---

## 8. Run state machine

```text
created
 -> resolving_context
 -> resolving_consumption_domain
 -> resolving_policy
 -> resolving_budget
 -> resolving_model
 -> resolving_sub_agents
 -> governance_gate
 -> dispatched
 -> output_validation
 -> readback
 -> completed
```

Exceptional states:

```text
deferred_rate_limited
awaiting_budget_approval
awaiting_apply_approval
blocked_policy
blocked_privacy
blocked_budget
blocked_model_eligibility
blocked_sub_agent_policy
blocked_output_policy
failed_readback
durable_recovery_required
```

State rules:

- `act` cannot skip `awaiting_apply_approval`.
- `authority` cannot auto-complete.
- `failed_readback` cannot be marked complete without recovery or explicit rejected/abandoned closure.
- `deferred_rate_limited` is graceful degradation, not failure.

---

## 9. Act/effect safety machine

```text
proposal_only
 -> approval_requested
 -> approval_granted
 -> capability_envelope_created
 -> typed_confirmation_received
 -> durable_workflow_started
 -> effect_attempted
 -> effect_verified
 -> ledger_recorded
 -> closed
```

Failure paths:

```text
effect_unknown -> reconciliation_required
effect_committed_but_readback_failed -> recovery_case_required
model_limit_after_effect -> pause_no_silent_fallback
```

Model fallback cannot silently continue after a visible or external effect may have occurred.

---

## 10. Custom GPT UI cards

Every user-visible escalation should surface:

```json
{
  "message_type": "orchestrator_decision_card",
  "feature_key": "brand_growth_signal_extraction",
  "consumer_domain": "brand",
  "benefit_owner": "brand",
  "budget_owner": "tenant",
  "approval_owner": "tenant_admin",
  "mode": "propose",
  "selected_model": "openrouter/free",
  "sub_agents": ["brand_agent", "growth_agent"],
  "requires_approval": true,
  "approval_reason": "Brand Core update requires approval",
  "actions": ["view_evidence", "approve_once", "reject", "defer", "run_deeper_paid_review"]
}
```

The UI must show cost/risk escalation before paid fallback or apply.

---

## 11. Observability

Required counters:

```text
orchestrator_runs_total
orchestrator_runs_by_domain
orchestrator_runs_by_mode
orchestrator_deferred_total
orchestrator_paid_fallback_requests_total
orchestrator_policy_blocks_total
orchestrator_privacy_blocks_total
orchestrator_readback_failures_total
model_requests_by_provider_model
free_limit_hits_total
sub_agent_invocations_total
denied_tool_attempts_total
```

Health tiles:

```text
free quota pressure
deferred backlog
mixed-lane redaction status
pending approvals
readback failures
sub-agent policy denials
budget owner escalations
platform vs tenant consumption split
```

---

## 12. First implementation slice

After design approval, the first safe runtime slice should be:

```text
1. Add ledger fields to Dev Agent runs/proposals:
   consumer_domain, benefit_owner, budget_owner, approval_owner,
   mode, model_policy, privacy_policy, output_policy.

2. Add observe/propose mode resolver only.

3. Use OpenRouter free-first only for:
   summary, classification, signal extraction, proposal drafting.

4. Add fallback:
   cache, batch, defer, rule-based fallback.

5. Add Custom GPT UI digest fields:
   budget owner, approval required, selected mode, output policy.

6. Do not enable sub-agent runtime until ledger/readback is stable.
```
