# Validator result log

## Purpose

`platform_engine_validator_result_log` records validator execution evidence for platform engine plans. It closes the gap between `validators_present` and `validators_executed_and_passed` without introducing an apply executor.

## Scope

This surface is evidence-only.

It does not:

- execute validators
- mutate repositories
- publish content
- perform external writes
- drop, truncate, delete, or archive database tables
- read or return secrets

## Table

`platform_engine_validator_result_log` stores:

- engine and task identity
- optional run linkage
- resource key/kind
- validator command/key
- status: `passed`, `failed`, `skipped`, or `blocked`
- bounded stdout/stderr excerpts
- sanitized evidence JSON
- artifact references
- trace, actor, and tenant metadata

## Views

### `v_platform_engine_validator_result_summary`

Summarizes validator result counts by engine, task, and status.

### `v_platform_engine_validator_latest_failures`

Lists latest failed/blocked validator evidence with bounded failure excerpts.

## Admin tools

### `platform_engine_validator_results`

Read-only listing of validator evidence.

### `platform_engine_validator_result_log`

Writes validator evidence only. The route does not execute validators and does not perform apply.

## Local runner

`http-generic-api/scripts/platform-engine-validator-runner.mjs` executes a single
allowlisted validator command without shell execution, builds bounded validator
evidence, and can optionally write that evidence to
`platform_engine_validator_result_log`.

Default behavior is evidence-only stdout:

```powershell
node scripts/platform-engine-validator-runner.mjs `
  --engine-key repo_conflict_resolution_engine `
  --task-class conflict_apply_readiness `
  --validator-key manifest_guard `
  --command "node test-test-manifest-runner.mjs"
```

Database writeback is opt-in with `--write-log`. `--dry-run` suppresses
writeback even when `--write-log` is present.

## Operating model

1. Engine produces a dry-run plan and validator list.
2. A separate runner executes validators outside the planning layer.
3. Runner posts bounded results to `platform_engine_validator_result_log`.
4. Apply-readiness can later require `passed` validator result refs, not just `validators_present`.

## Safety rules

- Never store full secrets in output excerpts or evidence JSON.
- Keep output excerpts bounded.
- Treat failed or missing validator evidence as apply-blocking.
- Do not use this log as approval by itself.
- Approval, scope guard, resource authority, readback, and audit evidence remain separate controls.
