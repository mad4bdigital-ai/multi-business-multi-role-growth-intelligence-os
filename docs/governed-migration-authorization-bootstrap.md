# Governed Migration Authorization Bootstrap

## Purpose

The governed migration runner requires every migration to have an active row in `governed_migration_authorization_registry` before dry-run or apply. A migration cannot safely authorize itself because the runner checks authorization before reading or executing its SQL.

The Admin virtual tool `governed_migration_authorization_bootstrap` closes that bootstrap gap without executing migration SQL.

## Safety contract

The tool:

- is Admin-only;
- requires a ready Capability Resolution Envelope with a migration-authorization operation intent and `apply_allowed=true`;
- requires the exact migration filename, SHA-256 checksum, statement count, merged PR number, merge commit SHA, and typed confirmation;
- reads only a repository migration file under `http-generic-api/migrations`;
- requires the normal migration preflight to pass with zero risk findings;
- rejects destructive SQL including drop, truncate, delete, destructive alter, table rename, or disabled foreign-key checks;
- creates only one checksum-bound authorization-registry row;
- sets `risk_tier=medium`, `requires_preflight=1`, `requires_confirmation=1`, `allow_record_only=0`, and `allow_apply=1`;
- performs same-cycle authorization readback;
- marks the Capability Resolution Envelope referenced only after a successful or idempotent readback;
- never executes the target migration, calls a provider, sends externally, reads credentials, or returns secrets.

## Typed confirmation

The confirmation is deterministic:

```text
AUTHORIZE_GOVERNED_MIGRATION_<MIGRATION_FILENAME_WITHOUT_SQL>
```

For migration 1020:

```text
AUTHORIZE_GOVERNED_MIGRATION_1020_SPRINT69_MULTI_SURFACE_TENANT_AGENT_RUNTIME
```

## Required sequence

1. Merge the reviewed migration and bootstrap-tool code through a governed PR with passing CI.
2. Verify production Git HEAD matches the merged `main` commit.
3. Create and approve a short-lived Capability Resolution Envelope for `governed_migration_authorization_bootstrap`.
4. Call the bootstrap tool with checksum, statement count, PR, merge SHA, typed confirmation, and envelope ID.
5. Read back the authorization row in the same cycle.
6. Run `migration_apply_guarded_dry_run` for the target migration.
7. Apply only when preflight passes and the user-approved typed apply confirmation is supplied.
8. Read back the migration ledger, required schema objects, tool bindings, release readiness, and deployment parity.

## Non-goals

The bootstrap tool does not:

- authorize destructive migrations;
- bypass preflight or typed apply confirmation;
- add a legacy runner allowlist entry;
- create reconciliation rules automatically;
- apply SQL;
- repair failed migrations;
- replace PR review, CI, or production readback.
