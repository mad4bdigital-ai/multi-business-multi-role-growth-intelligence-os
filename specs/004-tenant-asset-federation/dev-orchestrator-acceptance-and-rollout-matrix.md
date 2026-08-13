# Dev Orchestrator Acceptance and Rollout Matrix

**Status:** design-only acceptance and rollout extension for PR #1898  
**Runtime authorized:** No. **Provider dispatch:** No. **Credentials:** No. **Migrations:** No. **Production mutation:** No.

This matrix converts the Dev Orchestrator design bundle into scenario-level acceptance gates and phased rollout criteria. It complements the `dev-orchestrator-*` design files and keeps the same invariant for every future intelligence action:

```text
who benefits
who pays
who approves
what data was used
where the output is written
what fallback is allowed
what readback closes the run
```

## 1. Acceptance dimensions

| Dimension | Required evidence |
|---|---|
| Consumer domain | user, tenant, brand, platform, shared infrastructure, or mixed lane resolved deterministically |
| Benefit owner | entity that receives value is explicit |
| Budget owner | entity charged or quota-consumed is explicit |
| Approval owner | human/platform/tenant authority required for escalation is explicit |
| Mode | observe, propose, delegate, act, or authority resolved before model/tool work |
| Data scope | source data, redaction, retention, and evidence pointer policy resolved |
| Model policy | provider/model/fallback eligibility resolved before dispatch |
| Output policy | writable surface and approval requirements resolved |
| Sub-agent policy | allowed agents, max depth, denied tools, and no self-delegation enforced |
| Readback | completion requires same-cycle readback or recovery case |
| Ledger | decision and model usage are ledger-ready |

## 2. Mode acceptance matrix

| Mode | Auto allowed | Allowed output | Denied by default | Required readback |
|---|---:|---|---|---|
| observe | Yes | summary, classification, health snapshot | apply, task creation, provider write, repo mutation, credential read, external send | output linked to source event |
| propose | Yes | proposal, signal, preference proposal, runbook suggestion | durable policy change, Brand Core apply, workflow apply, paid fallback without approval | proposal persisted with owner/budget/approval fields |
| delegate | Yes, read-only | sub-agent review, comparison, recommendation, delegation plan | repo patch, DB write, provider dispatch, local shell, credential read, external send | denied-tool audit and confidence recorded |
| act | No | governed effect through platform workflow only | direct model/tool action, no-envelope execution, silent retry | effect commit readback or recovery case |
| authority | No | high-risk decision after human/platform-admin approval | automatic completion, model-only decision | approval, evidence bundle, and candidate-specific reservation |

Mode escalation must be explicit: `observe -> propose -> delegate -> act -> authority`. No run may skip directly to act or authority because a model or sub-agent suggested it.

## 3. Consumer-domain acceptance matrix

| Scenario | Expected classification | Budget owner | Approval owner | Output rule |
|---|---|---|---|---|
| User personal digest | user | user/free/sponsored | user for preference activation | personal summary/proposal only |
| Tenant session summary | tenant | tenant/sponsored | tenant admin for apply | summary may auto-write only if policy allows |
| Brand Core improvement | brand | tenant | brand owner or tenant admin | proposal only; apply requires approval |
| Platform bug inferred from tenant session | mixed | split tenant/platform | platform admin for issue, tenant admin for tenant apply | tenant-facing output and redacted platform signal split |
| Shared model catalog sync | shared infrastructure | platform/shared infra | platform admin for mutation | observe/propose only in this PR |
| Cross-tenant learning signal | mixed/aggregate | platform | platform/data governance | aggregate only; no raw tenant evidence |

Mixed-lane acceptance requires split outputs and split ledgers.

## 4. Budget and fallback acceptance

| Condition | Expected behavior |
|---|---|
| OpenRouter free route available | use allowlisted free-first policy when dispatch is allowed |
| 429 rate limit in observe | cache, batch, defer, or rule-based low-confidence fallback |
| 429 rate limit in propose | batch, defer, or ask if urgency is user-visible |
| 402 insufficient credits | blocked_budget or awaiting_budget_approval |
| Paid fallback requested | approval card shows budget owner, cost/risk change, data used, and fallback reason |
| Paid fallback denied | no dispatch; return proposal-only/deferred state |
| Paid fallback after committed effect | forbidden unless checkpoint proves no further side effect can occur |
| Tenant budget would fund platform improvement | deny unless sponsored policy is explicit and ledgered |
| Platform budget would fund tenant premium work | deny unless platform sponsorship is explicit and ledgered |

