# Requirements Checklist — Spec 014

## Specification quality

- [ ] Problem and verified baseline separate external product inputs from repository/runtime authority.
- [ ] Goals, included scope, exclusions, and non-goals are reviewed.
- [ ] FR-001 through FR-052 are testable and have acceptance/task/operation-path traceability.
- [ ] NFR-001 through NFR-020 are reflected in plan, concerns, tasks, and tests.
- [ ] AC-001 through AC-018 define authoritative evidence rather than narrative completion.
- [ ] OP-001 through OP-009 include denial, retry, readback, recovery, and rollback behavior.
- [ ] Error codes are stable, bounded, no-secret, and actionable.

## Automation contract

- [ ] `development-automation.json` validates against its JSON Schema.
- [ ] All requirement, acceptance, task, wave, operation-path, and decision references resolve.
- [ ] Every task includes owner class, dependencies, allowed paths, forbidden actions, tests, gates, evidence, rollback, and resume key.
- [ ] Dependency graph is acyclic.
- [ ] Ready tasks have no unresolved decisions or dependencies.
- [ ] Contract explicitly states it is not execution authority.
- [ ] Completion policy requires exact-head and authoritative post-merge evidence.

## Work Map and data coverage

- [ ] Work Map fingerprint and source hashes are current.
- [ ] Every current map has an explicit reviewed decision.
- [ ] Every current schema domain has an explicit reviewed decision.
- [ ] New persistent entities are classified into existing domains/maps before implementation.
- [ ] No accidental or permanent unclassified schema object exists.
- [ ] No new Work Map is proposed without exhausting reuse/extension/composition.

## Contracts

- [ ] Development automation schema is strict and versioned.
- [ ] Gemini proposed-result schema prevents authority claims.
- [ ] OpenAPI is 3.1, strict, bounded, and specification-only.
- [ ] Generated canonical OpenAPI is not edited directly.
- [ ] Compatibility and consumer impact are documented.

## Open decisions

- [ ] OD-001 Gateway runtime resolved.
- [ ] OD-002 Client Confidential provider policy resolved.
- [ ] OD-003 Retention policy resolved.
- [ ] OD-004 Budget policy resolved.
- [ ] OD-005 Model benchmark/pinning resolved.
- [ ] OD-006 Review interface resolved.
- [ ] OD-007 File upload policy resolved.
- [ ] OD-008 Embedding storage resolved.
- [ ] OD-009 Recording consent resolved.
- [ ] OD-010 Pilot cohort and thresholds resolved.

## Delivery boundary

- [ ] This PR contains specification artifacts only.
- [ ] No runtime, migration, credential, provider, Google Workspace, deployment, or production mutation occurred.
- [ ] Implementation remains blocked until Work Map readiness and blocking decisions are resolved.
