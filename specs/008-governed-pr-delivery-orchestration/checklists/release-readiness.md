# Release Readiness Checklist

## Before enabling apply paths

- [ ] Read-only planner is deployed and passes smoke tests.
- [ ] Receipt ledger exists and write/readback is verified.
- [ ] Chunk collector returns compact summaries and complete references.
- [ ] CI workflow mapping is configured.
- [ ] Required checks list is configurable per repository.

## Before merge finalization path

- [ ] Candidate merge behavior has positive and negative tests.
- [ ] Stale-base tests prove green-but-stale checks are blocked.
- [ ] Already-merged PR handling is tested.
- [ ] Same-file conflict resolution plan is human-readable.
- [ ] `already_present_in_base` is accepted only with blob equality evidence.

## Before migration closeout path

- [ ] Migration detection from changed files is tested.
- [ ] Governed migration authorization/dry-run/apply integration is tested.
- [ ] Release readiness run is recorded in the delivery ledger.
- [ ] Remaining warnings require backlog references.

## Completion

- [ ] All implementation PRs are linked in `completion.json`.
- [ ] Final closeout PR is linked.
- [ ] Release readiness is pass.
- [ ] Production parity is verified or explicitly not applicable with rationale.
- [ ] No unresolved checklist item remains while status is `complete`.
