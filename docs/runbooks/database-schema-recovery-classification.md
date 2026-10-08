# Cross-Environment Database Schema Recovery — Decision & Authority Contract

> Applies to Runtime, Governance and Runtime Persistence in Staging and Production.
> Source-based diagnostics and recovery *routing* are independent from Production database mutation authority.

## Why 0 visible tables is not 0 physical tables

Observed Production on 2026-10-08: `Production` branch and deployed SHA `e0c07f6fba431650b87d7a6f3dde76a364be6223` matched; `/deployment-info?include_governance_db_readiness=1` returned `GOVERNANCE_DB_SCHEMA_READINESS_FAILED`, `required_schema_table_count=17`, `observed_required_schema_table_count=0`, and `missing_required_schema_table_count=17`. The ordinary probe uses the *dedicated Governance application's* `information_schema.TABLES` visibility, not independent physical access. Therefore the result means **zero required tables visible to this principal**, not proof that 17 tables are physically absent. Governance `TABLE_PRIVILEGES` was not evaluated after schema failure. Production mutation is forbidden on this evidence alone.

## Routing matrix

| Evidence state | Meaning | Allowed next step | Not allowed |
|---|---|---|---|
| Principal sees 0/17 or partial tables, no privileged physical census | Physical state unknown: privilege restriction, wrong target, schema absence, or schema drift all remain possible | `database_full_inspection` **read-only**, exact Production deployment/target/role authority, Recovery Control Store | Empty baseline rebuild, direct GRANT, any migration |
| Verified independent role census: zero tables **and** zero views/triggers/routines/events | `confirmed_zero_objects` / candidate `EMPTY_UNINITIALIZED_DATABASE` | Exact role-bound `<role>.baseline.rebuild_empty` immutable *plan* with approved canonical source bundle and backup evidence | Unapproved auto-apply; unrelated role rebuild; database creation |
| Verified nonzero schema objects, required table physically missing | `confirmed_partial_schema` | Find exact source-owned additive migration/recovery recipe by role/table, dependencies and checksum; static preflight, backup, human-authorized immutable plan | Empty rebuild; generic `CREATE TABLE` or guessed DDL; `DROP` of existing objects |
| Required tables physically present but invisible to app principal | `grant_or_visibility_drift` | Exact principal/table/operation privilege census; governed additive least-privilege grant plan if needed | Schema rebuild; schema-wide `GRANT ALL`; `REVOKE ALL` shortcut |
| Required table exists, wrong column/index/FK/engine/collation | `confirmed_structural_drift` | Migration dependency graph, deterministic DDL preconditions, data preservation, rollback/forward-repair evidence and separate approval | Blind `CREATE TABLE IF NOT EXISTS` (does not alter malformed tables) |
| Fully present and structurally exact | `confirmed_schema_present` | Independently verify direct grants, effective roles, application write/read functional smoke, backup and deployment parity | Claim `READY` merely from table names |
| Query error, inconsistent counts, changed SHA/schema fingerprint, role or DB mismatch | `blocked` / `visibility_unverified` | Repeat bounded read-only inspection or reconcile unknown prior operation | Automatic retry or mutation |

The general fail-closed classifier lives at `http-generic-api/databaseSchemaRecoveryTriage.js` and is covered by `test-database-schema-recovery-triage.mjs`. It supplies a **candidate** action only; it never dispatches an operation. The canonical Recovery Kernel remains the sole governed planner/executor. The independent verified census must carry exact deployed SHA, database/role identity, all five physical object categories, required-table presence, a durable inspection run ID and evidence SHA-256.

## Critical metadata-visibility proof for an empty role

The host-local `databaseObjectCounts()` function queries `information_schema` under
its database connection identity. A result of zero tables/views/triggers/routines/events
**may still be zero visible objects** rather than zero physical objects. Neither
`full_inspection=true` nor a 64-hex count fingerprint certifies permission to enumerate
all objects; hashing an incomplete census does not turn it into complete evidence.

Recovery Kernel therefore refuses to produce `<role>.baseline.rebuild_empty`
candidates without an exact role-bound
`mad4b.role-physical-object-visibility.v1` proof covering:
the same deployed 40-hex SHA, database identity, role, role-object fingerprint,
independent privileged census, complete enumeration of all five object classes,
and read-only execution. Without that proof it emits
`zero_visible_objects_unverified` (non-executable), even when all observed counts
are zero. A caller-supplied boolean or an app-level readiness snapshot **must never**
be accepted as this proof. The classifier and Recovery Kernel now require
separate synchronous **server-injected trusted evidence verifiers**, and both
default to unavailable/fail-closed. These verifiers must independently resolve
the durable record, attest its issuer, signature, same-cycle database identity,
object metadata visibility, SHA and source-required table evidence digest.
Self-reported `verified=true` or a copied SHA-256 string is insufficient.
Verifier crashes or false responses also fail closed. Host-local authorized
evidence issuance, persisted durability and cryptographic trust binding remain
external dependencies; this PR does **not** claim they are deployed.

## Existing operation capabilities versus missing integrations

1. `database_full_inspection` already reports role object counts/classifications and required-table evidence via `runtimeBootstrapContract.js` and Recovery Kernel.
2. `governance.baseline.rebuild_empty` and `runtime_persistence.baseline.rebuild_empty` exist for **verified zero-object roles only**, with exact plan, authority, independent durable control store, backups and readback.
3. `runtime_persistence.schema.repair` is registered for *specific*, independently diagnosed partial Persistence schema drift. **Do not substitute it for Governance partial repair.**
4. Arbitrary missing Governance/Runtime tables require an exact source migration and a separate capability, review and approval if no registered recipe exists. The classifier deliberately returns `prepare_registered_schema_migration_review` rather than claiming such an apply capability is available.
5. This source slice neither materializes a missing Production table nor binds the new classifier directly into the Recovery Kernel's durable inspection transport. Connecting trusted physical inspection to classifier inputs requires a separately verified adapter; a caller-generated JSON assertion is not acceptable independent physical proof. No path to automatic Production DDL is opened by this PR.

## Minimum operational sequence

Exact branch/SHA and runtime variant → dedicated DB principal vs target database resolution → independent host-local *read-only* full-role census (tables/views/triggers/routines/events and grant visibility) → verify that Recovery Control Store is independent and mutation-grade → classify finding → match role and source-controlled migration or role-empty baseline manifest → backup with restore evidence → immutable single-role plan and hash/fingerprint → independently approved exact-step confirmation → apply only the bounded capability (if authorized) → same-cycle physical census, direct-privilege check, behavior smoke, deployment parity and audit → close or mark unknown outcome for **readback-only** reconciliation.

No mutation without a current qualified physical proof, an existing source-controlled recipe, adequate backup, recovery-store readiness, and an exact separate owner authorization. Production promotion `main → Production` installs code and contracts, **not** tables, grants or credentials; live recovery remains a separate governed process.
