# Governed Migration Authorization

## Purpose

This runbook covers the admin-only authorization step required when a repository migration is not yet represented in `governed_migration_authorization_registry`.

Authorization and execution are separate operations. The authorization tool writes registry metadata only. It never executes the migration SQL, calls a provider, reads credential payloads, performs external writes, or returns secrets.

## Surfaces

Use the governed `admin_control` shell aliases:

- `migration_authorization_dry_run`
- `migration_authorization_apply`

Migration execution remains on:

- `migration_reconciliation_dry_run`
- `migration_reconciliation_apply`

Do not use raw DB control or direct SQL to bypass a missing authorization row.

## Dry-run contract

Pass one repository migration filename, without path separators. The tool:

1. resolves the file only inside `http-generic-api/migrations`;
2. computes SHA-256 from the current repository file;
3. runs the existing migration SQL preflight;
4. verifies the executable statement count;
5. derives the minimum allowed risk tier;
6. returns the exact typed confirmation;
7. reads any current authorization row and the active MySQL governance apply policy;
8. performs no mutation.

A missing file, path traversal, failing preflight, or invalid risk tier fails closed.

## Apply authority

Apply requires a capability envelope with this exact scope:

- app: `mysql`
- capability: `mysql_resource_governance`
- operation intent: `mysql.resource.governance_apply`
- runtime surface: `governed_resource_run`
- resource URI: `mysql://platform-schema/governed_migration_authorization_registry`

The envelope must be `ready_for_dispatch`, dispatchable, apply-authorized, unexpired, contain zero blocking gaps, and include no secrets. Its apply evidence must resolve through `mysql_resource_governance_apply_block_v1`, permit no credential binding, prohibit external writes, require typed confirmation, require same-cycle dry-run, and require readback.

Apply also requires:

- exact current SHA-256 in `--expected-checksum`;
- typed confirmation returned by the dry-run;
- a risk tier at or above the preflight minimum;
- a meaningful audit reason;
- the capability-envelope ID.

## Registry write and readback

The tool upserts one exact migration row with:

- `authorization_status=authorized`;
- `authorization_source=platform_admin_review`;
- `policy_key=governed_migration_runner_authorization_v1`;
- `requires_preflight=1`;
- `requires_confirmation=1`;
- `allow_record_only=1`;
- `allow_apply=1`.

Metadata records the migration checksum, preflight result, statement count, schema requirements, capability envelope, approving actor, reason, and explicit no-provider/no-credential/no-external-write/no-secret evidence.

The operation is successful only when same-cycle readback exactly matches the requested contract. Checksum drift or a mismatched envelope blocks the write.

## Migration execution after authorization

Authorization does not mean the migration was applied. After successful authorization:

1. rerun `migration_reconciliation_dry_run` for the exact file;
2. review the reconciliation plan and typed confirmation;
3. run `migration_reconciliation_apply` through its governed contract;
4. verify the migration ledger checksum;
5. verify required tables, views, tools, and bindings;
6. rerun release readiness and production parity.

## Rollback and incident handling

The authorization row is metadata, not schema execution. When authorization was issued incorrectly, disable or archive the exact row through a separately reviewed governance change; do not silently rewrite history. A migration that was already applied requires its own schema rollback plan and readback evidence.

All failures must preserve structured error codes and no-secret evidence. No success claim is valid without same-cycle registry and schema readback.
