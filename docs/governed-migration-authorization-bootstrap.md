# Governed Migration Authorization Bootstrap

## Purpose

The governed migration runner requires every migration to have an active row in `governed_migration_authorization_registry` before dry-run or apply. A migration cannot safely authorize itself because the runner checks authorization before reading or executing its SQL.

The Admin virtual tool `governed_migration_authorization_bootstrap` closes that bootstrap gap without executing migration SQL.

## Safety contract

The tool:

- is Admin-only;
- requires a specifically scoped Capability Resolution Envelope that is approved, unexpired, secret-free, `ready_for_dispatch`, dispatchable, and has zero blocking gaps; `apply_allowed` is not required because this tool records authorization evidence only and never executes migration SQL;
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

## Verified rollout: migration 1020

Migration `1020_sprint69_multi_surface_tenant_agent_runtime.sql` completed its governed rollout on June 21, 2026.

Verified evidence:

- source PR: `#1824`;
- source merge SHA: `694b01b243a6c4aca18b7eae4d85f93b8826b8f6`;
- migration SHA-256: `aba1c04c229d1acd4d050df5f76654ca364bd4871039d6794f161f06875432ba`;
- executable statement count: `8`;
- preflight: `pass`, with zero risk and zero destructive findings;
- authorization bootstrap: idempotent same-checksum readback, with no migration SQL execution;
- governed migration ledger run: `d1d4f240-ac6f-49c0-b0ce-e6ac8ce9838c` in `apply` mode;
- applied at: `2026-06-21T01:49:31.056Z`;
- schema readback: `agent_surface_catalog`, `tenant_agent_surface_deployments`, and `user_agent_surface_preferences` present;
- tenant tool readback: all five required agent-surface tools enabled;
- production parity run: `7b8f1351-d02c-444a-b373-d43a4ae91c1a`, verified on commit `4260a99841dc9ac039ae799732d5d303a3e9a51f`;
- release readiness run: `6e4e7b09-30cd-4fa2-bb1e-f5fa48d8f245`, with `70/70` checks passing and zero warnings or failures.

A later reconciliation dry-run returned `no_action` / `already_recorded` because the ledger checksum, schema objects, and authorization row already matched. Re-running authorization or apply is therefore unnecessary unless the migration file checksum changes through a separately reviewed PR.