Silent paid fallback is always a failure.

## 5. Privacy and mixed-lane acceptance

| Scenario | Expected result |
|---|---|
| Tenant raw data used for tenant summary | tenant memory/output only; no platform memory copy |
| Tenant evidence creates platform signal | redaction required; evidence pointer allowed; raw content denied |
| Evidence pointer becomes stale | derived platform signal becomes `evidence_stale` unless aggregate-preserved |
| Tenant deletion/offboarding | evidence pointers and derived state follow retention/retraction policy |
| Cross-tenant aggregation | minimum cohort and no individual tenant reconstruction |
| Provider submission | logged as data-use event; model-training use denied by default |
| Missing privacy policy | platform-facing output blocked; tenant-facing output may proceed if independently eligible |

## 6. Sub-agent and SDK acceptance

| Scenario | Expected result |
|---|---|
| Brand/growth/SEO review requested | max two read-only sub-agents; proposal/review output only |
| Governance review requested | governance agent may review policy and emit advisory signal |
| Sub-agent requests repo patch, DB write, provider dispatch, credential read, local shell, or external send | denied before execution and logged |
| Sub-agent delegates to itself | blocked as self-delegation |
| Sub-agent delegates to another agent to bypass policy | blocked as recursion/bypass |
| Max depth exceeded | blocked_sub_agent_policy |
| SDK sessions | PlatformSessionAdapter enforces privacy/retention and no raw tenant platform copy |
| SDK tracing | trace sink is platform-controlled and redacted |
| SDK tools | all tools wrap governed dispatcher; no direct secrets or local shell |
| SDK handoffs | every handoff carries run envelope, denied tool list, and policy context |

The SDK coordinates. The platform decides.

## 7. Act and authority acceptance

| Scenario | Required behavior |
|---|---|
| Brand Core apply | approved proposal, capability envelope, typed confirmation, effect commit, readback |
| Workflow activation | tenant admin approval, capability envelope, readback and rollback path |
| Repo mutation | platform admin approval, repo patch capability, CI/readback |
| Migration apply | migration authorization, typed confirmation, statement readback, rollback plan |
| External send | explicit approval, recipient/output policy, effect readback |
| Unknown effect | recovery case; no automatic retry |
| Readback failure after possible effect | durable recovery required |
| Approval expires mid-run | stop before next effect |
| Authority decision lacks human/platform approval | awaiting_approval; cannot auto-complete |

## 8. Negative test matrix

| Test | Expected failure |
|---|---|
| Prompt asks to ignore budget and use paid model | blocked_budget or approval card |
| Prompt asks sub-agent to patch repo directly | blocked_sub_agent_policy |
| Prompt asks to copy tenant raw session into platform memory | blocked_privacy |
| Management API key offered as runtime key | blocked_model or blocked_credential_boundary |
| Free quota hit causes silent paid fallback | test fails |
| Readback fails but run marked complete | test fails |
| Brand Core update applied from proposal without approval | test fails |
| User preference becomes tenant policy without tenant approval | test fails |
| SDK trace stores raw tenant prompt | test fails |
| Rule-based fallback becomes durable policy | test fails |
| Evidence source deleted but signal remains active | test fails |
| Authority mode completes automatically | test fails |

## 8A. Multi-surface execution acceptance

| Scenario | Required behavior |
|---|---|
| Tenant GPT orchestrates platform sub-agents | Logical agents are resolved through the platform; the GPT may request or synthesize but may not bypass eligibility or effect authority. |
| Custom GPT Browser Bridge | User-owned profile, exact GPT verification, bounded queue, output stabilization, platform validation, and readback are required. |
| Gemini Custom Gem Bridge | Google identity and Gem access are verified; target mismatch, revocation, or account switching blocks the run. |
| ChatGPT Workspace Agent | Official API capability and published-agent evidence are required; tenant access is authorized separately through the Mad4B connected app. |
| Mad4B connected MCP app | OAuth identity, workspace permission, tenant scope, tool allowlist, approval behavior, and readback are enforced. |
| Hermes or OpenClaw | Runtime health, sandbox, skills/tools, channel identity, provider/model compatibility, and scoped memory are validated. |
| n8n or scheduled run | Stable idempotency key, callback or polling contract, autonomous failure policy, budget ceiling, and bounded duration are required. |
| Manual starter or prompt intent | Starter and intent must resolve to registered activities, logical agents, parameters, and policies; arbitrary runtimes and URLs are rejected. |
| User preference changes execution order | Preferences rank only eligible candidates and cannot override platform, tenant, privacy, budget, tool, or act/authority denials. |
| Browser/API/local fallback | Fallback is typed, explained, budget-compatible, and prohibited after committed or unknown effects. |
| Duplicate trigger or callback | Exactly-once continuation is preserved through event keys, signatures, leases, and idempotency. |
| Missing output validation or readback | Run remains failed, partial, blocked, or recovery-required; it cannot be marked completed. |

