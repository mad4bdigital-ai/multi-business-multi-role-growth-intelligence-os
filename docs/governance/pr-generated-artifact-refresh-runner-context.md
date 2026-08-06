# PR Generated Artifact Refresh — Runner Context Registration

## Purpose

The PR Generated Artifact Refresh workflow is a read-only exact-head validator. It must register successfully before a GitHub-hosted runner is allocated and must not evaluate runner-only contexts at the job environment level.

## Registration contract

The workflow does not use `${{ runner.temp }}` in `jobs.<job>.env`. Its first runner-backed step creates a bounded directory under `${RUNNER_TEMP}` and publishes the JSON and Markdown report paths through `${GITHUB_ENV}`.

This preserves the following properties:

- exact candidate checkout and remote branch-head readback;
- `contents: read` only;
- checkout credentials disabled;
- no `git push` or repository mutation;
- no Actions, Issues, or pull-request write authority;
- no embedded Work Map recovery activation or dispatch;
- canonical secret-free evidence uploaded from the bounded runner-temporary directory.

## Failure behavior

Executable regression coverage fails closed if pre-allocation runner context returns, if write authority is introduced, if a recovery mutation path is embedded, or if bounded report-path initialization is removed.

## Operational boundary

This registration repair does not authorize or perform Production mutation, deployment, restart, Hostinger or provider actions, credential access, SQL execution, migration application, database mutation, protected-ref mutation, force push, or external business writes.
