# Dev Orchestrator Gap Closure and Design Risk Register

**Status:** design-only gap audit for PR #1898  
**Scope:** closes remaining design gaps around Dev Orchestrator, OpenRouter, optional `openai-agents-js`, sub-agent delegation, user/tenant/platform consumption separation, and Consumption Governance.  
**Runtime authorized:** No. **Provider dispatch:** No. **Credential access:** No. **Migrations:** No. **Production mutation:** No.

This document records what can still be included in the Spec Kit to reduce ambiguity before any runtime implementation PR. It should be read after:

```text
dev-orchestrator-consumption-governance-overlay.md
dev-orchestrator-operating-scope-maps.md
dev-orchestrator-implementation-contracts.md
dev-orchestrator-runtime-registry-api-test-runbook-preview.md
dev-orchestrator-spec-kit-coverage-matrix.md
```

---

## 1. Gap audit summary

| Area | Current coverage | Remaining gap | Design-only closure |
|---|---|---|---|
| Consumption ownership | Benefit/budget/approval owners defined | Need conflict resolution when owners disagree | Add owner-conflict decision rules and precedence |
| Mixed lane privacy | Redaction/evidence pointer described | Need strict “no raw tenant copy” and retraction behavior | Add redaction, retention, deletion, and evidence-pointer lifecycle |
| Budget/FinOps | Free-first and approval fallback covered | Need budget exhaustion priority rules | Add priority tiers and sponsor-policy handling |
| OpenRouter | Runtime vs Management API separated | Need management-key misuse guard and quota drift handling | Add management API boundary, read-only readiness, and key isolation rules |
| Agents SDK | Optional thin runtime covered | Need tracing/sandbox/session data restrictions | Add SDK adoption safety contract |
| Sub-agents | Read-only routing covered | Need recursion, max-depth, and tool escalation rules | Add max depth, denied-tool behavior, and no self-delegation loops |
| Act/Authority | Approval/envelope/readback covered | Need recovery for partial/unknown effects | Add irreversible/unknown effect recovery rules |
| UI/Custom GPT | Approval cards covered | Need user-visible cost/risk reason and “why now?” | Add decision-card content minimums |
| Observability | Counters and health tiles listed | Need SLO thresholds and alert routing | Add SLO examples and escalation owners |
| Testing | Test groups listed | Need red-team cases and negative tests | Add abuse/edge-case matrix |
| Rollout | Phased slices covered | Need stop conditions and rollback per phase | Add phase gates, stop/rollback criteria |
| Legal/compliance | Privacy implied | Need data residency, retention, deletion, provider submission boundaries | Add compliance checklist |

---

## 2. Owner conflict resolution

Every run resolves three owners:

```text
benefit_owner
budget_owner
approval_owner
```

These may disagree. The design must define deterministic conflict behavior.

| Conflict | Rule |
|---|---|
| Tenant benefits but platform also learns | Split outputs; tenant output uses tenant/sponsored budget, platform output uses platform budget after redaction |
| Tenant wants paid fallback but platform policy blocks provider | Deny provider escalation; no cost approval can override provider/data policy |
| User preference conflicts with tenant policy | Tenant policy wins for tenant assets; user preference may remain personal |
| Platform improvement derived from tenant data lacks redaction policy | Block platform output; tenant-facing output may continue if independently eligible |
| Approval owner unknown | Block act/authority; allow observe/propose only if output policy permits |
| Budget owner unknown | Block model dispatch; allow non-model rule-based preview only |
| Benefit owner unknown | Block persistence; allow transient preview only |
| Multiple tenants in evidence | Require aggregate/cross-tenant policy; otherwise block platform output |

Precedence:

```text
privacy/data-use policy
  > tenant/workspace boundary
  > principal/approval authority
  > budget policy
  > model policy
  > sub-agent routing
  > output policy
  > fallback policy
```

Deny wins unless an explicit higher-authority exception exists.

---

## 3. Privacy, retention, and evidence-pointer lifecycle

Mixed-lane outputs need a lifecycle, not only redaction.

```text
tenant source evidence
   -> eligibility check
   -> redaction/projection
   -> evidence pointer
   -> platform signal/proposal
   -> retention timer
   -> deletion/retraction handling
```

Rules:

