# Push workflow runner-context registration

## Failure mode

GitHub Actions evaluates job-level workflow expressions before a runner is allocated. A job-level environment binding such as `${{ runner.temp }}` therefore prevents the workflow from registering and produces a completed failure with zero jobs and no runner logs.

## Repair contract

The affected push, reusable, and evidence workflows must not evaluate `runner.temp` in `jobs.<job>.env`.

Each bounded evidence path must instead be created by one of these governed patterns:

1. initialize the path from `$RUNNER_TEMP` inside a runner-backed step and publish it through `$GITHUB_ENV`; or
2. use a stable repository-relative `.artifacts/**` path and create its parent directory before writing.

The repair does not change triggers, immutable bindings, provider methods, authorization tokens, protected refs, write permissions, or external-action boundaries.

## Scope

The regression contract covers the ten workflows that produced push-triggered startup failures on `main@ba10f269e831efa2c210b2729d1b31723a171052`. The prior repair of `PR Generated Artifact Refresh` remains independent and read-only.

## Safety boundary

This registration repair performs no Production mutation, Hostinger/provider request, deployment, restart, credential read, SQL, Migration Apply, database mutation, protected-ref update, force push, issue-comment activation, or external business write. Runtime and provider-capable workflows remain inert unless their pre-existing exact authorization and trigger contracts are satisfied.
