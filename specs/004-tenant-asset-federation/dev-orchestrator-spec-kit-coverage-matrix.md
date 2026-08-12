# Dev Orchestrator Spec Kit Coverage Matrix

**Status:** design-only coverage expansion for PR #1898  
**Scope:** full Spec Kit crosswalk for the Dev Orchestrator, OpenRouter model lane, optional `openai-agents-js`, and Consumption Governance Layer.  
**Runtime authorized:** No. **Provider dispatch:** No. **Credentials:** No. **Migrations:** No.

## 1. Coverage invariant

Every intelligence action must declare:

```text
who benefits
who pays
who approves
what data was used
where the output is written
what fallback is allowed
what readback closes the run
```

The orchestrator is a cross-plane overlay, not an isolated feature.

## 2. Spec Kit file coverage map

| File | Required orchestrator coverage |
|---|---|
| `README.md` | Link the orchestrator design bundle through the generated docs-agent index. |
| `spec.md` | State the user/platform problem: dynamic intelligence must separate benefit, budget, approval, and data scope. |
| `plan.md` | Add phases: preview -> observe/propose -> delegate-read-only -> management readiness -> act/authority. |
| `tasks.md` | Keep Phase 1 as preview/accounting only; runtime tasks come later. |
| `research.md` | Explain hybrid choice: platform authority + optional SDK runtime + OpenRouter model lane. |
| `current-state.md` | Note that agent registry exists, but dynamic delegation/consumption governance is not yet runtime authority. |
| `additional-dimensions-gap-analysis.md` | Add gaps: budget owner, mixed-lane privacy, 402/429 fallback, sub-agent denial, UI cards. |
| `expanded-platform-plane-architecture.md` | Add dual surfaces: Custom GPT UI + backend Dev Orchestrator. |
| `relationship-diagrams.md` | Add user, tenant, brand, platform, shared infra, and mixed-lane diagrams. |
| `resolution-algorithm.md` | Add resolvers for consumer domain, benefit owner, budget owner, approval owner, mode, model, privacy, output, fallback. |
| `principal-authority-decision.md` | Define approval owners by domain and mode escalation. |
| `tenant-workspace-boundary-decision.md` | Prevent tenant budget from silently funding platform-wide improvement. |
| `permissions-matrix.md` | Add sub-agent read-only/plan-only profile and denied tools. |
| `policy-composition-model.md` | Compose mode, privacy, budget, output, sub-agent, and approval policy with deny-wins behavior. |
| `policy-dsl-examples.md` | Add examples for free-limit fallback, paid fallback approval, mixed-lane redaction, and sub-agent denial. |
| `governance-decision-matrix.md` | Add observe/propose/delegate/act/authority decisions and escalation gates. |
| `data-governance-decision.md` | Add redacted platform signal rules and evidence pointers for tenant-derived signals. |
| `artifact-knowledge-provenance-decision.md` | Treat summaries, signals, proposals, approval cards, and readback as provenance-bearing artifacts. |
| `data-model.md` | Future registries/ledgers must be additive and migration-gated; no hardcoded orchestration. |
| `domain-model-invariants.md` | Add invariants: no silent paid fallback, no raw tenant copy to platform memory, no effect without readback. |
| `api-contracts.md` | Add future previews: decision preview, run create, run status, approval card, model readiness. |
| `commercial-finops-decision.md` | Add budget-owner split, free-first policy, usage ledger, paid fallback approval, and Management API phase. |
| `model-governance-decision.md` | Separate OpenRouter Runtime API from Management API; require allowlist and no unlisted fallback. |
| `credential-installation-model.md` | Runtime key and management key are separate secret references and never exposed to agents/UI. |
| `durable-workflow-effect-commit-decision.md` | Act/authority require approval, envelope, typed confirmation, effect commit, readback, recovery. |
| `observability-slos.md` | Add counters for domain split, 402/429, deferred backlog, readback failure, sub-agent denial. |
| `traceability.md` | Trace source event -> decision ledger -> output -> approval -> readback. |
| `acceptance-matrix.md` | Add tests for domain split, mixed lane, 402/429, paid approval, sub-agent denial, readback failure. |
| `threat-model.md` | Add threats for prompt-to-tool escalation, hidden paid fallback, tenant data leakage, management-key misuse. |
| `migration-cutover-map.md` | Keep runtime rollout sliced; no act/authority until preview/ledger/readback are stable. |
| `rollout.md` | Add stop/rollback criteria per phase. |
| `personalization-adaptation-model.md` | Preferences remain proposals until user/tenant approval. |
| `adaptive-scoring-confidence.md` | Low-confidence/rule-based fallback remains advisory only. |
| `growth-learning-loop.md` | Split tenant asset improvement from platform improvement; mixed lane uses redaction. |
| `platform-growth-operating-model.md` | Platform lane covers bugs, runbooks, PR scopes, migration candidates, routing improvements. |
| `member-invitation-onboarding-model.md` | Capture budget, automation, and approval preferences during onboarding. |
| `completion.json` / `manifest.json` | Include orchestrator coverage references after design freeze. |