- Raw tenant content must not be copied into platform memory.
- Platform-facing signals may store evidence pointers and redacted summaries only.
- Evidence pointers must respect source deletion, tenant offboarding, retention expiry, and access revocation.
- If source evidence becomes unavailable, derived platform signal state becomes `evidence_stale` unless an approved aggregate record exists.
- Provider-submitted content must be recorded as a data-use event.
- Model training use is denied unless explicit policy allows it; default is no model training.
- Cross-tenant aggregation requires cohort/threshold policy and must not expose individual tenant evidence.

Required future states:

```text
evidence_active
evidence_redacted
evidence_stale
evidence_retracted
evidence_expired
aggregate_preserved
```

---

## 4. Budget and priority behavior under pressure

When free quota or platform/tenant budget is constrained, jobs must degrade predictably.

Priority tiers:

| Priority | Examples | Limit behavior |
|---|---|---|
| P0 safety/production | active incident, readback failure, unknown effect recovery | platform budget, admin escalation, no silent paid fallback |
| P1 user-visible committed flow | approval card, pending user decision, current session summary | cache/batch, ask if paid fallback needed |
| P2 background intelligence | session backlog, proposal drafting, clustering | defer/batch/rule-based fallback |
| P3 optimization | catalog sync, trace compaction, optional comparisons | throttle/defer |
| P4 experimentation | model comparison, non-critical sub-agent review | disable first |

Budget separation:

```text
tenant budget cannot pay for platform-wide improvement
platform budget cannot silently fund tenant premium work
shared infra budget cannot mutate tenant assets
sponsored budget must be explicit and ledgered
```

---

## 5. OpenRouter Management API boundary concerns

The Management API must not become a completion path or an agent tool.

Allowed future use:

```text
readiness preview
key existence/health without secret disclosure
usage monitoring
quota/limit reading
key rotation proposal
tenant/workspace key-limit planning
```

Denied by default:

```text
agent-visible API keys
management key returned to UI/model/agent
completion calls through management key
automatic key creation/rotation/deletion
tenant key reuse for platform budget
platform key reuse for tenant budget without sponsored policy
```

Any Management API mutation must require:

```text
platform admin approval
capability envelope
typed confirmation
secret-free readback
audit ledger
rollback/rotation plan
```

---

## 6. Optional `openai-agents-js` adoption risks

If the SDK is adopted later, these restrictions must be explicit.

| Concern | Required control |
|---|---|
| Sandbox/file/shell tools | Disabled in first adoption slice |
| SDK tracing leaking data | Trace sink must be platform-controlled and redacted |
| Agent sessions storing raw tenant content | Use PlatformSessionAdapter with retention/privacy policy |
| Agent-as-tool escalation | Tools must wrap governed dispatcher only |
| Handoffs losing policy context | Every handoff carries run envelope and denied tool list |
| Recursive delegation | Max depth and max sub-agents enforced |
| Model provider override | No unlisted runtime override |
| Human-in-loop mismatch | SDK interruption maps to platform approval hold |
| Tool result hallucination | Output validation and readback required before completion |

SDK rule:

```text
The platform decides policy. The SDK coordinates only after policy resolution.
```

---

## 7. Sub-agent recursion and escalation limits

Sub-agent routing needs hard ceilings.

Defaults:

```json
{
  "max_sub_agents": 2,
  "max_delegation_depth": 1,
  "self_delegation_allowed": false,
  "cross_domain_delegation_requires_policy": true,
  "execution_allowed_by_default": false,
  "local_agent_allowed_by_default": false
}
```

Denied actions for all initial sub-agents:

```text
repo_patch
db_write
provider_dispatch
credential_read
external_send
local_shell
file_write
deployment
migration_apply
policy_apply
```

If a sub-agent requests a denied tool:

```text
record denied attempt
return stable denial
do not retry with another agent to bypass policy
offer proposal-only route if safe
```

---

## 8. Act/authority partial-effect recovery

Act/authority cannot rely on model fallback after side effects.

Effect safety states:

```text
proposal_only
approval_requested
approval_granted
capability_envelope_created
typed_confirmation_received
effect_attempted
effect_verified
effect_unknown
effect_failed
reconciliation_required
closed
```

Rules:

- If `effect_unknown`, do not retry automatically.
- If readback fails after possible effect, create recovery case.
- If model limit occurs after effect attempt, do not switch model silently.
- If output validation fails after effect, do not mark run complete.
- If approval expires mid-run, stop before next effect.
- If authority conflict appears after approval, revalidate before effect.

---

## 9. Custom GPT UI decision-card minimums

Any approval or paid escalation shown to Custom GPT UI must include:

