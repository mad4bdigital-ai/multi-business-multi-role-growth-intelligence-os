# Branch Test Diagnostic Shards

`Branch Test Diagnostic Shards` is a branch-agnostic diagnostic workflow for isolating failures in the same command catalog used by `http-generic-api/scripts/run-test-manifest.mjs`.

## Automatic execution

The workflow runs for pull requests targeting `main` when HTTP API, workflow, memory schema, or canonical bootstrap surfaces change. It checks out the tested PR merge ref and partitions the complete branch test catalog across 16 parallel shards.

Each shard:

1. installs the locked HTTP API dependencies;
2. executes every command assigned to that shard;
3. collects all failures unless fail-fast was explicitly requested;
4. uploads an immutable JSON report for 14 days.

The report contract is `mad4b.test-diagnostic-shard-report.v1`. It includes the repository, ref, head/base refs, tested commit SHA, command-catalog SHA-256, partition coordinates, command indexes, durations, exit codes, and bounded failure summaries. It never includes credentials or secret values.

## Manual execution for any branch

Open **Actions → Branch Test Diagnostic Shards → Run workflow**, select the branch or ref, and provide:

- `parent_index`: the previously failing parent partition, normally `0` for a full run;
- `parent_count`: the number of parent partitions, normally `1` for a full run;
- `shard_count`: `4`, `8`, `16`, or `32` parallel child shards;
- `grep`: optional command-name substring filter;
- `fail_fast`: optionally stop each child shard after its first failure.

The workflow is not tied to a branch prefix, Spec Kit, tenant, user, provider, or deployment environment.

## Subdividing a failing shard

For an automatic 16-shard run, suppose shard `9` fails:

1. run the workflow manually on the same branch;
2. set `parent_index=9`;
3. set `parent_count=16`;
4. choose a new `shard_count`, usually `16`;
5. leave `grep` empty unless a narrower command family is desired.

This deterministically subdivides only the failing parent shard. Repeat with the new failing child coordinates if additional isolation is needed.

## Local use

From `http-generic-api`:

```bash
node scripts/run-test-diagnostic-shard.mjs \
  --parent-index 0 \
  --parent-count 1 \
  --shard-index 0 \
  --shard-count 16 \
  --report-file diagnostic-reports/shard-0.json
```

Use `--list` to inspect a partition without executing it, `--grep <substring>` to filter commands, and `--fail-fast` to stop at the first failure in that shard.

## Authority and drift prevention

The diagnostic runner imports `testCommands` directly from `run-test-manifest.mjs`. The sequential CI runner and the parallel diagnostic workflow therefore share one command catalog and one catalog hash. Adding a test to the branch runner automatically makes it eligible for diagnostic sharding without a separate Spec-specific manifest.
