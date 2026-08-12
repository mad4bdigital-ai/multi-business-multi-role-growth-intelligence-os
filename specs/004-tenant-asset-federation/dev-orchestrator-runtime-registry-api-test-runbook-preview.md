# Dev Orchestrator Runtime Registry, API, Test, and Runbook Preview

**Status:** design-only deepening for PR #1898  
**Scope:** future runtime preview only; no migration, no route activation, no provider dispatch, no credential access, no production mutation.

This companion document turns the overlay and operating maps into a future implementation preview: registry shapes, API surfaces, state machines, rollout slices, tests, and runbooks.

---

## 1. Authority stack

```text
Request/Event
  -> Platform Control Plane
  -> Registry Authority
  -> Decision Ledger
  -> Model/Agent Runtime
  -> Governed Dispatcher
  -> Durable Workflow / Effect Commit
  -> Readback and Settlement
```

Rules:

```text
Registry decides eligibility.
Policy decides permission.
Budget decides affordability.
Approval decides escalation.
Runtime executes only allowed work.
Readback decides completion.
Agents and models are not authorities.
```

---

## 2. Future registries

```text
orchestrator_feature_catalog
orchestrator_consumption_domain_registry
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

Minimum row contracts:

```json
{
  "feature_key": "tenant_session_summary",
  "consumer_domain": "tenant",
  "default_mode": "observe",
  "model_policy": "openrouter_free_first_text_v1",
  "budget_policy": "tenant_free_first_defer_v1",
  "privacy_policy": "tenant_private_summary_v1",
  "output_policy": "session_summary_auto_write_v1",
  "risk_tier": "low"
}
```

```json
{
  "feature_key": "platform_issue_signal_from_tenant_evidence",
  "consumer_domain": "mixed",
  "default_mode": "propose",
  "model_policy": "openrouter_free_first_text_v1",
  "budget_policy": "platform_free_first_defer_v1",
  "privacy_policy": "tenant_to_platform_redacted_signal_v1",
  "output_policy": "platform_signal_proposal_only_v1",
  "risk_tier": "medium"
}
```

---

## 3. Mode contracts

```text
observe:
  auto_allowed=true
  execution_allowed=false
  writes=summary, classification, health_snapshot
  no paid fallback by default

propose:
  auto_allowed=true
  execution_allowed=false
  writes=signal, proposal, preference_proposal, runbook_suggestion
  approval required before task, policy, Brand Core, workflow, provider, or paid fallback

delegate:
  auto_allowed=true
  execution_allowed=false by default
  writes=sub_agent_review, delegation_plan, proposal
  sub-agent tools are read-only/plan-only

act:
  auto_allowed=false
  requires approval, capability envelope, typed confirmation, durable workflow/effect commit, readback

authority:
  auto_allowed=false
  requires human/platform admin approval, evidence bundle, candidate-specific budget reservation
```

No run may silently escalate to a higher-risk mode.

---

## 4. OpenRouter policy contract

```json
{
  "model_policy_key": "openrouter_free_first_text_v1",
  "runtime_api_primary": "openrouter/free",
  "fallbacks": [
    {"model": "allowlisted_specific_free", "cost_class": "free"},
    {"model": "openai/gpt-4o-mini", "cost_class": "paid_low", "requires_budget_owner_approval": true}
  ],
  "require_allowlist": true,
  "allow_unlisted_runtime_override": false,
  "fallback_after_committed_effect_allowed": false
}
```

Runtime API is the model dispatch lane. Management API is only for future key lifecycle, limits, rotation, and usage monitoring. Management API is not a completion path.

---

## 5. API preview

### Decision preview

```http
POST /dev-orchestrator/decision/preview
```

```json
{
  "source": "session_closed",
  "tenant_id": "tenant_123",
  "user_id": "user_456",
  "asset_target": "tenant_session",
  "intent_hint": "summarize_and_extract_platform_signal",
  "dry_run": true
}
```

Expected result:

```json
{
  "decision_status": "preview",
  "consumer_domain": "mixed",
  "outputs": [
    {
      "feature_key": "tenant_session_summary",
      "budget_owner": "tenant",
      "mode": "observe",
      "auto_allowed": true
    },
    {
      "feature_key": "platform_issue_signal_from_tenant_evidence",
      "budget_owner": "platform",
      "mode": "propose",
      "privacy_policy": "tenant_to_platform_redacted_signal_v1",
      "auto_allowed": true
    }
  ],
  "provider_call_performed": false,
  "credential_read": false,
  "runtime_mutation": false
}
```

### Create run

```http
POST /dev-orchestrator/runs
```

Allowed only after preview resolves to an automatic mode or valid approval/envelope.

### Approval card

```http
GET /dev-orchestrator/approval-cards/{approval_id}
```

Must show: feature, consumer domain, benefit owner, budget owner, approval owner, requested mode escalation, selected model, cost/risk change, and user/admin choices.

---

## 6. Run state machine

```text
created
 -> resolving_context
 -> resolving_feature
 -> resolving_domain
 -> resolving_budget
 -> resolving_privacy
 -> resolving_model
 -> resolving_sub_agents
 -> governance_gate
 -> dispatch_ready
 -> dispatched
 -> output_validation
 -> readback
 -> complete
