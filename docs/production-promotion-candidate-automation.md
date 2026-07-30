# Governed Production Promotion Candidate Automation

## Purpose

`.github/workflows/production-promotion-candidate.yml` creates a reviewable, source-pinned Git candidate for synchronizing protected `Production` from an exact `main` snapshot. It prevents moving-base validation, stale or misattributed CI evidence, branch-history loss, and non-fast-forward repair loops.

`.github/workflows/production-promotion-exact-candidate-validation.yml` validates the candidate through a source-pinned PR base and dispatches the repository Full CI workflow on the candidate branch itself.

Neither workflow merges `Production`, deploys Hostinger, runs SQL, authorizes or applies migrations, calls providers, reads credential payloads, restarts services, or sends externally.

## Required inputs

The operator supplies:

- exact source `main` SHA;
- exact current `Production` SHA;
- a non-protected release branch name;
- a distinct non-protected candidate-validation branch name;
- a distinct validation-base branch using the `gpt/validate-production-base` prefix;
- whether review PRs should be created or updated.

Both SHAs must be lowercase, full 40-character Git object IDs. The builder fetches protected refs and rejects the run when either input differs from repository readback.

## Candidate construction

The candidate always uses the exact pinned-main tree. Its ancestry contains:

1. pinned source `main`;
2. pinned `Production`;
3. the previous release-candidate head when needed to preserve fast-forward-only branch updates.

When an existing candidate already contains both protected refs and its tree equals pinned `main`, the builder reuses it. Otherwise it creates a multi-parent commit with `git commit-tree` and a deterministic identity/date derived from pinned `main`.

Before any push, the builder proves:

- candidate tree equals pinned-main tree;
- pinned `main` is an ancestor;
- pinned `Production` is an ancestor;
- the previous release candidate remains an ancestor when present;
- protected refs have not changed during construction.

## Pinned validation base

The builder creates or fast-forwards the validation-base branch to the exact pinned-main SHA. It creates or updates the validation PR from the candidate-validation branch to this pinned base, not to moving `main`.

This matters because GitHub normally validates a pull request's synthetic merge tree. A PR based on moving `main` can silently include newer commits that are not present in the Production candidate. The pinned base prevents that contamination.

The builder re-reads the validation-base branch after push and fails on any mismatch.

## Exact-candidate Full CI

The exact-validation launcher runs only for PRs targeting the governed validation-base branch pattern. It:

1. reads the candidate and validation-base SHAs from the PR event;
2. proves both branch readbacks are unchanged;
3. proves candidate and pinned-base trees are identical;
4. dispatches `.github/workflows/ci.yml` through `workflow_dispatch` on the candidate branch itself;
5. waits for the dispatched run to complete successfully;
6. requires successful Syntax Check, Unit & Integration Tests, Execution Resolver Gate, and Architecture Drift Detection jobs;
7. re-reads candidate and base branches after CI;
8. uploads versioned non-secret exact-CI evidence.

A successful PR workflow that checked a different synthetic merge tree is historical only and cannot authorize candidate promotion.

## Branch mutation policy

Only the supplied release, validation candidate, and validation-base branches may be updated. Every existing branch update must be a fast-forward. The workflows contain no force push, protected-branch push, working-tree merge, pull-request merge, or merge API call.

## Pull-request surfaces

When enabled, the builder creates or updates:

- a release PR from the release branch to `Production`;
- a temporary validation PR from the candidate-validation branch to the pinned validation-base branch.

The validation PR is closed without merge after exact-candidate CI and evidence review. The release PR remains unmerged until explicit Production-promotion authorization is issued against the same candidate SHA.

## Evidence

Each successful builder run uploads versioned JSON containing pinned refs, candidate SHA/tree, all three branch names, candidate mode, exact-tree policy, pinned-base validation policy, and explicit false values for merge, deployment, migration, provider, credential, and secret activity.

The exact-validation launcher uploads its dispatched CI run metadata plus a versioned evidence document proving exact SHA, tree equality, required job success, and branch freshness. Missing evidence is a workflow failure.

## Snapshot validity and latest-main backlog

A source-pinned candidate is immutable. Later `main` movement does not rewrite the candidate or invalidate exact-SHA CI evidence. It creates a latest-main backlog that must be reported before merge authorization.

Before authorizing promotion, choose explicitly between:

1. promote the already validated pinned snapshot; or
2. refresh the candidate to include the newer `main` backlog and repeat exact-candidate validation.

Merge authorization is invalidated when:

- `Production` moves after candidate construction;
- the candidate or validation-base branch readback differs;
- the candidate SHA changes;
- exact-CI or governance evidence corresponds to another SHA or tree.

## Post-merge runtime proof

A successful GitHub merge proves branch state only. Hostinger deployment remains incomplete until same-cycle readback confirms:

- resulting protected `Production` SHA;
- Hostinger deployment manifest or `/version` reports the expected deployed commit;
- `/health` is healthy;
- no newer protected-branch movement invalidated the comparison.

Repository synchronization never authorizes a database migration. Any migration requires its own checksum-bound governed authorization, dry-run, apply, ledger entry, and same-cycle schema/runtime readback.
