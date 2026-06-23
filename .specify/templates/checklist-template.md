# [FEATURE NAME] Review Checklist

> Instantiate this template inside `specs/<feature>/checklists/`. The reusable template is never marked complete.
> Use `[x]` for verified completion. Use `[~]` only for explicit not-applicable items and include the rationale on the same line.

## Coverage

- [ ] Logical resource descriptor exists.
- [ ] Admin scope decision exists.
- [ ] Tenant scope decision exists.
- [ ] List and get are covered.
- [ ] Search and pagination are covered.
- [ ] Permissions are covered.
- [ ] Changes and revisions are covered or explicitly not applicable.
- [ ] Mutation readback is covered.

## Safety

- [ ] Tenant identity is resolved server-side.
- [ ] Fields are allowlisted.
- [ ] No raw SQL surface exists.
- [ ] Secret values cannot be returned.
- [ ] Archive/revoke semantics replace hard deletion.
- [ ] ETag/version behavior is defined for concurrent updates.
- [ ] Structured errors distinguish 400/401/403/404/409.

## Delivery

- [ ] OpenAPI 3.1 updated.
- [ ] Tool registries updated.
- [ ] Test manifest updated.
- [ ] Canonicals updated and generated.
- [ ] CI coverage gate passes.
- [ ] Release readiness passes.
- [ ] Governed merge evidence is recorded.
- [ ] Required migration is applied with ledger readback, or marked `[~]` with rationale.
- [ ] Production parity is verified, or marked `[~]` with rationale.
- [ ] Post-merge live audit is completed, or marked `[~]` with rationale.
- [ ] Any audit backlog has a tracked reference and owner.

## Completion policy

- [ ] `completion.json` exists and matches this checklist.
- [ ] `single_pr` is used only when no post-merge obligation exists.
- [ ] `multi_pr` records merged implementation PRs and the final closeout PR.
- [ ] No unresolved `[ ]` item remains when status is `complete`.