```

Exceptional states:

```text
blocked_context
blocked_feature
blocked_budget
blocked_privacy
blocked_model
blocked_sub_agent_policy
blocked_output_policy
awaiting_approval
awaiting_budget_approval
deferred_rate_limited
failed_provider
failed_readback
durable_recovery_required
cancelled
rejected
```

State rules:

- `act` cannot enter `dispatch_ready` without approval and envelope.
- `authority` cannot auto-complete.
- `deferred_rate_limited` is graceful degradation, not failure.
- `failed_readback` cannot become `complete` without recovery or explicit abandoned closure.
- no fallback after committed effect unless durable workflow recovery allows it.

---

## 7. Implementation slices

### Slice 1: Preview and accounting only

```text
- add decision preview endpoint
- no provider calls
- no sub-agent runtime
- no openai-agents-js dependency
- ledger-ready evidence for consumer_domain, benefit_owner, budget_owner, approval_owner, mode, model_policy, privacy_policy, output_policy
```

### Slice 2: OpenRouter observe/propose

```text
- openrouter/free for summary, classification, signal extraction, proposal drafting
- model_usage_ledger
- 429 -> deferred_rate_limited
- 402 -> blocked_budget or awaiting_budget_approval
- no silent paid fallback
```

### Slice 3: Delegate read-only

```text
- map existing agents to sub-agent profiles
- max_sub_agents policy
- deny repo/db/provider/external/local-shell/credential tools
- sub-agent output remains proposal/review only
```

### Slice 4: OpenRouter Management API preview

```text
- readiness preview only
- no key creation, rotation, deletion, or mutation
- management key never used as completion key
```

### Slice 5: Act/authority

```text
- only after observe/propose/delegate ledgers are stable
- requires approval, envelope, typed confirmation, durable workflow/effect commit, same-cycle readback
```

---

## 8. Test matrix

| Scenario | Expected result |
|---|---|
| Tenant session summary | tenant budget, observe mode, session summary write |
| Tenant session reveals platform bug | split outputs, platform budget for platform signal, redaction required |
| User preference inferred | user lane, propose mode, preference proposal only |
| Brand Core improvement | brand lane, proposal only, update requires approval |
| Platform issue clustering | platform lane, known issue candidate only |
| Shared infra model catalog sync | shared infra lane, no tenant budget |
| OpenRouter 429 in observe | deferred_rate_limited, no paid fallback |
| OpenRouter 402 in propose | blocked_budget or awaiting_budget_approval |
| Paid fallback requested | Custom GPT UI approval card required |
| Sub-agent denied tool | blocked_sub_agent_policy before execution |
| Missing mixed-lane privacy policy | blocked_privacy |
| Failed readback | failed_readback; cannot complete |
| Act without envelope | blocked_policy |
| Authority without human approval | awaiting_approval |

---

## 9. Runbooks

### Free quota exhausted

```text
1. Confirm model_usage_ledger status.
2. Check mode.
3. observe: cache -> defer -> rule-based fallback.
4. propose: batch -> defer -> ask if urgent.
5. delegate: reduce sub-agents -> defer -> ask budget owner.
6. never silently use paid fallback.
```

### Mixed-lane privacy block

```text
1. Identify source and target domains.
2. Check privacy_policy_key.
3. Block platform-facing output if missing/stale.
4. Tenant-facing output may proceed if independently eligible.
5. Store no raw tenant content in platform memory.
```

### Sub-agent policy denial

```text
1. Log attempted sub-agent/tool.
2. Confirm routing policy and denied_tools list.
3. Return stable denial before execution.
4. Do not retry with another agent if policy denies the intent.
```

### Readback failure

```text
1. Do not mark complete.
2. Record failed_readback.
3. Retry only if no effect occurred.
4. If effect may have occurred, enter durable recovery.
```

### Paid fallback request

```text
1. Verify primary/free failure or insufficiency.
2. Verify fallback candidate eligibility.
3. Estimate cost for budget owner.
4. Create approval card.
5. Do not dispatch until approval and reservation exist.
```

---

## 10. Observability

Counters:

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
