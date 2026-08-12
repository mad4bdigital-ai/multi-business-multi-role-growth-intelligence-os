# Spec 015 Deep Gap Matrix — 2026-08-12

## Purpose

This document separates **existing adjacent platform primitives** from **canonical Spec 015 runtime implementation**. Existing files and passing tests are not treated as completion unless they satisfy the exact package, component, installation, lifecycle, tenant-boundary, and readback contracts declared by Spec 015.

> A green regression test for an existing platform primitive is evidence of reuse readiness; it is not evidence that the corresponding Spec 015 task is implemented.

## Phase 0 — Convergence and classification

| Task | Current evidence | Assessment | Closure evidence still required |
|---|---|---|---|
| T002 | `safe-execution-baseline-20260812.md`, authority/resource/plugin inventories, current-main implementation files | Partially satisfied as inventory work | A generated current-main inventory with exact source paths, ownership, runtime surface, and freshness SHA |
| T003 | Baseline reuse notes and existing authority/resource/plugin contracts | Partially satisfied; no complete field-level matrix | A canonical matrix covering package, component, installation, tool, and external-surface fields with source-of-truth, owner, lifecycle, and migration behavior |
| T006 | Duplicate Spec/feature clusters are documented in convergence materials | Not resolved | An approved canonical identity map and exact target paths; this remains a decision gate |
| T008 | Security and authority primitives exist, but product/ownership/portability decisions are not encoded as a single approval artifact | Not resolved | Decision register with explicit approvals and rejected alternatives |

## Phase 1 — Package/component foundation

| Task | Reusable substrate found | Gap | Safe next implementation |
|---|---|---|---|
| T010 | `platformPluginCatalog.js`, `platformPluginPolicy.js`, `resourceRecipeCapability.js` | No canonical Spec 015 package/component resource types and capability vocabulary | Define schemas and validators only; do not bind them to existing plugin identities until T006/T008 are approved |
| T011 | Resource authority, plugin catalog, brand-skill bindings | Asset authorities are distributed and have different ownership semantics | Produce a read-only mapping contract that references existing authority IDs without copying or creating identities |
| T012 | Plugin promotion/policy and activation lifecycle | No package publication states (`private`, `tenant`, `shared`, `curated`) | Add a pure policy evaluator and contract tests before persistence |
| T013 | Platform plugin catalog/install and resource registries | No package component version registry with immutable revision semantics | Add schema-level version/revision validator and deterministic identity tests |
| T014 | Dynamic container authority and resource bindings | No package-component dependency graph with cycle and compatibility checks | Add a pure graph validator and fixtures for cycle, missing dependency, and incompatible version |
| T015 | Many existing no-secret/provenance/authority validators | No unified Spec 015 validator pipeline | Compose existing validators through a new read-only validation facade; no mutation |
| T016-T018 | Admin/Tenant resource and plugin read surfaces plus extensive tests | No package/component catalog API under the Spec 015 contract | Add route/schema contract tests first; implementation requires canonical resource names from T010/T013 |

## Phase 2 — Installation compiler

| Task | Existing adjacent substrate | Gap | Closure condition |
|---|---|---|---|
| T020 | Activation lifecycle and tenant identity normalization | No Spec 015 installation identity and exact target-scope contract | Immutable installation ID, tenant/brand scope, owner, target revision, and scope hash |
| T021-T022 | Dynamic container overrides, delegation grants, resource authority | No sparse override and credential-free requirement binding model | Schema and fail-closed validator rejecting credentials and cross-tenant references |
| T023 | No canonical package compiler found | Major implementation gap | Deterministic compiler output with stable ordering and hash |
| T024 | Business/brand/activity binding primitives exist | No compiler integration contract | Applicability projection test bound to exact package revision |
| T025 | Lifecycle and snapshot services exist | No immutable installation revision lineage and context hash for Spec 015 | Revision persistence/readback and stale-write rejection |
| T026-T027 | Readiness and gap collectors exist in adjacent domains | No installation impact preview contract | Preview must be non-mutating and expose stale, ambiguity, wrong-scope, conflict, and hash evidence |

## Phase 3 — Entities, relationships, and lifecycles

