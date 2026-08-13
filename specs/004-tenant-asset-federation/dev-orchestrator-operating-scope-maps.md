# Dev Orchestrator Operating Scope Maps

**Status:** companion operating detail for `dev-orchestrator-consumption-governance-overlay.md`  
**PR:** #1898  
**Scope:** design-only; no runtime mutation, no provider dispatch, no credentials, no migrations.

This companion document expands the operating details for each consumption domain. It should be read as the operational view of the Consumption Governance Layer.

---

## 1. Universal run envelope

Every orchestrator run must resolve this envelope before it may call a model, sub-agent, or governed tool.

```json
{
  "run_source": "user_request | session_closed | operational_alert | pr_event | migration_event | scheduler",
  "consumer_domain": "user | tenant | workspace | brand | platform | shared_infra | mixed",
  "benefit_owner": "resolved owner of the value",
  "budget_owner": "resolved owner of the cost or sponsored bucket",
  "approval_owner": "resolved human or policy authority",
  "mode": "observe | propose | delegate | act | authority",
  "model_policy": "free_only | free_first | balanced | performance_first",
  "privacy_policy": "resolved data-use and redaction policy",
  "output_policy": "where outputs may be written",
  "fallback_policy": "allowed behavior on model/provider/limit failure",
  "readback_contract": "evidence required to close the run"
}
```

No run can skip the envelope. Missing, stale, conflicting, or ambiguous evidence fails closed for consequential use.

---

## 2. Master operating flow

```text
Input event or user request
        |
        v
Source classifier
        |
        v
Consumer domain resolver
        |
        v
Data ownership and privacy resolver
        |
        v
Benefit / budget / approval resolver
        |
        v
Mode selector
        |
        v
Model policy and quota resolver
        |
        v
Sub-agent router
        |
        v
Governance gate
   allowed | approval_required | denied | deferred
        |
        v
Model/sub-agent/tool execution if allowed
        |
        v
Output policy
        |
        v
Readback + ledger + learning
```

---

## 3. User personal lane

### Purpose

Personal memory, preferred language, tone, automation appetite, approval style, UI digest, and assistant behavior.

### Flow

```text
User message or user-owned session event
        |
        v
Resolve user identity and preference scope
        |
        v
Check purpose, consent, privacy, and memory policy
        |
        v
Mode selector
  default: observe or propose
        |
        v
OpenRouter free-first
        |
        v
Write one of:
  user_summary
  user_preference_proposal
  personal_digest
  assistant_surface_preference_proposal
        |
        v
If activation is requested:
  user approval required
        |
        v
Readback into user preference ledger
```

### Defaults

| Field | Default |
|---|---|
| Budget owner | user quota, tenant-sponsored, or platform-sponsored free tier |
| Auto modes | observe, propose |
| Approval required | preference activation, paid fallback |
| Allowed writes | summary, digest, preference proposal |
| Denied writes | tenant policy, Brand Core, workflow apply, external send |
| Fallback | cache, defer, rule-based low confidence, ask user |

---

## 4. Tenant / workspace lane

### Purpose

Tenant/workspace summaries, operating preferences, workflow gaps, readiness, task candidates, connected-app intelligence, tenant policy proposals.

### Flow

```text
Tenant session, workflow failure, dashboard signal, or tenant request
        |
        v
Resolve tenant, workspace, role, and membership authority
        |
        v
Resolve data-use, entitlement, and budget policy
        |
        v
Mode selector
  default: observe, propose, delegate_read_only
        |
        v
Optional sub-agents:
  system_intelligence_agent
  governance_audit_agent
  execution_agent (plan-only)
        |
        v
Write one of:
  tenant_summary
  workspace_signal
  workflow_gap_signal
  tenant_policy_proposal
  pending_task_candidate
        |
        v
Tenant admin approval before apply
        |
        v
Readback into tenant ledger
```

### Defaults

| Field | Default |
|---|---|
| Budget owner | tenant |
| Auto modes | observe, propose, delegate read-only |
| Approval required | task creation, workflow activation, tenant policy apply, paid fallback |
| Allowed writes | tenant summary, readiness signal, proposal |
| Denied writes | direct apply, provider write, external send |
| Fallback | cache, batch, defer, ask tenant admin |