Required multi-surface negative tests include profile/tenant crossover, exact-target mismatch, prompt-injected tool JSON, unregistered callback URL, Workspace Agent without connected-app authorization, local terminal/file access outside the tool profile, scheduled reuse of an active interactive tab, silent paid fallback, and fallback after unknown effect.

## 9. Rollout phases

| Phase | Name | Allowed behavior | Stop condition |
|---:|---|---|---|
| 0 | Design-only coverage | docs, crosswalks, acceptance, risk register | any runtime/provider/credential/migration change |
| 1 | Preview/accounting | decision preview with no model call; ledger-ready fields | unresolved owner/budget/privacy/output policy |
| 2 | OpenRouter observe/propose | free-first summaries/proposals with usage ledger | silent paid fallback, missing readback, secret exposure |
| 3 | Delegate read-only | read-only sub-agent reviews and plans | denied tool bypass, recursion, local shell/file/repo/db/provider attempt |
| 4 | Management API readiness preview | key/usage/limit readiness without mutation | management key visible to UI/model/agent |
| 5 | Approval-gated act | durable workflow/effect commit with approval/envelope/readback | unknown effect without recovery, no typed confirmation |
| 6 | Authority mode | human/platform-admin high-risk approvals | auto-completion or missing evidence bundle |

Each phase must include same-cycle readback and rollback/stop rules before promotion.

## 10. Rollout readiness checklist

Before any future runtime PR moves beyond Phase 1:

```text
[ ] Decision preview endpoint shape accepted
[ ] Ledger fields accepted
[ ] Domain/benefit/budget/approval owner resolver accepted
[ ] Privacy/output/fallback policy resolver accepted
[ ] Error envelope and status model accepted
[ ] OpenAPI 3.1 contract drafted
[ ] No provider dispatch in preview phase
[ ] Negative tests included
[ ] Readback behavior defined
[ ] Operational attention routing defined
```

Before any future OpenRouter runtime PR:

```text
[ ] Runtime API and Management API separated
[ ] Allowlist enforced
[ ] 402/429 behavior tested
[ ] Usage ledger implemented
[ ] Paid fallback approval card implemented
[ ] No silent cross-budget funding
[ ] No fallback after committed effect
```

Before any future sub-agent PR:

```text
[ ] Max sub-agent count and depth enforced
[ ] Denied tools enforced before execution
[ ] No self-delegation
[ ] No local shell/file/repo/db/provider/credential/external-send tools
[ ] Sub-agent output remains review/proposal only
```

Before any future act/authority PR:

```text
[ ] Capability envelope ready
[ ] Typed confirmation ready
[ ] Durable workflow/effect commit ready
[ ] Same-cycle readback ready
[ ] Unknown-effect recovery ready
[ ] Human/platform admin approval ready
[ ] Rollback/compensation plan ready
```

## 11. Operational runbooks to implement later

| Runbook | Trigger |
|---|---|
| Free quota exhausted | OpenRouter 429 or free cap pressure |
| Paid fallback approval requested | 402 or approved escalation path |
| Mixed-lane privacy block | tenant-derived platform signal lacks policy |
| Stale evidence pointer | source evidence deleted/expired/revoked |
| Sub-agent denied tool attempt | denied repo/db/provider/credential/local/external tool |
| Readback failure | output/effect cannot be verified |
| Unknown partial effect | side effect may have occurred |
| SDK trace redaction failure | raw tenant data appears in trace/session |
| Approval stuck | approval card exceeds SLA |
| Budget owner conflict | benefit/budget/approval owners disagree |

## 12. Merge posture for PR #1898

This document does not authorize runtime. It strengthens PR #1898 by making future acceptance and rollout criteria explicit.

```text
design-only
no migrations
no runtime route activation
no provider dispatch
no OpenRouter call
no Management API mutation
no credential read
no SDK install
no sub-agent execution
no act/authority enablement
```

Future implementation must be split into small PRs with tests, readback, security review, and rollback notes.
