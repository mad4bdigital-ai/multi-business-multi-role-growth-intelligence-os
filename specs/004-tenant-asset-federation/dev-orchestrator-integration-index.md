# Dev Orchestrator Integration Index

**Status:** design-only integration hub for PR #1898  
**Scope:** manual discoverability and cross-file navigation for the Dev Orchestrator, OpenRouter, optional `openai-agents-js`, sub-agent delegation, and Consumption Governance design bundle.  
**Runtime authorized:** No. **Provider dispatch:** No. **Credentials:** No. **Migrations:** No.

This file exists because the Dev Orchestrator work is a cross-plane overlay. It should be read alongside the original Spec Kit files rather than as a replacement for them.

---

## 1. Integration bundle

Read the bundle in this order:

1. `dev-orchestrator-consumption-governance-overlay.md`  
   Defines the top-level cross-plane overlay: Custom GPT UI surface, backend Dev Orchestrator, consumption domains, OpenRouter runtime lane, optional Agents SDK role, and governance boundary.

2. `dev-orchestrator-operating-scope-maps.md`  
   Expands the operating maps for user, tenant/workspace, brand, platform, shared infrastructure, and mixed lanes.

3. `dev-orchestrator-implementation-contracts.md`  
   Converts the maps into implementation contracts: run envelope, mode contracts, OpenRouter policy, sub-agent contract, privacy/mixed-lane contract, state machines, UI cards, observability, and first implementation slice.

4. `dev-orchestrator-runtime-registry-api-test-runbook-preview.md`  
   Provides future registry/API/test/runbook previews: registry shapes, decision preview API, create-run API, approval card API, state machine, implementation slices, test matrix, and operational runbooks.

5. `dev-orchestrator-spec-kit-coverage-matrix.md`  
   Maps the orchestrator design across the whole Spec Kit and identifies which original files own each decision area.

6. `dev-orchestrator-gap-closure-risk-register.md`  
   Captures remaining design gaps, risk register, owner-conflict precedence, privacy/evidence lifecycle, SDK risks, sub-agent recursion, partial-effect recovery, red-team tests, and rollout stop conditions.

---

## 2. How this integrates with the original Spec Kit

| Original file | Integration role |
|---|---|
| `README.md` | Entry point for the shared asset fabric. This index provides the manual navigation hub for the Dev Orchestrator overlay until the original README can be patched through the governed repo-patch capability. |
| `spec.md` | Should reference the orchestrator as a design-only operating overlay that separates benefit owner, budget owner, approval owner, data use, output policy, and fallback. |
| `plan.md` | Should align the runtime rollout to phases: preview/accounting, OpenRouter observe/propose, delegate read-only, Management API readiness preview, act, authority. |
| `tasks.md` | Future tasks must remain design-only in this PR; runtime migrations/routes/tests belong in separate implementation PRs. |
| `relationship-diagrams.md` | Should include the dual-agent surface: Custom GPT UI plus backend Dev Orchestrator cloud loop. |
| `expanded-platform-plane-architecture.md` | Should place the orchestrator across runtime orchestration, model governance, FinOps, data governance, provenance, observability, and human operations planes. |
| `resolution-algorithm.md` | Should include consumer-domain, benefit-owner, budget-owner, approval-owner, mode, model, privacy, output, fallback, and readback resolvers. |
| `permissions-matrix.md` | Should enforce sub-agent read-only/plan-only boundaries and denied tools. |
| `policy-composition-model.md` | Should compose budget, privacy, output, sub-agent, model, approval, and fallback policies with deny-wins behavior. |
| `data-governance-decision.md` | Should own mixed-lane redaction, evidence-pointer lifecycle, retention, retraction, provider submission, and no raw tenant copy. |
| `commercial-finops-decision.md` | Should own budget-owner split, sponsored work, free-first policy, paid fallback approval, model usage ledger, and reservation requirements. |
| `model-governance-decision.md` | Should own OpenRouter runtime policy, allowlist, free-limit fallback, no unlisted runtime override, and fallback eligibility. |
| `credential-installation-model.md` | Should own runtime key vs Management API key separation and no secret exposure to agents/UI. |
| `durable-workflow-effect-commit-decision.md` | Should own act/authority effect boundaries, partial-effect recovery, and no silent fallback after committed effects. |
| `artifact-knowledge-provenance-decision.md` | Should treat summaries, proposals, signals, approval cards, and readbacks as provenance-bearing artifacts. |
| `observability-slos.md` | Should own counters, health tiles, SLO thresholds, alert routes, quota pressure, readback failures, privacy blocks, and denied tool attempts. |
| `threat-model.md` | Should include prompt-to-tool escalation, hidden paid fallback, tenant leakage, Management API misuse, SDK trace leakage, self-delegation, and fallback-after-effect threats. |
| `acceptance-matrix.md` | Should include negative tests for budget mixing, privacy blocks, readback failures, denied sub-agent tools, 402/429 handling, and approval-card transparency. |
| `rollout.md` | Should enforce phased gates and stop/rollback criteria before runtime activation. |

---

## 3. Current branch state after synchronization

The branch has been synchronized with `main` through GitHub's update-branch flow. At the time this index was introduced, the synchronized head was expected to be read back and verified by CI before any further readiness claim.

This design bundle remains non-runtime. It does not grant authority to install SDK dependencies, call OpenRouter, mutate registry rows, apply migrations, execute sub-agents, or enable act/authority mode.

---

## 4. Inline integration still pending

The ideal final state is to patch the original files with short references to this bundle. That requires the governed repo patch capability to be ready.

Current blocker observed during this session:

```text
capability: repo_patch_apply
decision: blocked_requires_setup
blocking_gap_count: 4
```

Until that capability is ready, this integration index plus the docs-agent PR index are the safe manual-discoverability layer.

---

## 5. Runtime implementation guard

Do not start runtime implementation until all of the following are true:

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

Those design guards are documented in `dev-orchestrator-gap-closure-risk-register.md`.

---

## 6. Design conclusion

The Dev Orchestrator overlay integrates with PR #1898 as a cross-plane operating model. It does not replace the shared asset fabric; it adds the consumption, budget, approval, model, sub-agent, fallback, and readback discipline needed before any dynamic intelligence runtime can safely exist.
