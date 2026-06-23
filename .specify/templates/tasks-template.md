# Tasks: [FEATURE NAME]

> Instantiate this template inside `specs/<feature>/tasks.md`. The template itself is not completion evidence.
> Every feature must also create `completion.json` and at least one checklist under `checklists/`.

## Specification

- [ ] T001 Define user scenarios and success criteria.
- [ ] T002 Complete the resource coverage matrix.
- [ ] T003 Identify Admin/Tenant scope and permission adapters.

## Implementation

- [ ] T010 Add additive schema and registry seeds.
- [ ] T011 Add resource descriptor and safe-field policy.
- [ ] T012 Add list/get/search routes.
- [ ] T013 Add permissions/changes/revisions/readback routes.
- [ ] T014 Add mutation lifecycle adapters where approved.
- [ ] T015 Register Admin and Tenant tool exports.
- [ ] T016 Update OpenAPI 3.1 contracts.

## Verification

- [ ] T020 Add tests to the explicit test manifest.
- [ ] T021 Run resource API coverage gate.
- [ ] T022 Run tenant isolation and secret-redaction tests.
- [ ] T023 Update canonicals and knowledge guide.
- [ ] T024 Run CI and release readiness.

## Completion governance

- [ ] T030 Choose `single_pr` or `multi_pr` in `completion.json`.
- [ ] T031 Resolve every task and checklist item as complete `[x]` or explicit not-applicable `[~]` with rationale.
- [ ] T032 Record implementation PR, CI, merge, migration, deployment, and audit evidence required by the feature.
- [ ] T033 Use `multi_pr` with a final closeout PR whenever migration, production verification, or post-merge audit is required.
- [ ] T034 Run `node http-generic-api/scripts/spec-kit-completion-gate.mjs --changed` before the final merge.
