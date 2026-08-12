# Tasks: Governed PR Delivery Orchestration

## Spec and governance

- [x] Create governed Spec Kit directory.
- [x] Define root causes and long-term design constraints.
- [x] Mark delivery mode as `multi_pr` because post-merge audit and production verification are in scope.
- [ ] Add final implementation PR references after each delivery PR lands.
- [ ] Close completion checklist in a final closeout PR.

## Data model

- [ ] Add `pr_delivery_ledger` table.
- [ ] Add `mutation_receipt_ledger` table.
- [ ] Add indexes for `pull_number`, `operation_key`, `idempotency_key`, and `status`.
- [ ] Add retention policy and no-secret audit fields.

## Planner

- [ ] Implement `governed_pr_delivery_plan` read-only tool.
- [ ] Classify PR state: open, closed, merged, draft, mergeable, unknown.
- [ ] Classify branch drift: up-to-date, behind-only, diverged-no-overlap, diverged-same-files, already-merged.
- [ ] Detect migration, production verification, docs-agent, and Spec Kit obligations.
- [ ] Return compact summary and evidence refs.

## Mutation receipt and retry wrapper

- [ ] Implement deterministic operation keys.
- [ ] Store request hash and expected post-state before mutation.
- [ ] Add readback-first handling for 502/503/504/client payload errors.
- [ ] Bound retry count and classify ambiguous states.
- [ ] Add tests for succeeded-after-transport-error.

## JIT envelopes

- [ ] Create envelope only after final preconditions are current.
- [ ] Renew expired envelope once without restarting the whole delivery.
- [ ] Store envelope IDs in delivery ledger.
- [ ] Fail closed on stale or mismatched envelope scope.

## Sync and CI

- [ ] Integrate update-branch for safe no-overlap drift.
- [ ] Dispatch configured workflow when checks are missing.
- [ ] Poll required checks by name and head SHA.
- [ ] Treat green-but-stale checks as `sync_required`, not merge-ready.

## Candidate resolution

- [ ] Create candidate branch from latest base.
- [ ] Apply resolved files to candidate with path/blob readback.
- [ ] Accept `already_present_in_base` as resolved when branch blob equals base blob.
- [ ] Produce reviewable same-file conflict plans.

## Merge finalize

- [ ] Verify PR is still open before merge.
- [ ] Validate expected head/base immediately before merge.
- [ ] Use `github_pr_finalize` or equivalent governed finalizer.
- [ ] Record merge commit and ancestry readback.
- [ ] Stop safely when PR is already merged.

## Post-merge closeout

- [ ] Detect merged migration files.
- [ ] Run governed migration authorization/dry-run/apply if required.
- [ ] Run release readiness.
- [ ] Record production parity and monitoring results.
- [ ] Record remaining warnings as backlog or complete.

## Observability

- [ ] Add metrics for tool-call count per delivery.
- [ ] Add metrics for stale-base loops.
- [ ] Add metrics for avoided blind retries.
- [ ] Add stuck-delivery hygiene report.
