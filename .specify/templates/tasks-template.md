# Tasks: [FEATURE NAME]

**Spec**: `specs/[NNN-feature]/spec.md`  
**Plan**: `specs/[NNN-feature]/plan.md`

## Rules

- Use stable IDs `T001`, `T002`, ...
- Add `[P]` only when tasks are safe to execute in parallel.
- Add requirement and operation-path references.
- A mutation task must name approval, authority, readback, and rollback requirements.
- Generated files must follow generator authority.
- Every integrated or extended Work Map decision must bind to requirements, tasks, acceptance tests, and evidence.
- No runtime implementation task may begin while `work-map-integration.json` is blocked or stale.
- Do not mark a task complete from narrative; cite commit, test, migration, or runtime evidence.

## Phase 0 — Clarification, baseline, and Work Map integration

- [ ] **T001** [requirement/path] Capture verified baseline and open questions.
- [ ] **T002** Generate `work-map-integration.json` from all current Work Maps and schema domains.
- [ ] **T003** Resolve every map, domain, cross-map dependency, taxonomy gap, and discovered dimension.
- [ ] **T004** Prove all schema objects are classified or intentionally excepted with owner, expiry, and review gate.
- [ ] **T005** Mark Work Map integration `ready_for_implementation` only after all delivery bindings exist.

## Phase 1 — Contracts and state

- [ ] **T010** [P] [requirement/path] Draft contract.
- [ ] **T011** [P] [requirement/path] Draft data/state model and bind schema entities to existing Work Maps.

## Phase 2 — Implementation

- [ ] **T020** [requirement/path] Implement bounded behavior after Work Map readiness passes.

## Phase 3 — Tests and fault injection

- [ ] **T030** [P] Add unit tests.
- [ ] **T031** [P] Add integration and contract tests.
- [ ] **T032** Add replay, timeout, unknown-outcome, and rollback tests.
- [ ] **T033** Run Work Map integration, classification, staleness, and intentional-exception regression tests.

## Phase 4 — Documentation and generated artifacts

- [ ] **T040** Update canonical sources and run generators.
- [ ] **T041** Update runbooks, examples, and compatibility notes.
- [ ] **T042** Regenerate Work Maps when source classifications or mapped platform surfaces change.

## Phase 5 — Governed delivery

- [ ] **T050** Open PR with risks, tests, API/database impact, rollout, rollback, and Work Map impact summary.
- [ ] **T051** Synchronize branch without force and pass required CI.
- [ ] **T052** Obtain fresh merge authority bound to head/base SHA.

## Phase 6 — Deployment and closeout

- [ ] **T060** Verify auto-deploy and production/main parity.
- [ ] **T061** Run health and user-path production smoke.
- [ ] **T062** Validate completion evidence and classify remaining gaps intentionally or resolve them.

## Dependency graph

```text
T001 → T002 → T003 → T004 → T005 → T010/T011 → T020 → T030/T031/T032/T033 → T040/T041/T042 → T050/T051/T052 → T060/T061/T062
```

Document additional blocking dependencies and safe parallel groups.

## Completion rule

All mandatory tasks, checklists, contracts, authoritative readbacks, Work Map decisions, and schema classifications must pass before `completion.json.status` may become `complete`.
