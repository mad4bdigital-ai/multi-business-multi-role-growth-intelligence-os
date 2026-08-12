# Dev Orchestrator Live Integration Readiness Review

**Status:** design-only readiness review for PR #1898  
**Scope:** documents the current integration state after branch synchronization, CI readback, and repo-patch capability probing.  
**Runtime authorized:** No. **Provider dispatch:** No. **Credentials:** No. **Migrations:** No. **Production mutation:** No.

This review is a companion to the Dev Orchestrator design bundle and records what is integrated, what is only partially integrated, and what must remain blocked before any runtime implementation work starts.

---

## 1. Current integration posture

The Dev Orchestrator design is integrated as a cross-plane overlay over the existing Spec Kit. It is not a replacement for the Shared Asset Fabric or Contextual Policy Composition model.

Current bundle:

```text
dev-orchestrator-consumption-governance-overlay.md
dev-orchestrator-operating-scope-maps.md
dev-orchestrator-implementation-contracts.md
dev-orchestrator-runtime-registry-api-test-runbook-preview.md
dev-orchestrator-spec-kit-coverage-matrix.md
dev-orchestrator-gap-closure-risk-register.md
dev-orchestrator-integration-index.md
```

The bundle establishes a design rule for every intelligence action:

```text
who benefits
who pays
who approves
what data was used
where the output is written
what fallback is allowed
what readback closes the run
```

---

## 2. Live branch synchronization checkpoint

The PR branch was synchronized with `main` using the governed GitHub update-branch flow before this review was added.

Required CI checks were then dispatched/read back on the synchronized branch:

```text
Syntax Check
Architecture Drift Detection
Execution Resolver Gate
Unit & Integration Tests
```

The branch must be rechecked before any future readiness or merge decision because `main` can move after this document is committed.

---

## 3. Integration depth classification

| Area | Current state | Classification |
|---|---|---|
| Cross-plane design | Covered by overlay, scope maps, contracts, runtime/API/test previews, coverage matrix, risk register | Strong |
| Manual discoverability | Covered by `dev-orchestrator-integration-index.md` and docs-agent PR index | Good |
| Inline README references | Desired but not fully applied because governed repo patch capability was not ready at probe time | Partial |
| Original file-by-file references | Covered by coverage matrix and integration index, not patched into every original file | Partial |
| Runtime implementation | Explicitly not authorized in this PR | Blocked by design |
| OpenRouter calls | Explicitly not authorized in this PR | Blocked by design |
| `openai-agents-js` install/use | Optional future runtime only; not authorized here | Blocked by design |
| Migrations/registries | Previewed only; no SQL execution authorized | Blocked by design |
| Sub-agent execution | Read-only/plan-only design only; no runtime execution authorized | Blocked by design |

---

## 4. Repo patch capability probe result

The ideal integration step is to patch short references into the original Spec Kit files, especially:

```text
README.md
spec.md
plan.md
acceptance-matrix.md
threat-model.md
rollout.md
commercial-finops-decision.md
model-governance-decision.md
data-governance-decision.md
durable-workflow-effect-commit-decision.md
observability-slos.md
```

However, the governed `repo_patch_apply` path was probed and returned blocked capability envelopes during this session. The observed blocker class was:

```text
capability: repo_patch_apply
decision: blocked_requires_setup
blocking_gap_count: 4
```

A separate attempt using a write-style operation envelope returned a larger setup gap count. Therefore, this PR keeps direct edits to original files out of scope unless the governed repo-patch capability becomes ready in a later cycle.

The safe integration substitute is:

```text
dev-orchestrator-integration-index.md
docs/auto-docs-agent/pr-1898.md
```

Those files act as discoverability and cross-reference hubs without rewriting original Spec Kit files.

---

## 5. Remaining design gaps to track

The following are intentionally tracked as future implementation gates rather than hidden assumptions:

| Gap | Required closure before runtime |
|---|---|
| Owner conflict resolution | Deterministic precedence for benefit owner, budget owner, and approval owner |
| Mixed-lane evidence lifecycle | Retention, deletion, stale evidence, retraction, and aggregate-preservation states |
| Budget pressure behavior | Priority tiers, sponsor policy, no silent paid fallback, no cross-budget leakage |
| OpenRouter Management API boundary | Readiness/usage/key-limit preview only until explicit mutation approval exists |
| SDK safety | No sandbox/shell/file/repo tools until trace/session/privacy controls are verified |
| Sub-agent recursion | Max depth, max sub-agents, no self-delegation, denied-tool hard fail |
| Partial effects | Unknown-effect recovery and no model fallback after committed effects |
| UI approval transparency | Decision cards must expose owner, budget, mode, risk, data, output, fallback |
| Observability thresholds | Quota pressure, privacy blocks, readback failures, denied tools, stale evidence |
| Negative tests | Prompt injection, hidden paid fallback, tenant leakage, denied tools, readback failure |

---

## 6. Runtime stop conditions

Do not begin runtime implementation until the following are true:

```text
decision preview API shape accepted
ledger/accounting fields accepted
domain/budget/privacy/output resolvers accepted
mixed-lane privacy lifecycle accepted
OpenRouter runtime policy accepted
Management API boundary accepted
Custom GPT approval card minimum content accepted
readback failure behavior accepted
partial-effect recovery accepted
negative test matrix accepted
rollout stop/rollback gates accepted
```

Runtime work must start with preview/accounting only. OpenRouter observe/propose, sub-agent delegation, Management API readiness, act, and authority modes must be separate later slices.

---

## 7. Recommended next implementation PR sequence

```text
PR-A: registry/ledger migration preview -> actual additive migrations
PR-B: decision preview endpoint with no provider calls
PR-C: OpenRouter observe/propose free-first runtime with usage ledger and fallback
PR-D: Custom GPT approval-card surface and decision readback
PR-E: delegate read-only sub-agent routing
PR-F: Management API readiness preview only
PR-G: act mode with capability envelopes and durable workflow/effect commit
PR-H: authority mode with human/platform-admin approval and candidate-specific budget reservation
```

Each PR must include same-cycle readback and negative tests. No PR may combine SDK install, provider dispatch, act mode, and Management API mutation in one step.

---

## 8. Design conclusion

The Dev Orchestrator design is now sufficiently covered as a Spec Kit overlay and risk-registered for future runtime work. The only remaining integration weakness is inline patching of the original files, which should wait until the governed repo-patch capability is ready.

Until then, the integration index and docs-agent PR index are the authoritative navigation layer for this design bundle.
