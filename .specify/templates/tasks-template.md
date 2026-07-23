# Tasks: [FEATURE NAME]

**Spec**: `specs/[NNN-feature]/spec.md`  
**Plan**: `specs/[NNN-feature]/plan.md`

## Rules

- Use stable IDs `T001`, `T002`, ...
- Add `[P]` only when tasks are safe to execute in parallel.
- Add requirement and operation-path references.
- A mutation task must name approval, authority, readback, and rollback requirements.
- Generated files must follow generator authority.
- Do not mark a task complete from narrative; cite commit, test, migration, or runtime evidence.

## Phase 0 — Clarification and baseline

- [ ] **T001** [requirement/path] Capture verified baseline and open questions.

## Phase 1 — Contracts and state

- [ ] **T010** [P] [requirement/path] Draft contract.
- [ ] **T011** [P] [requirement/path] Draft data/state model.

## Phase 2 — Implementation

- [ ] **T020** [requirement/path] Implement bounded behavior.

## Phase 3 — Tests and fault injection

- [ ] **T030** [P] Add unit tests.
- [ ] **T031** [P] Add integration and contract tests.
- [ ] **T032** Add replay, timeout, unknown-outcome, and rollback tests.

## Phase 4 — Documentation and generated artifacts

- [ ] **T040** Update canonical sources and run generators.
- [ ] **T041** Update runbooks, examples, and compatibility notes.

## Phase 5 — Governed delivery

- [ ] **T050** Open PR with risks, tests, API/database impact, rollout, and rollback.
- [ ] **T051** Synchronize branch without force and pass required CI.
- [ ] **T052** Obtain fresh merge authority bound to head/base SHA.

## Phase 6 — Deployment and closeout

- [ ] **T060** Verify auto-deploy and production/main parity.
- [ ] **T061** Run health and user-path production smoke.
- [ ] **T062** Validate completion evidence and classify remaining gaps.

## Dependency graph

Document blocking dependencies and safe parallel groups.

## Completion rule

All mandatory tasks, checklists, contracts, and authoritative readbacks must pass before `completion.json.status` may become `complete`.
