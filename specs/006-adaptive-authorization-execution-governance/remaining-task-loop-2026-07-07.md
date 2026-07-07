# Remaining Task Loop — Adaptive Authorization and Execution Governance

**Feature:** `006-adaptive-authorization-execution-governance`  
**Loop date:** 2026-07-07  
**Latest observed main SHA:** `15f3b69e2279d4d260995c4f466bc07a35e52584`  
**Loop type:** governed repository status and task-evidence reconciliation  
**Runtime authority:** SQL primary  
**Provider mutation:** none  
**Migration execution:** none

## Loop inputs

- `completion.json` on `main`
- `tasks.md` on `main`
- `requirements.md` on `main`
- PR #1976 GitHub readback
- deleted branch readback for `gpt/docs/20260629-adaptive-auth-pre-pr2-readiness`
- live SQL data-source census
- live `tenant_effective_capability_readiness_smoke`
- source inspection of `http-generic-api/tenantEffectiveCapabilityResolver.js`
- source inspection of `http-generic-api/test-semantic-capability-effective-resolution.mjs`

## Confirmed delivery readback

| Item | Evidence | Status |
|---|---|---|
| PR #1976 | closed, merged, merge commit `14454ecf075951cb9c56a40e577527c972c1e291` | complete |
| PR #1976 branch | GitHub ref readback returned 404 | deleted |
| SQL runtime authority | platform data-source census returned `runtime_authority=sql` | confirmed |
| Sheets role | census returned `async_mirror_and_recovery` | confirmed |

## Live resolver readiness evidence

`tenant_effective_capability_readiness_smoke` returned `pass` with:

- 8 expected schema objects present;
- 8 active semantic capabilities;
- 4 active provider bindings;
- 4 shadow bindings;
- 2 active endpoint aliases;
- 3 descriptor tools present;
- provider calls made: 0;
- mutations executed: false;
- secrets included: false.

This proves the semantic capability and alias resolver foundation is live and shadow-safe.

## Task loop classification

| Task | Classification | Evidence | Notes |
|---|---|---|---|
| T010 Implement canonical capability and alias resolution | complete | resolver reads `platform_semantic_capabilities`, `platform_capability_provider_bindings`, `platform_endpoint_aliases`, endpoint canonical identity, and exposes descriptor tools; live readiness smoke passed | no provider call and no secret return |
| T011 Implement typed subject-action-resource-context decision input | open | preview input remains capability/workspace/resource oriented | needs explicit typed decision contract and tests |
| T012 Implement relationship revision resolution | open | grants and memberships are read, but no complete revision vector is bound into the decision | needs revision source and stale-revision handling |
| T013 Implement grant and contextual policy composition | open | action grants and resource grants are composed, but full contextual policy and approval policy composition is not complete | needs execution policy integration |
| T014 Implement obligation and mismatch taxonomy | open | resolver status taxonomy and `difference_class` exist, but complete obligation model is not implemented | needs obligation output and mismatch catalog |
| T015 Persist bounded shadow decisions and parity evidence | complete | `tenant_capability_shadow_compare` writes `tenant_capability_shadow_decisions` with legacy/effective decision, difference class, decision JSON, manifest hash and no-secret marker | live smoke remains read-only; persistence implementation is code-and-test evidenced |
| T020 Shared enforcement kernel | open | no enforcement cutover evidence | must remain gated |
| T021 Revision-bound envelopes | open | envelope ledger exists but feature-specific revision binding is not complete | future additive work |
| T022 Scoped approvals and append-only decisions | open | `approval_holds` and evidence ledgers exist, but feature-specific scoped approval flow remains incomplete | future work |
| T023 Stale-envelope invalidation and concurrency | open | no complete implementation evidence | future work |
| T030 Adapter bindings, certification and drift reconcilers | open | provider bindings and certification registries exist, but full adapter/readback/reconciliation contract is incomplete | future work |
| T040-T043 Pilots and migration | open | shadow-safe resolver exists; no full three-pilot parity run or migration execution | future work |
| T050-T053 Verification and rollout | open | unit/static tests and smoke exist for resolver; closeout verification remains incomplete | future work |
| T061-T062 Closeout | open | closeout cannot run while implementation tasks remain open | future work |

## Immediate next loop order

1. T011 — introduce typed subject-action-resource-context input while preserving tenant identity from authenticated authority.
2. T012 — bind relationship, grant, capability, endpoint, policy and certification revisions into the decision manifest.
3. T013 — compose grant and contextual policy with explicit approval requirements.
4. T014 — add obligations and mismatch taxonomy to the decision output.
5. Re-run resolver tests and live readiness smoke after each task.
6. Only then proceed to T020 enforcement kernel design.

## Safety boundaries for the next loop

- No provider mutation.
- No enforcement cutover.
- No migration execution without a separate checksum-bound migration PR.
- No new authority table unless the SQL authority map requires it and review approves it.
- No alias may grant authority.
- Ambiguity must continue to fail closed.
- Tenant and user identity must continue to come from authenticated authority for tenant principals.
- Secrets must never be returned or selected by the resolver.

## Loop result

The remaining-task loop is active. T010 and T015 are closed with evidence. T011, T012, T013 and T014 are the next decision-plane blockers. All enforcement, adapter, pilot, migration, verification and rollout tasks remain open.