```json
{
  "feature_key": "brand_core_update_proposal",
  "consumer_domain": "brand",
  "benefit_owner": "brand",
  "budget_owner": "tenant",
  "approval_owner": "tenant_admin",
  "current_mode": "propose",
  "target_mode": "act",
  "selected_model": "openrouter/free or paid candidate",
  "cost_change": "none | free_to_paid | budget_owner_change",
  "risk_change": "low_to_medium | medium_to_high",
  "data_used": "summary of evidence scope",
  "outputs_to_write": ["..."],
  "denied_actions": ["..."],
  "fallback_if_denied": "defer | proposal_only | rule_based",
  "why_now": "reason this approval is being requested",
  "options": ["approve_once", "reject", "defer", "request_deeper_review"]
}
```

Approval UI must not hide:

- paid fallback
- budget owner change
- tenant-to-platform data reuse
- act/authority escalation
- local or provider execution
- any credential or secret boundary

---

## 10. Observability thresholds

Initial threshold examples:

| Signal | Warning | Critical |
|---|---:|---:|
| free limit hits | > 20/day/domain | > 80% of daily cap |
| deferred backlog age | > 6h | > 24h |
| readback failures | > 1% runs | any act/authority readback failure |
| policy blocks | spike > 2x baseline | repeated denied tool attempts |
| mixed-lane privacy blocks | any unresolved > 24h | platform output attempted without policy |
| paid fallback requests | > configured budget trend | any silent paid fallback attempt |
| sub-agent denied tools | > 3/day | any denied execution tool attempt |
| evidence stale | > 5% platform signals | stale evidence on active decision |

Operational attention routing:

```text
tenant budget issue -> tenant admin / billing UI
platform budget issue -> platform admin
privacy block -> governance/data owner
readback failure -> operations/recovery
sub-agent denial spike -> governance audit
management API boundary issue -> provider ops + platform admin
```

---

## 11. Red-team and negative test additions

Add tests for:

```text
Prompt asks agent to ignore budget and use paid model
Prompt asks sub-agent to patch repo directly
Tenant data is used to create platform issue without redaction policy
OpenRouter Management API key is accidentally offered as runtime key
Free quota hit causes silent paid fallback
Readback fails but run is marked complete
Brand Core update applied from proposal without approval
User preference becomes tenant policy without tenant approval
Sub-agent delegates to itself or another agent to bypass denied tool
SDK trace stores raw tenant data
Rule-based fallback becomes durable policy
Approval card hides budget owner
Mixed lane charges tenant for platform improvement
Provider returns tool-like instruction and system executes it
Evidence source is deleted but platform signal remains active
```

---

## 12. Stop conditions before runtime implementation

Do not implement runtime until these design gaps are closed or explicitly accepted:

```text
owner conflict precedence defined
mixed-lane retention/retraction defined
budget pressure priority tiers defined
OpenRouter Management API boundary defined
SDK tracing/session restrictions defined
sub-agent recursion and denied-tool behavior defined
act/authority unknown-effect recovery defined
Custom GPT approval-card minimum content defined
observability thresholds defined
negative/red-team tests listed
rollout stop/rollback criteria defined
```

---

## 13. Rollout stop and rollback criteria

Phase stop criteria:

| Phase | Stop if |
|---|---|
| Preview/accounting | owner/budget/privacy cannot be resolved deterministically |
| OpenRouter observe/propose | any paid fallback happens without approval |
| Delegate read-only | any sub-agent gets execution/local/credential/repo/provider tools |
| Management API preview | management key appears in model/agent/UI output |
| Act | any effect lacks approval/envelope/readback |
| Authority | any authority decision lacks human/platform admin approval |

Rollback behavior:

```text
disable phase flag
stop new runs
preserve ledger
mark in-flight runs deferred or recovery_required
do not delete evidence
do not silently retry with higher-cost model
surface status in Custom GPT UI/admin console
```

---

## 14. What can be included in PR #1898

Allowed now:

```text
gap register
risk register
crosswalk tables
future registry/API/test previews
runbooks
state machines
acceptance scenarios
threat model additions
rollout gates
```

Not allowed in this design PR:

```text
migrations
runtime routes
model dispatch
OpenRouter calls
OpenRouter Management API calls
credential reads
SDK dependency install
sub-agent execution
act/authority enablement
production enforcement
```

This preserves PR #1898 as design-only while closing ambiguity before runtime work begins.
