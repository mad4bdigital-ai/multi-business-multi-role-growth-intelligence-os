# Tasks: Repository-Driven Unified Platform Frontend

## Specification and authority

- [x] T001 Define users, scopes, security boundaries, requirements, and success criteria.
- [x] T002 Define repository authority precedence and conflict rules.
- [x] T003 Define source baseline, drift invalidation, dispatch states, blockers, waves, and completion equation.
- [x] T004 Define machine contracts for UI catalog and dispatch plan.
- [x] T005 Correct prior false implementation claims; no shell is marked complete before code and tests exist.

## F0 dynamic planning foundation

- [x] T010 Add mounted-route/OpenAPI/resource/policy/test discovery generator.
- [x] T011 Add deterministic SHA-pinned output and `--write`/`--check` modes.
- [x] T012 Add fail-closed surface policy with explicit owner/rationale rules.
- [x] T013 Add risk, dependency, wave, blocker, and verification packet generation.
- [x] T014 Add local fixture tests for discovery, Admin dependency, safety, determinism, and drift.
- [x] T015 Register generator scripts in `http-generic-api/package.json`.
- [x] T016 Register the test in `scripts/test-manifest.mjs`.
- [x] T017 Generate the first full-repository dispatch artifact on the synchronized branch.
- [ ] T018 Review unresolved classifications and commit explicit policy decisions.
  - [x] T018a Add per-operation runtime/OpenAPI authentication profiles and fail-closed parity states.
  - [x] T018b Replace family-wide mutation/readback inference with exact operation classification and control contracts.
  - [x] T018c Account for canonical OpenAPI documents and explicit exemptions, and generate a conservative auth-backed operation index.
  - [ ] T018d Resolve remaining auth aliases/handler-level tokens, canonical detail contracts, operation classifications, and rollback/compensation gaps.
    - [x] T018d.1 Resolve all runtime/canonical auth mismatches, missing comparisons, handler-level tokens, imported guards, and invalid/duplicate auth rules.
    - [x] T018d.2 Close operation-presence gaps with reviewed canonical public entrypoint contracts while keeping generated projections non-canonical.
    - [x] T018d.3 Classify thirteen proven non-mutating actions: nine capability-vault planning/resolution operations and four `router.all` root-discovery variants.
    - [ ] T018d.4 Replace 378 remaining operation-index-only entries with reviewed request/response detail contracts.
      - [x] T018d.4a Replace the first three entries with canonical adapter-contract, target-adapter, and apply-readiness read-model contracts.
      - [x] T018d.4b Replace three additional entries with canonical promotion-review, payload-preview-review, and capability-envelope-plan read-model contracts.
      - [x] T018d.4c Replace three capability-envelope lifecycle entries with canonical request-gate, dispatch-dry-run, and actual-request-preflight read-model contracts.
      - [x] T018d.4d Replace three capability-envelope request, approval, and dispatch-readback entries with canonical read-model contracts.
      - [x] T018d.4e Replace adapter-execution-gate and backlog-target-write entries with canonical read-model contracts, and align lifecycle status enums with all migration-permitted values.
      - [x] T018d.4f Replace the remaining-scope-completion entry with a canonical read-model contract and migration-aligned lifecycle enums.
      - [x] T018d.4g Add canonical signed-user contracts for the tenant Activation session list and bounded turn-batch archive write.
    - [ ] T018d.5 Classify 529 remaining non-GET candidates with exact evidence and controls where consequential.
      - [x] T018d.5a Classify the three SELECT-only session-insight adapter read models and register explicit test ownership.
      - [x] T018d.5b Classify the three SELECT-only promotion review and capability planning read models and register explicit test ownership.
      - [x] T018d.5c Classify the three SELECT-only capability-envelope lifecycle read models and register explicit test ownership.
      - [x] T018d.5d Classify the three SELECT-only capability-envelope request, approval, and dispatch-readback read models and register explicit test ownership.
      - [x] T018d.5e Classify the SELECT-only adapter-execution-gate, backlog-target-write, and target-write-readback list operations and register explicit test ownership.
      - [x] T018d.5f Classify the SELECT-only remaining-scope list and three Platform Plugin smoke-certification status/policy read actions with explicit test ownership.
      - [x] T018d.5g Govern the raw and tenant Activation turn-batch archive mutations with capability-family authorization, same-cycle readback, and immutable-audit compensation rationale.
      - [x] T018d.5h Classify seventeen source-proven read actions across manifest resolution, readiness/readback, health planning, governance proposals, smoke-certification policy history/preview/queue, runtime catalog, private contribution resolution, agent intelligence, and repository automation, with explicit test ownership.
      - [x] T018d.5i Govern the signed-user `POST /connect/bootstrap` state change with exact Managed-mode preflight and same-cycle readback while retaining its partial-success compensation gap as an explicit blocker.
    - [ ] T018d.6 Add rollback/post-commit compensation for the four classified resource mutations and the tenant bootstrap partial-success path.
- [x] T019 Add generated-plan schema contract and changed-scope CI drift gate.

## F1 tenant shell

- [x] T100 Add browser-safe surface catalog and `/platform` shell.
- [x] T101 Add MAD4B tokens, light/dark/system themes, responsive navigation, and accessibility states.
- [ ] T102 Add tenant login/session restore, workspace context, and sign-out.
- [ ] T103 Implement overview/growth and logical resources.
- [ ] T104 Implement connections/devices, agents/sessions, support, and settings.
- [ ] T105 Add tenant route, security, accessibility, and regression tests.

## F2 Admin BFF

- [ ] T120 Approve threat model and additive session/audit persistence.
- [ ] T121 Implement short-lived HttpOnly session exchange, CSRF, origin binding, expiry, and revoke.
- [ ] T122 Add explicit read/action adapters; prohibit generic privileged proxying.
- [ ] T123 Add audit, denial, rotation, expiry, and readback tests.

## F3 admin workspaces

- [ ] T140 Implement operations, activation, tenants, resources, and authority.
- [ ] T141 Implement agents, plugins, connected execution, and infrastructure.
- [ ] T142 Implement verification, support, governance, release, and audit evidence.

## F4/F5/F6

- [ ] T160 Consolidate Local Manager while preserving verified compatibility.
- [ ] T161 Implement device trust, local consent, repair, capability, route, and backup UX.
- [ ] T180 Implement jobs, workflows, sessions, API, graph, changes, revisions, and evidence.
- [ ] T200 Complete deep-link cutover, telemetry, WCAG, performance, staging, and production parity.

## Completion governance

- [x] T220 Use `multi_pr` because migrations, production verification, and post-merge audit are required.
- [ ] T221 Record all implementation PRs and merge SHAs.
- [ ] T222 Record migration ledger evidence for Admin session persistence.
- [ ] T223 Record CI and staging/production parity evidence.
- [ ] T224 Complete post-merge audit and closeout PR.
