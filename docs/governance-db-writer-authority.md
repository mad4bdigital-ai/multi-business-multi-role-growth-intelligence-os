# Governance DB Writer Authority

## Purpose

Canonical capability-envelope **control-plane** and governed-migration authorization mutations must not execute with the ordinary runtime database identity. The application therefore uses a dedicated Governance DB writer pool for those bounded tables while preserving the ordinary `DB_*` pool for normal runtime/authority reads and preserving an already-open execution transaction when envelope consumption must be atomic with a business mutation.

This source contract addresses Issue #6813. It does **not** provision a Production principal, grant privileges, configure secrets, deploy Production, execute a migration, or prove Production readiness by itself.

## Environment contract

| Variable | Requirement | Fallback |
|---|---|---|
| `GOVERNANCE_DB_USER` | Required for governance mutation surfaces | **None** — never `DB_USER` |
| `GOVERNANCE_DB_PASSWORD` | Required for governance mutation surfaces | **None** — never `DB_PASSWORD` |
| `GOVERNANCE_DB_HOST` | Optional | physical `DB_HOST` only |
| `GOVERNANCE_DB_PORT` | Optional | physical `DB_PORT`, then 3306 |
| `GOVERNANCE_DB_NAME` | Optional | physical `DB_NAME` only |
| `GOVERNANCE_DB_CONNECTION_LIMIT` | Optional | 2; bounded to 1..5 |
| `GOVERNANCE_DB_CONNECT_TIMEOUT_MS` | Optional | `DB_CONNECT_TIMEOUT_MS`, then 10000 ms; bounded |

Missing governance user/password fails closed with `GOVERNANCE_DB_CONFIG_MISSING`. The error exposes only missing variable names and no credential values.

## Reader / writer boundary

- Runtime reader (`getPool()`): repository/resource authority resolution and other non-mutating runtime reads.
- Governance writer (`getGovernancePool()`): envelope creation/approval/apply-authorization, governed migration authorization/policy/certification writes, standalone lifecycle mutations, and same-cycle governance readback.
- Execution transaction exception: when a business mutation already holds a SQL transaction, lifecycle/reference consumption may reuse that **explicit transaction object** so envelope state and the business mutation remain atomic. This is not a credential fallback and does not cause `GOVERNANCE_DB_USER`/`GOVERNANCE_DB_PASSWORD` to inherit `DB_USER`/`DB_PASSWORD`.
- Capability envelope creation performs authority/dry-run resolution with the runtime reader, then resolves the governance writer only at the canonical ledger INSERT boundary.
- Envelope approval and apply-authorization use a single Governance writer transaction for current-state read, mutation, conditional update, and same-cycle readback.
- Governed migration authorization resolves the capability envelope with the runtime reader, then performs authorization/policy/certification registry reads and writes with the Governance writer.
- Batch-expire dry-run remains read-only; batch-expire apply is a standalone governance mutation and stays on the Governance writer.

The execution transaction exception exists to prevent a separate-principal post-commit lifecycle write from breaking atomicity. It must not be used to bypass control-plane writer selection.

## Minimum Production privilege matrix

The initial Governance writer principal must be table-scoped. The reviewed minimum is:

| Table | Minimum operations |
|---|---|
| `capability_resolution_envelope_ledger` | `SELECT, INSERT, UPDATE` |
| `approval_holds` | `INSERT` |
| `governed_migration_authorization_registry` | `SELECT, INSERT, UPDATE` |
| `capability_apply_authorization_policy_registry` | `SELECT, INSERT, UPDATE` |
| `runtime_dispatch_certification_registry` | `SELECT, INSERT, UPDATE` |
| `governed_migration_ledger` | `SELECT` |

Do **not** grant `GRANT ALL`, schema-wide write privileges, `DROP`, `ALTER`, `CREATE`, `DELETE`, `FILE`, `PROCESS`, `SUPER`, account-management authority, or equivalent administrative privileges unless a later separately reviewed contract proves a need.

A Production administrator may translate the matrix into provider-specific SQL only after separate authorization. Credentials and generated passwords must never be committed, printed to logs, attached to artifacts, or returned through status endpoints.

## Post-merge provisioning and readback

Source merge is only a prerequisite. Issue #6813 remains open until all of the following are performed through separately authorized Production governance:

1. Create a dedicated MariaDB principal outside the application runtime.
2. Apply only the reviewed table/operation matrix.
3. Configure `GOVERNANCE_DB_*` Production secrets without exposing values.
4. Promote the merged source through the normal `main -> Production` lifecycle and prove runtime parity.
5. Run a bounded no-secret readiness probe that proves required operations are available and prohibited broad privileges are absent.
6. Re-read the governed migration ledger/state.
7. Obtain a **fresh** Migration 1050 readiness authorization; do not reuse the authorization consumed by run `31379417191`.

Migration Apply, live GitHub Ruleset apply, Production ref mutation, database grants, provider mutation, deployment/restart, and secret writes are independent governed operations and are not authorized by this source PR.

## Verification expectations

Repository CI must prove at minimum:

- runtime-only `DB_USER`/`DB_PASSWORD` cannot satisfy governance configuration;
- governance credential errors contain no secret values;
- canonical envelope creation writes through `writerPool` while repository authority reads remain on `readPool`;
- approval/apply-authorization and migration bootstrap select the dedicated writer by default;
- an explicit existing execution transaction can preserve envelope lifecycle/reference atomicity without turning runtime credentials into Governance DB credential fallback;
- migration bootstrap uses separate reader and writer pools;
- batch apply preserves Governance writer transaction and same-cycle readback semantics;
- no provider call or external business write is introduced by this boundary.
