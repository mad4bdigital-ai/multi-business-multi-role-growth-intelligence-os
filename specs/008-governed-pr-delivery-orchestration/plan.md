# Plan: Governed PR Delivery Orchestration

## Phase 0: Contract and evidence foundation

Deliver a read-only plan/status surface and a mutation receipt table.

Scope:

- Add delivery ledger schema.
- Add mutation receipt schema.
- Add `governed_pr_delivery_plan` read-only tool.
- Add `governed_pr_delivery_status` read-only tool.
- Add response chunk collector utility.

Exit criteria:

- Planner can classify open, closed, merged, up-to-date, behind-only, no-overlap, and same-file drift.
- Planner returns a compact summary plus evidence references.
- No mutation path is enabled.

## Phase 1: Sync and CI orchestration

Deliver drift-aware sync and CI dispatch without PR merge.

Scope:

- Add `governed_pr_delivery_apply` for sync-only and CI-only stages.
- Support update-branch for behind/no-overlap drift.
- Support workflow dispatch when checks are missing.
- Track check runs against the current candidate/head.

Exit criteria:

- Missing checks become pending/running without manual workflow lookup.
- Base movement returns `sync_required` with a new plan.
- No merge operation is executed.

## Phase 2: Candidate resolution and merge readiness

Deliver candidate merge creation and conflict-resolution planning.

Scope:

- Build candidate branch from latest base.
- Reuse existing blob SHAs for resolved files when safe.
- Support write_file/delete_file/apply_unified_diff for explicit resolutions.
- Fix validation semantics for `already_present_in_base`.

Exit criteria:

- Same-file drift produces a reviewable resolution plan.
- Files already present in base are not reported as missing.
- Candidate readback verifies tree and changed paths.

## Phase 3: PR finalize

Enable merge only after fresh CI, expected refs, and typed confirmation.

Scope:

- Integrate `github_pr_finalize` or equivalent finalizer.
- Validate expected head and base immediately before merge.
- Record merge commit, ancestry, and PR closed/merged state.

Exit criteria:

- Green but stale CI never merges.
- Already merged PR stops with success classification.
- No force update is used.

## Phase 4: Migration and closeout orchestration

Attach post-merge obligations to the same delivery ledger.

Scope:

- Detect migrations from changed files and Spec Kit completion metadata.
- Run governed migration authorization/dry-run/apply as separate JIT stages.
- Run release readiness and production parity.
- Record cleanup and remaining warnings.

Exit criteria:

- Migration PRs cannot be marked operationally complete without ledger evidence or backlog reference.
- Release readiness summary is stored in the closeout record.

## Phase 5: Scheduled hygiene and observability

Add recurring scans for stuck deliveries, ambiguous receipts, and stale branches.

Scope:

- Scheduled read-only hygiene report.
- Alert on deliveries stuck in `ci_running`, `sync_required`, `post_merge_required`, or `blocked_transport_ambiguous`.
- Report manual interventions avoided.

Exit criteria:

- No hidden stuck state remains after a run.
- Operators see one compact queue with next required actions.

## Rollout strategy

1. Spec-only Draft PR.
2. Read-only planner PR.
3. Receipt ledger and chunk collector PR.
4. Sync/CI apply PR.
5. Candidate/merge PR.
6. Closeout PR.
7. Final Spec Kit completion PR.

## Compatibility

Existing tools remain authoritative. The orchestrator calls them; it does not bypass them.

## Migration expectations

This feature likely requires additive tables for delivery and receipt ledgers. Destructive SQL is out of scope.