---

## 5. Brand / business asset lane

### Purpose

Brand Core proposals, growth strategy, SEO, market positioning, content workflow, revenue/product recommendations.

### Flow

```text
Brand objective, business activity signal, or growth request
        |
        v
Resolve brand, activity type, workspace, and role
        |
        v
Resolve Brand Core readiness and asset authority
        |
        v
Mode selector
  default: observe, propose, delegate_read_only
        |
        v
Sub-agent router:
  brand_agent
  growth_agent
  seo_agent
  market_agent
  content_ops_agent
  revenue_agent
  product_agent
        |
        v
Write one of:
  brand_insight
  growth_recommendation
  SEO_opportunity
  Brand_Core_update_proposal
  content_workflow_proposal
        |
        v
Brand owner or tenant admin approval before apply
        |
        v
Provenance + readback
```

### Defaults

| Field | Default |
|---|---|
| Budget owner | tenant or brand budget |
| Auto modes | observe, propose, delegate read-only |
| Approval required | Brand Core update, workflow creation, paid fallback |
| Allowed writes | brand proposal, insight, recommendation |
| Denied writes | direct Brand Core mutation, external campaign send |
| Fallback | defer non-urgent, batch, ask brand/tenant owner |

---

## 6. Platform internal lane

### Purpose

Platform bug signals, schema gaps, route failures, provider readiness, release readiness, operational attention, PR/migration proposals, agent-routing improvements.

### Flow

```text
Operational alert, failed run, PR event, migration event, runtime verification
        |
        v
Resolve platform ownership and admin authority
        |
        v
Classify whether evidence is platform-only or tenant-derived
        |
        v
If tenant-derived:
  apply redaction and evidence-pointer policy
        |
        v
Mode selector
  default: observe or propose
        |
        v
Sub-agent router:
  system_intelligence_agent
  system_governance_agent
  governance_audit_agent
  provider_ops_agent
  execution_agent
        |
        v
Write one of:
  known_issue_candidate
  dev_agent_proposal
  runbook_suggestion
  PR_scope_proposal
  migration_candidate_description
        |
        v
Platform admin approval before repo, DB, provider, or production change
        |
        v
Operational readback and ledger
```

### Defaults

| Field | Default |
|---|---|
| Budget owner | platform |
| Auto modes | observe, propose |
| Approval required | PR creation, migration apply, registry mutation, provider config, paid fallback |
| Allowed writes | known issue candidate, proposal, runbook suggestion |
| Denied writes | repo mutation, DB mutation, provider write, deploy |
| Fallback | queue lower-priority diagnostics, batch critical items, admin escalation |

---

## 7. Shared infrastructure lane

### Purpose

Model catalog sync, quota snapshots, key-limit planning, scheduler health, cache health, trace compaction, evaluation preparation.

### Flow

```text
Scheduled infra event
        |
        v
Resolve shared infra policy and budget
        |
        v
Mode selector
  default: observe, bounded propose
        |
        v
Non-model path preferred where possible
        |
        v
Write one of:
  model_catalog_snapshot
  quota_snapshot
  cache_health
  trace_compaction_plan
  model_readiness_snapshot
        |
        v
Admin approval before key rotation, budget changes, or management API mutations
        |
        v
Shared infra ledger
```

### Defaults

| Field | Default |
|---|---|
| Budget owner | shared infra or platform |
| Auto modes | observe, bounded propose |
| Approval required | OpenRouter Management API mutation, budget changes |
| Allowed writes | snapshots, health, advisory plans |
| Denied writes | tenant assets, user preferences |
| Fallback | throttle, defer, critical-only processing |

---

## 8. Mixed lane

### Purpose

A single source event creates both tenant-facing and platform-facing outputs.

### Flow

```text
Tenant-owned source event
        |
        +-------------------------------+
        |                               |
        v                               v
Tenant-facing output             Platform-facing output
summary/proposal                 bug/signal/runbook candidate
tenant budget                    platform budget
tenant memory                    platform ops memory
tenant-visible                   redacted evidence pointer
        |                               |
        v                               v
Tenant approval if apply         Platform approval if act
```

