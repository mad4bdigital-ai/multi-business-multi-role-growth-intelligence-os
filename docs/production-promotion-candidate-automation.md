# Governed Production Promotion Candidate Automation

## Purpose

`.github/workflows/production-promotion-candidate.yml` creates a reviewable, source-pinned Git candidate for synchronizing protected `Production` from an exact `main` snapshot. It exists to prevent moving-head release PRs, stale CI evidence, branch-history loss, and non-fast-forward repair loops.

The workflow does **not** merge `Production`, deploy Hostinger, run SQL, authorize or apply migrations, call providers, read credential payloads, restart services, or send externally.

## Required inputs

The operator supplies:

- exact current `main` SHA;
- exact current `Production` SHA;
- a non-protected release branch name;
- a distinct non-protected validation branch name;
- whether review PRs should be created or updated.

Both SHAs must be lowercase, full 40-character Git object IDs. The workflow fetches protected refs and rejects the run when either input differs from the repository readback.

## Candidate construction

The candidate always uses the exact pinned-main tree. Its ancestry contains:

1. pinned `main`;
2. pinned `Production`;
3. the previous release-candidate head when needed to preserve fast-forward-only branch updates.

When an existing candidate already contains both protected refs and its tree equals pinned `main`, the workflow reuses it. Otherwise it creates a multi-parent commit with `git commit-tree` and a deterministic identity/date derived from pinned `main`.

Before any push, the workflow proves:

- candidate tree equals pinned-main tree;
- pinned `main` is an ancestor;
- pinned `Production` is an ancestor;
- the previous release candidate remains an ancestor when present;
- protected refs have not changed during construction.

## Branch mutation policy

Only the supplied release and validation branches may be updated. Every existing branch update must be a fast-forward. The workflow contains no force push, protected-branch push, working-tree merge, pull-request merge, or merge API call.

The workflow re-reads both candidate branches after push and fails on any mismatch.

## Pull-request surfaces

When enabled, the workflow creates or updates:

- a release PR from the release branch to `Production`;
- a temporary validation PR from the validation branch to `main`.

The validation PR is closed without merge after exact-candidate CI and evidence review. The release PR remains unmerged until explicit Production-promotion authorization is issued against the same candidate SHA.

## Evidence

Each successful run uploads versioned JSON containing pinned refs, candidate SHA/tree, branch names, candidate mode, exact-tree policy, and explicit false values for merge, deployment, migration, provider, credential, and secret activity.

Missing evidence is a workflow failure.

## Freshness and merge gate

A candidate is stale when:

- `main` changes after construction;
- `Production` changes after construction;
- candidate branch readback differs;
- required checks or evidence do not correspond to the exact candidate.

Run the workflow again with fresh expected SHAs immediately before requesting merge authorization. Do not merge based on historical candidate evidence.

## Post-merge runtime proof

A successful GitHub merge proves branch state only. Hostinger deployment remains incomplete until same-cycle readback confirms:

- resulting protected `Production` SHA;
- Hostinger deployment manifest or `/version` reports the expected deployed commit;
- `/health` is healthy;
- no newer protected-branch movement invalidated the comparison.

Repository synchronization never authorizes a database migration. Any migration requires its own checksum-bound governed authorization, dry-run, apply, ledger entry, and same-cycle schema/runtime readback.
