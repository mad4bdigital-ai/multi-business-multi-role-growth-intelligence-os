# Supervisor Runtime Assurance Runbook

## Purpose

This runbook covers supervisor runtime readiness, behavioral certification, post-closure monitoring, automated repository alerts, and Docs Agent controls.

## Safety contract

- Scheduled GitHub assurance is static and dry-run only.
- Scheduled assurance never uses `--live` or `--apply`.
- Provider calls, credential payload reads, deploys, publishes, spend, and external runtime writes are forbidden.
- Live readiness and rollback certification run only through governed Admin tools.
- A resolved operational alert may be reopened only with fresh evidence.

## Automated assurance

`.github/workflows/supervisor-runtime-assurance.yml` runs every day at 04:23 UTC and on relevant pull requests or pushes.

It runs:

1. `supervisor-runtime-readiness.mjs` in static mode.
2. `supervisor-behavioral-certification.mjs` in dry-run mode.
3. `check-supervisor-admin-tool-export-sync.mjs`.
4. JSON contract validation.
5. Evidence artifact upload with 14-day retention.

Scheduled or manually dispatched failures open or update a GitHub issue labeled `supervisor-runtime-assurance`. A later successful run comments on and closes the open issue.

## Docs Agent controls

PR branch mutation is opt-in.

- `skip-docs-agent`: skip the PR Docs Agent job completely.
- Branch prefix `gpt/no-docs-agent/`: skip the PR Docs Agent job completely.
- No label: generate and upload a preview artifact only; do not push to the PR branch.
- `docs-agent-write`: commit generated documentation to the PR branch.
- `docs-agent-automerge`: commit generated documentation and request auto-merge.

The main-branch follow-up documentation workflow remains unchanged.

## Governed live readiness

Invoke the exported Admin tool:

- Tool: `supervisor_runtime_readiness`
- Arguments: `extra_args=["--live"]`

Required success evidence:

- `ok=true`
- `execution_ready=true`
- `blockers=[]`
- required tables and columns pass
- missing skill grants equal zero
- fallback health issues equal zero
- `secrets_included=false`

## Governed behavioral certification

### Dry-run

Invoke:

- Tool: `supervisor_behavioral_certification`
- Arguments: `extra_args=[]`

Required dry-run evidence:

- `mode=dry_run`
- `applies_provider_calls=false`
- `persistent_fixture_writes=false`
- `transaction_rollback_required=true`

### Apply authorization

Create an approved capability envelope using:

- `app_key=platform_orchestration`
- `capability_key=supervisor_behavioral_certification`
- `operation_intent=supervisor_behavioral_certification`
- `runtime_surface=admin_control`

Apply authorization requires zero blocking gaps, the active policy `supervisor_behavioral_certification_apply_v1`, and a fresh successful dry-run.

### Rollback-only apply

Invoke:

- Tool: `supervisor_behavioral_certification`
- Arguments: `extra_args=["--apply","--confirm=APPLY_SUPERVISOR_BEHAVIORAL_CERTIFICATION"]`

Required success evidence:

- all behavioral checks are true
- `transaction_rolled_back=true`
- `provider_calls=0`
- an execution trace ID is present
- `secrets_included=false`

## Alert lifecycle

Do not resolve a supervisor operational alert from narrative alone. Resolve only when same-cycle evidence contains:

1. live readiness with `execution_ready=true` and no blockers;
2. successful rollback-only behavioral certification;
3. `transaction_rolled_back=true`;
4. `provider_calls=0`;
5. a persisted execution trace ID.

Record the readiness timestamp and trace ID in the lifecycle note. If a later live check fails, reopen or create an alert and attach current evidence.

## Triage

- Static readiness failure: inspect script/export/manifest drift and CI changes.
- Dry-run failure: inspect the certification contract before any live attempt.
- Apply authorization failure: inspect capability registration, policy matching, expiry, and blocking gaps; never bypass the policy.
- Behavioral apply failure: confirm rollback occurred, keep the operational alert open, and attach the failed trace or error.
- Docs Agent branch mutation without an opt-in label: treat as a workflow regression and block merge.
