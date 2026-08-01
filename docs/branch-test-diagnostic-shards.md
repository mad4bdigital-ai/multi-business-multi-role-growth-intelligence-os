# Branch Test Diagnostic Shards

`Branch Test Diagnostic Shards` is a branch-agnostic diagnostic workflow for isolating failures in the same command catalog used by `http-generic-api/scripts/run-test-manifest.mjs`.

## Diagnostic model

The workflow uses a three-level hierarchy:

1. **Family** — derived automatically from the test filename, such as `growth-control`, `context-kernel`, `frontend-surface`, or a deterministic generic fallback.
2. **Shard** — a bounded subdivision inside one family.
3. **Test command** — the exact command and stable catalog index reported on failure.

This keeps the workflow generic while making the failed subsystem visible directly in the GitHub Actions job name.

## Automatic execution

The workflow runs for pull requests targeting `main` when HTTP API, workflow, memory schema, or canonical bootstrap surfaces change. It checks out the tested PR merge ref, derives the current families from the branch test catalog, and builds a dynamic matrix with approximately eight tests per job.

Each family shard:

1. installs the locked HTTP API dependencies;
2. executes every command assigned to that family shard;
3. collects all failures unless fail-fast was explicitly requested;
4. uploads an immutable JSON report for 14 days.

After all jobs finish, a summary job downloads every report and publishes one GitHub Actions step summary containing:

- family and shard status;
- exact failed command and catalog index;
- test count and execution result;
- deterministic coordinates for subdividing the failed shard again.

The shard report contract is `mad4b.test-diagnostic-shard-report.v2`. The aggregate report contract is `mad4b.test-diagnostic-summary.v2`. Reports include repository/ref evidence, tested merge SHA, command-catalog SHA-256, family, partition coordinates, durations, exit codes, and bounded failure summaries. They never include credentials or secret values.

## Evidence routing authority

`Branch Test Diagnostic Evidence Router` runs after the diagnostic workflow completes. It downloads the summary artifact from the exact source run, validates its contract and PR identity, and publishes one updatable PR comment plus `diagnostic-evidence-routing.json` under contract `mad4b.github-actions-evidence-routing-report.v1`.

The router keeps three identities separate:

- **Head SHA** — the proposed branch commit.
- **Base SHA** — the target branch commit used by the pull request.
- **Tested merge SHA** — GitHub's synthetic `refs/pull/<number>/merge` commit actually executed by the diagnostic workflow.

Never substitute one of these SHAs for another.

Evidence precedence for Branch Test Diagnostic outcomes is:

1. `diagnostic-evidence-routing.json` for exact-run identity, authority, and next-action routing.
2. `diagnostic-summary.json` for test outcome, counts, first failure, and rerun coordinates.
3. `diagnostic-summary.md` as the human-readable projection of the same summary.
4. The exact GitHub workflow/check conclusion.
5. Job step summaries as supporting context.
6. A bounded Job log only for an exact failure already named by the summary, or when producing/validating the summary artifact itself failed.

A valid exact-run summary is authoritative for this workflow's test outcomes. Narrative text in a Job log cannot override it. Conversely, a passing Branch Test Diagnostic report proves only this test catalog; it does not override a different failed workflow. Inspect that workflow's own report or check contract.

When the Evidence Router reports `diagnostic_summary_unavailable` or `diagnostic_summary_invalid`, branch-test readiness is blocked. Job logs may then be read only to repair report production or identity validation; no test success or failure should be claimed until a valid summary exists.

## Manual execution for any branch

Open **Actions → Branch Test Diagnostic Shards → Run workflow**, select the branch or ref, and provide:

- `family`: optional exact family shown by a previous run, for example `growth-control`;
- `parent_index`: the previously failing shard index, normally `0` for a full run;
- `parent_count`: the previous shard count, normally `1` for a full run;
- `target_size`: approximate tests per new diagnostic job; use `1` for exact per-test isolation;
- `grep`: optional command-name substring filter;
- `fail_fast`: optionally stop each diagnostic job after its first failure.

The workflow is not tied to a branch prefix, Spec Kit, tenant, user, provider, or deployment environment.

## Subdividing a failing family shard

Suppose the summary reports:

- family: `growth-control`;
- shard: `3/5`.

Run the workflow manually on the same branch with:

- `family=growth-control`;
- `parent_index=2`;
- `parent_count=5`;
- `target_size=1`.

This selects only the commands that belonged to the failed shard and creates one diagnostic job per remaining test. The aggregate summary prints these exact values automatically for every failure.

## Local matrix inspection

From `http-generic-api`:

```bash
node scripts/run-test-diagnostic-shard.mjs \
  --emit-matrix \
  --parent-index 0 \
  --parent-count 1 \
  --target-size 8
```

To inspect one family shard without executing it:

```bash
node scripts/run-test-diagnostic-shard.mjs \
  --family growth-control \
  --parent-index 0 \
  --parent-count 1 \
  --shard-index 0 \
  --shard-count 4 \
  --list \
  --report-file diagnostic-reports/growth-control-0.json
```

Use `--grep <substring>` to filter commands and `--fail-fast` to stop at the first failure in that shard.

## Authority and drift prevention

The diagnostic runner imports `testCommands` directly from `run-test-manifest.mjs`. The sequential CI runner and the parallel diagnostic workflow therefore share one command catalog and one catalog hash. Adding a test to the branch runner automatically makes it eligible for family classification and diagnostic sharding without a separate Spec-specific manifest.

The Evidence Router checks out only trusted default-branch code when processing `workflow_run`. It does not execute code from an untrusted pull-request head, does not read credentials, and does not mutate provider or production state. Its PR comment is an evidence projection; the retained JSON artifacts remain the machine-readable authority.
