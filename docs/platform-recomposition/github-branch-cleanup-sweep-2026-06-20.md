# Governed GitHub Branch Cleanup Sweep — 2026-06-20

## Purpose

Replace repeated manual branch-by-branch cleanup with one bounded, governed repository sweep while preserving the existing single-branch deletion safety contract.

The virtual admin tool is `github_branch_cleanup_sweep`.

## Dry-run contract

Dry-run is the default and performs no ref mutation. It:

- resolves the actual GitHub default branch and current base SHA;
- reads all open pull-request heads before evaluating candidates;
- scans one to three GitHub branch pages with a hard maximum of 300 branches per invocation;
- accepts only a subset of the platform disposable-branch prefixes;
- blocks protected/default branches, open-PR branches, branches with unique commits, invalid metadata, comparison failures, and branches younger than `min_age_days`;
- sorts eligible branches by commit timestamp, oldest first;
- limits the deletion plan to `max_deletes`, capped at 25;
- returns a SHA-256 evidence fingerprint and a typed confirmation bound to the base SHA and candidate set;
- returns `secrets_included: false`.

## Apply contract

Apply requires:

- `mode=apply`;
- `expected_base_sha` from the reviewed dry-run;
- `expected_evidence_fingerprint` from the reviewed dry-run;
- the exact typed confirmation returned by dry-run;
- a ready GitHub capability envelope for repository cleanup.

Before deleting anything, apply reruns the complete plan and rejects stale base or candidate evidence. Each candidate is then passed through the existing `deleteGithubBranchRef` contract, which independently rechecks:

- actual default-branch protection;
- allowlisted branch prefix;
- expected branch-head SHA;
- absence of an open pull request;
- zero unique commits relative to the current default branch;
- pre-delete branch-head readback;
- same-cycle missing-ref readback after deletion.

The sweep stops on the first branch-level failure and returns partial-success evidence. It never force-deletes and never retries an unknown provider outcome automatically.

## Pagination and operation

A run scans a bounded branch window. Repeated runs may start from page 1 after successful deletions, allowing older eligible branches to move into the scanned window without relying on an unstable cursor. Larger repositories may use `page` and `max_pages` explicitly.

Recommended operating posture:

1. Run dry-run with the intended page, limits, prefixes, and age threshold.
2. Review exclusions and the deletion plan.
3. Approve one capability envelope for the exact sweep.
4. Apply with the returned base SHA, fingerprint, and confirmation.
5. Record the result and repeat only after a fresh dry-run.

## Registry and certification

Migration `1019_sprint69_github_branch_cleanup_sweep.sql` registers:

- the repository mutation policy;
- endpoint exports for branch listing, PR listing, commit comparison, ref readback, and ref deletion;
- five platform tool dispatch bindings;
- a runtime dispatch certification requiring dry-run, audit evidence, and readback.

The migration performs no provider call or external write.

## Validation

Required coverage:

- `test-github-branch-cleanup-sweep.mjs`;
- `test-github-repository-lifecycle.mjs`;
- `test-safe-branch-cleanup-support.mjs`;
- syntax validation;
- architecture validation;
- full test manifest;
- `git diff --check`.

## Rollback

Revert the PR to remove the virtual tool. Registry rows may be disabled through a separately governed migration if rollback is required after migration 1019 has been applied. Existing branches are not recreated automatically; every deletion retains GitHub and platform audit evidence.
