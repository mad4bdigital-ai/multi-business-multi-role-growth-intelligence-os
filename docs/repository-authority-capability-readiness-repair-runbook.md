# Repository Authority Capability Readiness Repair Runbook

## Scope

This runbook governs only:

```text
http-generic-api/migrations/20260725_repository_authority_capability_readiness_repair.sql
```

Approved migration SHA-256:

```text
d655e9a45b9fd6b0d7b9c7f3069fbc50d5fd5a76ac0d426629b42a5de971c58b
```

The migration contains three transaction-safe DML statements. It does not call GitHub, mutate webhooks, read credential payloads, or perform external writes.

## Required execution surface

Run through `governed_migration_execute`. The tool routes this migration to:

```text
http-generic-api/scripts/
repository-authority-capability-readiness-repair-runner.mjs
```

Do not execute it through the generic statement-by-statement runner or through interactive multi-statement database control.

## Dry-run contract

The dry-run reads and classifies:

- the managed GitHub connected-system row;
- the production repository-authority binding;
- the repository capability binding;
- the active apply-authorization policy;
- the migration authorization registry row;
- the matching-checksum migration ledger state;
- the live collations for both `system_id` columns.

The dry-run never executes SQL. A `record_only` result is not auto-certified by the generic tool; it requires explicit live row and metadata review.

## Apply prerequisites

All conditions are mandatory:

1. The deployed migration checksum equals the approved checksum.
2. The migration authorization is active and permits apply.
3. A fresh `platform_orchestration` capability envelope exists.
4. The envelope is unexpired, dispatch-ready, `apply_allowed=true`, and `readback_required=true`.
5. Typed confirmation equals:

```text
APPLY_20260725_REPOSITORY_AUTHORITY_CAPABILITY_READINESS_REPAIR
```

6. No matching checksum already exists in `governed_migration_ledger`.
7. The target rows are not already fully satisfied.

## Atomic execution

The dedicated runner:

1. acquires a named MySQL advisory lock;
2. begins one database transaction;
3. resolves and locks the capability envelope;
4. locks the target registry rows;
5. executes the three migration statements;
6. performs row and version readback;
7. writes the migration ledger row;
8. consumes the capability envelope;
9. commits all changes together.

Any failure before commit rolls back the migration statements, ledger write, and envelope consumption together.

## Post-commit readback

The runner verifies after commit that:

- the managed system is active;
- repository authority points to the managed system;
- `installation_id` is `NULL`;
- capability policy points to the active policy;
- applicable authority and capability versions incremented;
- the exact migration checksum is present in the ledger;
- the capability envelope was consumed;
- no provider or external write flags were set.

If post-commit readback is ambiguous, do not retry. Read the target rows and migration ledger first.

## Rollback and retry policy

- Pre-commit failure: transaction rollback is automatic.
- Post-commit transport/readback failure: treat outcome as unknown and run readback only.
- Blind retries are prohibited.
- Metadata-only drift or an already-satisfied core link requires manual diagnosis or record-only governance; do not reapply version increments.

## Production boundary

Merging this repository change does not apply the migration. Production execution requires a separately created and approved capability envelope after the atomic runner has been promoted and deployed.
