# Dev Orchestrator Trigger, Starter and Workflow Contract

**Status:** design-only contract for unified interactive and autonomous entrypoints.

## 1. Principle

Triggers express intent and scheduling context. They do not embed provider-specific execution. A reusable starter, n8n node, webhook or schedule creates the same orchestration-run request consumed by the platform kernel.

## 2. Trigger registry shape

```json
{
  "trigger_key": "weekly_growth_review",
  "trigger_type": "scheduled_trigger",
  "goal_template_key": "growth_review_v1",
  "agent_strategy": "platform_select",
  "preferred_agent_keys": ["analytics_agent", "growth_agent", "governance_agent"],
  "preference_profile_key": "cost_optimized_subscription_first",
  "execution_mode": "autonomous",
  "output_profile_key": "executive_brief",
  "approval_policy_key": "proposal_only",
  "status": "planned"
}
```

## 3. Trigger types

| Trigger | Behavior |
|---|---|
| `tenant_gpt_prompt` | Interactive goal from the Tenant GPT. |
| `manual_ui_start` | User starts a configured run from the platform UI. |
| `manual_starter_template` | Reusable parameterized starter. |
| `prompt_intent` | Router maps natural-language intent to an approved starter or capability. |
| `n8n_trigger` | n8n creates a run and waits, polls, or receives callback. |
| `scheduled_trigger` | Platform scheduler creates an autonomous run. |
| `webhook_trigger` | Authenticated external event starts a run. |
| `platform_event` | Internal governed event starts or resumes a run. |
| `approval_resume` | Approved hold resumes the exact bound plan. |
| `recovery_resume` | Recovery policy resumes a failed or partial run. |
| `agent_callback` | An agent surface returns a validated result or progress event. |

## 4. Manual starter

A starter contains a goal template, required parameters, permitted agents, preference defaults, output profile and approval behavior. It may be exposed in Tenant GPT conversation starters, the platform dashboard, an n8n catalog, or an API client.

Starters cannot include raw credentials, arbitrary URLs, unregistered action keys, unrestricted shell commands, or a forced runtime that bypasses eligibility.

## 5. Prompt intent

Prompt routing sequence:

1. authenticate principal and resolve tenant;
2. classify business activity;
3. match an approved intent/starter;
4. validate required parameters;
5. resolve eligible agents and surfaces;
6. create an orchestration plan preview;
7. request approval when policy requires it;
8. start the run.

Unmatched prompts remain advisory and must not generate arbitrary execution plans with authority.

## 6. Unified create-run request

```json
{
  "entrypoint": "n8n",
  "trigger_key": "weekly_growth_review",
  "goal": "Create the weekly growth brief",
  "execution_mode": "autonomous",
  "agent_strategy": "platform_select",
  "requested_agents": [],
  "parameters": {"period": "7d"},
  "preference_overrides": {"allow_paid_fallback": false},
  "callback_ref": "registered_callback_42",
  "idempotency_key": "weekly-growth-2026-07-13"
}
```

The platform resolves tenant, user, workspace, brand and activity from authenticated context and registered references. Clients may not assert unauthorized ownership fields.

## 7. Run states

```text
queued
planning
awaiting_connection
awaiting_session
awaiting_approval
running_agents
awaiting_callback
synthesizing
completed
partial
blocked
failed
recovery_required
cancelled
```

State transitions are append-only events. Retries reuse idempotency and effect keys.

## 8. n8n contract

n8n may:

- create an orchestration run;
- read bounded status and progress;
- wait for a signed callback or poll a result reference;
- submit an approval decision through a registered approval path;
- continue with a validated result envelope.

n8n may not receive browser cookies, provider credentials or unrestricted platform tokens. Callback URLs are pre-registered or signed references rather than arbitrary client-supplied destinations.

## 9. Scheduled workflow policy

Autonomous runs define:

- missing-input behavior;
- approval timeout behavior;
- session-expired behavior;
- retry and backoff policy;
- partial-result acceptance;
- maximum agent count and depth;
- maximum duration and budget;
- notification destination;
- fallback policy;
- stop and recovery rules.

A scheduled Browser Bridge run is opt-in and lower priority than an active user interaction on the same account.

## 10. Result envelope

```json
{
  "run_id": "orch_run_123",
  "status": "completed",
  "summary": "...",
  "agent_results": ["result_ref_1", "result_ref_2"],
  "evidence_refs": ["evidence_ref_1"],
  "actions_requested": [],
  "readback_verified": true,
  "privacy_status": "passed",
  "cost_status": "within_reservation"
}
```

Raw DOM content and unvalidated model text are evidence inputs, not final result envelopes.

## 11. Idempotency and concurrency

- create-run operations require an idempotency key for retryable triggers;
- schedules derive stable occurrence keys;
- one browser identity uses bounded queue/concurrency policy;
- duplicate callbacks are ignored after signature and event-key validation;
- recovery resumes the same plan unless a new plan is explicitly approved.

## 12. Implementation boundary

This contract introduces no scheduler, route, n8n node, webhook, queue or database migration in PR #1898.