## 3. Coverage bundles

```text
Core overlay:
- dev-orchestrator-consumption-governance-overlay.md

Operating maps:
- dev-orchestrator-operating-scope-maps.md

Implementation contracts:
- dev-orchestrator-implementation-contracts.md

Runtime/API/test/runbook preview:
- dev-orchestrator-runtime-registry-api-test-runbook-preview.md

Full Spec Kit crosswalk:
- dev-orchestrator-spec-kit-coverage-matrix.md
```

## 4. Required acceptance scenario groups

```text
Domain/budget:
- tenant summary uses tenant/sponsored budget
- platform issue from tenant evidence uses platform budget
- shared infra never charges tenant budget silently

Model fallback:
- 429 observe => cache/defer/rule-based
- 429 propose => batch/defer/ask if urgent
- 402 propose => blocked_budget or awaiting_budget_approval
- paid fallback => approval card
- fallback after effect => durable recovery

Privacy/mixed lane:
- missing privacy policy blocks platform-facing output
- redaction unavailable blocks platform output only
- platform signal stores evidence pointer and redacted summary
- cross-tenant reuse denied unless aggregate policy permits

Sub-agents:
- brand/growth/seo read-only for brand proposals
- governance_audit read-only for governance review
- repo/db/provider/credential/external/local-shell tools denied
- max sub-agents enforced

Act/authority:
- Brand Core apply requires approval + envelope
- PR creation requires platform admin approval + envelope
- migration apply requires typed confirmation + readback
- authority without human approval waits
```

## 5. Threat-model additions

```text
prompt injection to denied tool -> dispatcher denial
hidden paid fallback -> budget-owner approval + usage ledger
tenant data leak -> redaction + evidence pointer only
Management API used as runtime key -> credential boundary
agent bypasses dispatcher -> no direct credentials/tools
low-confidence fallback becomes policy -> proposal-only output
fallback after side effect -> durable recovery
approval UI lacks risk/cost -> decision card required
sub-agent emits executable patch -> output policy blocks apply
tenant funds platform improvement silently -> budget ledger tests
```

## 6. Implementation order

```text
Phase 0: design-only coverage in PR #1898
Phase 1: decision preview + ledger/accounting only
Phase 2: OpenRouter observe/propose, free-first, fallback ledger
Phase 3: delegate read-only using existing agent registry
Phase 4: OpenRouter Management API readiness preview only
Phase 5: approval-gated act mode
Phase 6: authority mode with human/platform admin approval and durable effect commit
```

Phase 2 cannot begin until Phase 1 proves domain, budget, approval, privacy, output policy, decision ledger, and UI decision-card readback.

Phase 3 cannot begin until Phase 2 proves 402/429 handling, no silent paid fallback, model usage ledger, readback, and no secrets returned.

Phase 5 cannot begin until approval cards, capability envelopes, typed confirmation, durable workflow/effect commit, same-cycle readback, and recovery are proven.

## 7. Completion status

| Area | Design covered? | Runtime allowed now? |
|---|---:|---:|
| Consumption governance | Yes | No |
| User/tenant/platform/shared/mixed lanes | Yes | No |
| Dynamic modes | Yes | No |
| OpenRouter runtime policy | Yes | No |
| OpenRouter Management API boundary | Yes | No |
| Optional `openai-agents-js` role | Yes | No |
| Sub-agent registry use | Yes | No |
| Fallback ladder | Yes | No |
| Decision preview API | Preview only | No |
| Registries and ledgers | Preview only | No |
| Act/authority path | Guarded design only | No |
| Tests/runbooks | Design only | No |

Runtime work must happen in separate implementation PRs with migrations, OpenAPI updates, tests, capability envelopes, and same-cycle readback.
