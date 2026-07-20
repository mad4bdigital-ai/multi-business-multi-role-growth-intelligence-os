# Governed GitHub Merge and Operational Alerts Runbook

## Purpose

This runbook captures the current production-safe operating path for repository merges, superseded branch cleanup, SQL-primary operational alerts, and notification triage.

## Current verified state

- `github_pr_finalize` was verified end-to-end through PR #2280.
- PR #2280 merged through the governed `github_pr_finalize` tool, not GitHub REST fallback.
- Merge SHA: `aa0837f8e992563ce32a8229394b0ccbc333c808`.
- Production parity verification run: `5863abc0-a7fa-4971-b7de-8ffa076aad95`.
- Production expected and deployed SHA both matched `aa0837f8e992563ce32a8229394b0ccbc333c808`.
- `capability_resolution_envelope_approve` successfully produced `ready_for_dispatch` envelopes after the prior missing-script gap.

## Required merge path

1. Reconcile the work branch against `main`.
2. If the branch is behind or diverged with no overlap, synchronize it without force-push.
3. Run required CI checks:
   - `Syntax Check`
   - `Execution Resolver Gate`
   - `Architecture Drift Detection`
   - `Unit & Integration Tests`
4. Create a `github_pr_merge` capability envelope for `github_pr_finalize`.
5. Approve the envelope using `capability_resolution_envelope_approve`.
6. Finalize with `github_pr_finalize` using exact expected head and base SHAs.
7. Require ancestry readback and branch cleanup readback.
8. Let Hostinger auto deploy; do not use SSH deploy unless separately approved as break-glass.
9. Run runtime verification with expected SHA set to the current deployed `main` commit.

## Superseded branch cleanup

Use `github_superseded_branch_cleanup` only after:

- The PR is closed or merged.
- The PR has label `superseded` when closed-PR lifecycle mode is required.
- The replacement commit is on `main`.
- Dry-run reports `ready=true`, `blockers=[]`, and `uncovered_files=[]`.
- Apply uses exact `expected_base_sha`, `expected_branch_sha`, and `expected_evidence_fingerprint` from the same-cycle dry-run.
- Apply has a ready capability envelope and typed confirmation.
- Missing-ref readback returns 404 for the deleted branch.

Verified cleanup evidence:

- PR #2256 was labeled `superseded` through `github_rest_endpoint_dispatch` using `github_add_issue_labels`.
- The cleanup dry-run reported no blockers and no uncovered files.
- The branch `gpt/operational-alerts-auto-resolution-events-20260706` was deleted.
- GitHub ref readback returned 404.

## Operational alerts model

Operational alerts are SQL-primary.

For `execution_log`, the source authority is:

- `sql_primary_execution_log_aggregate`
- aggregation: `operation_resource_failure_groups`

The collector must not reintroduce fixed raw row ceilings such as `EXECUTION_LOG_MAX_ROWS` for alert collection.

A healthy sync must show:

- `sync_status=completed`
- `degraded_source_count=0`
- `truncated=false` for SQL aggregate sources
- `secrets_included=0`

Auto-resolution is audited:

- stale alerts are resolved only after successful source collection;
- each auto-resolution writes a lifecycle event;
- actor type is `system_auto_resolution`;
- evidence includes `sync_run_id` and `auto_resolution_reason`.

Recent verified auto-resolution evidence:

- sync run `a693711f-9392-4697-b657-ad91a3c128d4`
- `resolved_count=50`
- matching lifecycle events with `actor_type=system_auto_resolution`: `50`

## Notification queue policy

Do not suppress pending notifications only because they are old.

As of the latest triage, pending operational alert notifications were limited to 10 in-app notifications tied to active `v_activation_pending_tasks` alerts:

- 4 critical `task_blocked`
- 6 high `high_priority_task`

These should remain pending until their underlying tasks are resolved, explicitly acknowledged, or converted into known issues with evidence.

## Known issue policy

Resolve only known issues with same-cycle evidence.

Resolved during this cycle:

- `known.github_rest_fallback_coverage_gap`: resolved after `github_add_issue_labels` worked through governed endpoint dispatch and enabled PR #2256 cleanup.
- `known.main_sha_pin_race`: resolved after PR #2280 verified `github_pr_finalize` with expected head/base SHA, CI gate, ancestry readback, cleanup, and production parity.

Still open or acknowledged by design:

- pending task blockers for Google Ads readiness, Hostinger SSH break-glass/probe surfaces, and OpenClaude bridge work;
- exact patch fragility where the dedicated patch tool still uses exact block replacement for some operations;
- transient structured error inconsistencies, which still require envelope normalization;
- capability lifecycle debt unrelated to the recovered approval path.

## Runtime dispatch certifications issued

The following 30-day certifications were issued after successful readback:

- `github_pr_finalize_smoke_verified_20260707`
- `github_superseded_branch_cleanup_verified_20260707`
- `github_branch_fast_forward_smoke_verified_20260707`

A certification attempt for `capability_resolution_envelope_approve_verified_20260707` exposed a separate SQL parse issue in the certification resolver for shell-alias tools. The approval tool itself remained verified by direct envelope readback.

## Smoke commands to rerun after platform changes

- `repository_close_superseded_positive_smoke`
- `github_branch_fast_forward_smoke`
- disposable PR smoke finalized through `github_pr_finalize`
- runtime verification against current `main`
- operational alerts sync and lifecycle event readback

## Safety boundaries

- Do not use native GitHub tools for platform mutations.
- Do not use SSH deploy while Hostinger auto deploy is active unless break-glass is explicitly approved.
- Do not update lifecycle or known issues by raw SQL when a lifecycle API exists.
- Do not suppress notifications for unresolved high/critical source tasks.
- Do not close known issues without same-cycle evidence.
