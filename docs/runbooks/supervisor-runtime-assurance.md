# Supervisor Runtime Assurance Runbook

## Purpose

This runbook covers supervisor runtime readiness, behavioral certification, post-closure monitoring, automated repository alerts, and generated-documentation controls.

## Safety contract

- Scheduled GitHub assurance is static and dry-run only.
- Scheduled assurance never uses `--live` or `--apply`.
- Provider calls, credential payload reads, deploys, publishes, spend, and external runtime writes are forbidden.
- Live readiness and rollback certification run only through governed Admin tools.
- A resolved operational alert may be reopened only with fresh evidence.
- Generated Work Maps have one remote branch writer: `.github/workflows/spec-kit-work-map-autofix.yml`.
- Docs Agent and the Work Map Integration Gate may generate local previews or repair artifacts, but they must not commit or push Work Maps.

## Automated assurance

`.github/workflows/supervisor-runtime-assurance.yml` runs every day at 04:23 UTC and on relevant pull requests or pushes.

It runs:

1. `supervisor-runtime-readiness.mjs` in static mode.
2. `supervisor-behavioral-certification.mjs` in dry-run mode.
3. `check-supervisor-admin-tool-export-sync.mjs`.
4. JSON contract validation.
5. Evidence artifact upload with 14-day retention.

Scheduled or manually dispatched failures open or update a GitHub issue labeled `supervisor-runtime-assurance`. A later successful run comments on and closes the open issue.

## Generated documentation controls

### Docs Agent

Docs Agent is preview-only for pull requests.

- `skip-docs-agent`: skip the pull-request Docs Agent preview.
- Branch prefix `gpt/no-docs-agent/`: skip the pull-request Docs Agent preview.
- Otherwise, Docs Agent generates and uploads a review artifact containing `docs/auto-docs-agent/**` and `docs/work-maps/**` previews.
- Docs Agent does not commit, push, merge, or authorize Work Map branch mutation.
- After a merge to `main`, Docs Agent may open a reviewed follow-up PR limited to `docs/auto-docs-agent/**`. It does not auto-merge that PR.

### Governed Work Map mutation

The sole remote writer is `Spec Kit Work Map Autofix`.

A write may start only through `workflow_dispatch` with:

- an existing same-repository pull-request branch;
- the full current `expected_head_sha` for that branch;
- exactly one open pull request from that branch targeting `main`.

The writer must:

- reject `main` and `Production` as target branches;
- validate the branch name and exact 40-character expected SHA;
- checkout the exact authorized SHA rather than a moving branch ref;
- verify local and remote heads equal the authorized SHA before generation and again before push;
- verify the target belongs to the same repository and maps to exactly one open pull request targeting `main`;
- generate twice and prove idempotency;
- reject changes outside `docs/work-maps/**`;
- avoid force push and protected-branch bypass;
- verify the remote pushed SHA;
- dispatch CI and the Work Map Integration Gate after a successful commit;
- publish a bounded `mad4b.spec-kit-work-map-autofix.v2` diagnostic artifact and a `WORK_MAP_AUTOFIX_V2` pull-request report.

The workflow has no pull-request event trigger and does not use a body marker as authorization. The exact branch and SHA are explicit dispatch inputs, and stale or mismatched identity fails closed before generation or push.

The Work Map Integration Gate remains read-only. When maps are stale, it produces an exact-head repair candidate artifact, records the tested SHA and source hash, and then fails closed. That artifact is evidence for the governed writer; it is not itself a branch mutation.

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
- Docs Agent Work Map branch mutation: treat as a sole-writer policy violation and block merge.
- Work Map Autofix without an exact same-repository pull-request branch and `expected_head_sha`, or with a diff outside `docs/work-maps/**`: block the run and keep the pull request unmerged.
