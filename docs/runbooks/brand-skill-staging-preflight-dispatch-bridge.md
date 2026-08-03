# Brand Skill Staging Read-only Preflight Rebind

## Purpose

This phase restores the governed Staging read-only preflight after the target workflow was repaired by PR `#4734`.

The repair changed the Git blob of:

```text
.github/workflows/brand-skill-mariadb-certification.yml
```

Therefore the former authorization and binding are not reused. The new execution separates the workflow definition authority from the runtime and migration snapshot authority.

## Fresh authorization token

A new execution is accepted only from a newly created comment on Issue `#3809` whose complete body is:

```text
AUTHORIZE_BRAND_SKILL_STAGING_READ_ONLY_PREFLIGHT_E1084397_B6E5F7BD_ECA204DC
```

The comment must be authored by repository user ID `271942579` with association `OWNER`, `MEMBER`, or `COLLABORATOR`.

The exact comment is the authorization evidence. The workflow does not reuse the historical authorization comment ID.

## Split immutable bindings

### Repaired workflow definition

The workflow definition used by `workflow_dispatch` must match both:

- repair merge commit: `8926c000473f1f3fc3480f6d530b314ec3c7dfcc`
- workflow blob: `b6e5f7bd4a73803e4f062097a32bd9d8d17756ec`

The same blob must still be present on current `main`.

### Runtime and migration snapshot

The Staging preflight checks out and inspects:

- runtime commit: `e1084397317a7f2645d78fc43a3064eef98fabaf`
- migration SHA-256: `eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802`
- migration blob on both the runtime commit and current `main`: `1e90ac74cfff2413ee10abf5986bc2b28bcf5ad7`
- statement count: `3`

The repaired workflow blob is intentionally not required to exist at the runtime commit. The repair happened later and only fixes the GitHub Actions execution context before checkout.

## Binding identity

The one-time completion identity is:

```text
b6e5f7bd4a73803e4f062097a32bd9d8d17756ec:e1084397317a7f2645d78fc43a3064eef98fabaf:eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802:3
```

Including the workflow blob makes the repaired attempt distinct from the earlier failed dispatch that used workflow blob `e36f9241a819018659788edb2a8a854da641b4b8`.

A completed marker for the new binding prevents every later execution. A dispatched marker prevents reusing the same authorization comment, while a newly created exact authorization comment can authorize a distinct retry if an earlier target run failed. Failed attempts do not silently become completion evidence.

## Execution surfaces

### Issue comment bridge

The primary path is:

```text
.github/workflows/brand-skill-staging-preflight-dispatch-bridge.yml
```

It validates the triggering comment, repository actor, open control issue, repaired workflow blob, migration blob, absence of a completed marker, and absence of a prior dispatch for the same authorization comment before dispatch.

### Main-push fallback

The fallback path is:

```text
.github/workflows/brand-skill-staging-preflight-push-fallback.yml
```

It runs only for a `main` push by user ID `271942579` whose commit message contains:

```text
RUN_BRAND_SKILL_STAGING_READ_ONLY_PREFLIGHT_E1084397_B6E5F7BD_ECA204DC
```

Before dispatch it discovers a fresh exact authorization comment on Issue `#3809` and applies the same immutable binding and one-dispatch-per-comment checks as the issue-comment bridge. Both execution surfaces share one non-cancelling concurrency group, so they cannot dispatch the same authorization concurrently.

## Dispatch inputs

Both execution surfaces dispatch the repaired target workflow on `main` with exactly:

```text
run_mode=staging_read_only
expected_commit_sha=e1084397317a7f2645d78fc43a3064eef98fabaf
expected_migration_sha256=eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802
```

The target workflow validates typed inputs from repository root before checkout, then checks out the exact runtime commit.

## Required evidence

The target run must upload `brand-skill-staging-read-only-preflight`. The bridge independently requires:

- `ok=true`
- `ready=true`
- `target_environment=staging`
- `commit_sha=e1084397317a7f2645d78fc43a3064eef98fabaf`
- `migration_checksum_sha256=eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802`
- `statement_count=3`
- `applies_sql=false`
- `records_ledger=false`
- `migration_apply_authorized=false`
- `production_authorized=false`
- `requires_separate_apply_authorization=true`
- `provider_calls=false`
- `external_writes=false`
- `secrets_included=false`

Issue `#3809` is closed only after these fields pass.

## Safety boundary

Neither bridge:

- receives `STAGING_DB_*` secrets;
- binds to the `staging` environment;
- applies SQL;
- invokes the governed migration runner;
- passes `--apply`;
- writes a migration ledger;
- seeds policies or grants;
- accesses Production;
- deploys or restarts services;
- performs provider calls or external business writes;
- reads or exposes credential payloads.

Only the target workflow is bound to the `staging` environment. Migration Apply remains a separate operation requiring a new explicit authorization after successful read-only evidence.