### Rules

```text
Mixed lane is split-output, split-budget, split-approval.
Tenant raw data is not copied into platform memory.
Platform signal may store an evidence pointer and redacted summary.
Tenant output is not blocked by platform budget exhaustion.
Platform output is not charged to tenant budget unless explicitly sponsored.
```

---

## 9. Model routing and fallback

### Default model policy

```text
observe   -> openrouter/free, no paid fallback by default
propose   -> openrouter/free, paid fallback only by approval or policy
delegate  -> openrouter/free, reduce sub-agents on pressure
act       -> model plans only; execution via governed tools
authority -> human/platform approval and candidate-specific reservation
```

### Free limit ladder

```text
1. cache or reuse recent summary/signal
2. defer to next budget window
3. batch/compress multiple jobs
4. rule-based low-confidence fallback
5. allowlisted :free model if eligible
6. paid fallback only with budget-owner approval
7. surface choice to Custom GPT UI
```

---

## 10. Sub-agent delegation contract

Sub-agent use is registry-driven and starts read-only or plan-only.

```json
{
  "orchestrator": "dev_orchestrator_agent",
  "sub_agent_profile": "governance_audit_agent",
  "mode": "delegate_read_only",
  "execution_allowed": false,
  "tools_allowed": ["read_only_platform_context", "proposal_review"],
  "tools_denied": ["repo_patch", "db_write", "provider_dispatch", "external_send", "credential_read"],
  "requires_approval_before_apply": true
}
```

Sub-agent routing examples:

| Intent | Domain | Sub-agents |
|---|---|---|
| objective extraction | user, tenant | system_intelligence_agent |
| governance review | tenant, platform | governance_audit_agent |
| Brand Core proposal | brand | brand_agent, growth_agent |
| SEO opportunity | brand | seo_agent, content_ops_agent |
| provider readiness | tenant, platform | provider_ops_agent |
| execution planning | tenant, platform | execution_agent, governance_audit_agent |
| platform issue clustering | platform | system_intelligence_agent, governance_audit_agent |

---

## 11. Act and authority path

```text
Proposal selected for apply
        |
        v
Revalidate authority, entitlement, data-use, model, and budget policy
        |
        v
Create capability envelope
        |
        v
Require typed confirmation
        |
        v
Run durable workflow/effect commit
        |
        v
Same-cycle readback
        |
        v
Ledger settlement and evidence
```

Act/authority modes are never automatic.

---

## 12. Required ledgers and registries

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

Ledger record shape:

```json
{
  "run_id": "orch_run_001",
  "feature_key": "brand_growth_signal_extraction",
  "consumer_domain": "brand",
  "benefit_owner_type": "brand",
  "budget_owner_type": "tenant",
  "approval_owner_type": "tenant_admin",
  "mode": "propose",
  "model_provider": "openrouter",
  "model": "openrouter/free",
  "sub_agents": ["brand_agent", "growth_agent"],
  "writes_allowed": ["brand_proposal"],
  "writes_denied": ["brand_core_update"],
  "fallback_used": false,
  "privacy_class": "tenant_confidential",
  "readback_status": "verified"
}
```

---

## 13. Acceptance scenarios

- Tenant summary does not create platform improvement records unless redaction policy permits.
- Platform issue signal from tenant evidence is charged to platform and stores no raw tenant content.
- Free model limit in observe mode defers instead of silently using paid fallback.
- Paid fallback in propose mode blocks until budget-owner approval.
- Sub-agent is invoked only as a governed read-only tool.
- Denied sub-agent tool action fails before execution.
- Model fallback after committed Tool Effect routes to durable workflow recovery.
- Custom GPT UI displays preference, budget owner, mode, and approval requirement before activation.
- Platform proposal cannot alter tenant assets without tenant approval.
- Tenant budget is not used for platform-wide improvement unless sponsored.
- Platform budget is not silently used for tenant premium work unless sponsored.
