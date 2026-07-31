# Brand Skill Staging Preflight Dispatch Bridge

## Purpose

This bridge exists only to expose a governed GitHub-native execution surface for the already reviewed workflow:

```text
.github/workflows/brand-skill-mariadb-certification.yml
```

It does not copy, replace, or weaken the Staging preflight contract. It dispatches the unchanged target workflow with the exact reviewed inputs after validating immutable repository bindings.

## Trigger

The bridge listens only to a newly created comment on Issue `#3809` whose complete body is:

```text
AUTHORIZE_BRAND_SKILL_STAGING_READ_ONLY_PREFLIGHT_E1084397_ECA204DC
```

The comment must be authored by a repository `OWNER`, `MEMBER`, or `COLLABORATOR`. Pull-request comments and comments on every other issue are rejected by the job-level condition.

## Immutable bindings

Before dispatch, the bridge validates all of the following:

- authorization evidence comment: `5136135941`
- authorization user ID: `271942579`
- reviewed commit: `e1084397317a7f2645d78fc43a3064eef98fabaf`
- migration SHA-256: `eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802`
- statement count: `3`
- target workflow blob on `main` and the reviewed commit: `e36f9241a819018659788edb2a8a854da641b4b8`
- target migration blob on `main` and the reviewed commit: `1e90ac74cfff2413ee10abf5986bc2b28bcf5ad7`
- Issue `#3809` remains open
- no completed or dispatched marker already exists for the same binding

Any mismatch fails closed before workflow dispatch.

## Dispatch inputs

The bridge calls the GitHub Actions workflow-dispatch endpoint for the unchanged target workflow with exactly:

```text
ref=main
run_mode=staging_read_only
expected_commit_sha=e1084397317a7f2645d78fc43a3064eef98fabaf
expected_migration_sha256=eca204dcf452875c59d404bf6b67cbbe01b6af41e6afcd3bedd87b31845fb802
```

The target workflow then checks out the exact reviewed commit and performs its own commit, checksum, statement-count, target-environment, and no-apply validation.

## Separation of responsibilities

The bridge has no GitHub environment binding and receives no database secret. It has only the GitHub permissions required to:

- read repository contents and immutable blob metadata;
- dispatch the existing target workflow;
- record progress and evidence on Issue `#3809`;
- close Issue `#3809` after successful artifact validation.

Only the existing target workflow is bound to the `staging` GitHub environment and receives `STAGING_DB_*` secrets.

## One-time and fail-closed behavior

The bridge uses a non-cancelling concurrency group for Issue `#3809`. It records a claim before dispatch and refuses a second dispatch after a `dispatched` or `completed` marker exists for the exact commit/checksum/statement-count binding.

A failed dispatch or target workflow leaves the issue open and records a bounded failure marker. It does not authorize migration apply or retry with changed bindings.

## Evidence closure

After the target run succeeds, the bridge downloads the artifact named:

```text
brand-skill-staging-read-only-preflight
```

It independently validates:

- `ok=true`
- `ready=true`
- `target_environment=staging`
- the exact reviewed commit
- the exact migration SHA-256
- `statement_count=3`
- `applies_sql=false`
- `records_ledger=false`
- `migration_apply_authorized=false`
- `production_authorized=false`
- `requires_separate_apply_authorization=true`
- `provider_calls=false`
- `external_writes=false`
- `secrets_included=false`

Issue `#3809` is closed only after all fields pass.

## Explicitly excluded operations

This bridge does not:

- apply SQL;
- invoke the governed migration runner;
- pass `--apply`;
- create, alter, or drop schema objects;
- write a migration ledger;
- seed policies or grants;
- access Production;
- deploy or restart a service;
- perform provider calls or external writes;
- read or expose credential payloads.

Migration apply remains a separate governed operation requiring a fresh typed authorization after successful Staging preflight evidence.