The repository contains relationship-integrity, lifecycle, and authority primitives, but no verified canonical Spec 015 custom-entity model. T030 remains a decision gate because the persistence strategy is explicitly unselected. T031-T036 should not be marked complete based on `dynamicContainer*`, `databaseTableLifecycle`, or support-ticket lifecycle code; those are different domains and cannot be copied as entity semantics.

## Phase 4 — Forms, surveys, files, and client links

No complete Spec 015 form-definition, branching, idempotent submission, client-link, or package file-policy contract was found. Existing Hostinger storage and file authority surfaces are reusable boundaries, not a replacement for T040-T045. The safe implementation order is schema/readback contracts first, followed by isolation and replay tests, then provider integrations.

## Phase 5 — AI, UI, reports, and external projections

Agent surface, frontend dispatch, report, and capability projection files provide reusable infrastructure. They do not prove T050-T056. The missing canonical layer is a draft-only package authoring model with structured output, semantic validation, sensitivity, budget, safety, fallback, audience allowlists, redaction, and external-surface authorization. Any implementation must remain advisory and non-mutating until the authority decision register is closed.

## Phase 6 — Publication and installation lifecycle

`activationLifecycleStateMachine.js` and related operation services are reusable lifecycle primitives. The Spec 015 lifecycle is broader: publication state, installing/configuration/validation/ready/active state, immutable revisions, three-way upgrade planning, rollback, suspend, archive, uninstall request, deprecation, retirement, and continuity evidence. No evidence currently proves the full combined contract.

## Phase 7 — Agency/client operating models

Delegation grant, revocation, ownership, and tenant-boundary services provide reusable authority primitives. T070-T076 remain open because the client-as-Brand installation journey, client-owned Tenant handover, portfolio-safe projections, export manifests, and post-handover continuity are not represented as one canonical flow with end-to-end evidence.

## Phase 8 — Candidate PR convergence

Existing PR-related contracts and readiness tests prove repository governance, not successful reconstruction of the four Spec 015 package/service targets. T080-T085 require exact-head source comparison, duplicate-identity detection, stale-artifact detection, Operation Fabric integration, Tool Catalog projection, Spec 016 exposure verification, and canonical path validation.

## Cross-artifact consistency findings

| Finding | Evidence | Impact | Safe disposition |
|---|---|---|---|
| Required-check count mismatch | `.changes/e2e/github-repository-policy-controller.json` describes six canonical checks, while `http-generic-api/githubRepositoryPolicyController.js` currently defines seven, including `Single Owner Review Gate` | A live Ruleset fingerprint can be internally consistent but still disagree with the portfolio contract and Issue acceptance wording | Keep the controller fail-closed and record the mismatch; reconcile the canonical count before live policy apply |
| Live apply contract versus runtime authority | Migration 1051 registers external-write capability metadata but explicitly does not execute GitHub mutation | A green migration/readiness test cannot be treated as live policy completion | Preserve the distinction and require a separate runtime readback/apply evidence artifact |
| Adjacent primitives versus Spec 015 identity | Many `platformPlugin*`, `resource*`, and `activation*` modules exist, but no canonical Spec 015 package/component/install identity is established | Copying existing IDs would create duplicate or ambiguous authorities | Reuse only through explicit mapping; do not mark T010-T027 complete from adjacent tests |

## Deep implementation recommendation

The highest-value local work that does not require a new product or persistence decision is:

1. Build a **pure Spec 015 contract validator layer** for package/component identities, dependency graphs, credential-free bindings, publication policy, and deterministic hashes.
2. Build **read-only evidence generators** for T002/T003/T011/T015/T026/T085 using current-main SHA and exact source paths.
3. Add negative tests for duplicate identities, stale copied artifacts, cross-tenant references, credentials in package manifests, graph cycles, unstable ordering, and mismatched revision hashes.
4. Keep T006, T008, T030, and all Production/provider apply tasks explicitly blocked until their decision or environment gates are supplied.

## Non-completion rule

No Spec 015 runtime task should be checked off solely because an adjacent file or passing test exists. A task becomes implemented only after exact contract, code path, focused test, and—where declared—migration, deployment, runtime, external integration, and readback evidence are all present.
