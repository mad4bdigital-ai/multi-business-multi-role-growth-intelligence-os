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
- Governance writer (`getGovernancePool()`): envelope creation/approval/apply-authorization, governed migration authorization/policy/certification writes, **platform resource-authority binding creation**, standalone lifecycle mutations, and same-cycle governance readback.
- `platform_resource_authority_bindings` is an authority/control-plane registry, not ordinary business persistence. Runtime consumers may resolve active bindings through the ordinary reader, but creation of a binding changes which principal may mutate an external resource and therefore must use the dedicated Governance writer.
- Both current binding-creation surfaces — `applyPlatformResourceAuthorityGrant()` and `createRepositoryMutationAuthorityBindingV6()` — keep validation/existing-binding reads on the runtime reader and use the Governance writer only for `INSERT` plus exact same-cycle binding readback. Neither accepts `DB_USER`/`DB_PASSWORD` as implicit write authority.
- Execution transaction exception: when a business mutation already holds an **actual SQL connection with transaction primitives** (`beginTransaction`, `commit`, and `rollback`), lifecycle/reference consumption may reuse that explicit connection so envelope state and the business mutation remain atomic. A general pool exposing `getConnection()` does not qualify and is never promoted into mutation authority.
- Legacy `pool` compatibility is therefore structural and narrow: it is honored only for an already-open transaction connection. A broad runtime pool is ignored for lifecycle-writer selection and the dedicated Governance writer is used instead.
- An explicitly supplied `transactionPool` that is not an actual transaction connection fails closed with `CAPABILITY_ENVELOPE_LIFECYCLE_TRANSACTION_INVALID` and no secret-bearing details.
- Capability envelope creation performs authority/dry-run resolution with the runtime reader, then resolves the governance writer only at the canonical ledger INSERT boundary.
- Envelope approval and apply-authorization use a single Governance writer transaction for current-state read, mutation, conditional update, and same-cycle readback.
- Governed migration authorization resolves the capability envelope with the runtime reader, then performs authorization/policy/certification registry reads and writes with the Governance writer.
- Batch-expire dry-run remains read-only; batch-expire apply is a standalone governance mutation and stays on the Governance writer.

The execution transaction exception exists only to prevent a separate-principal post-commit lifecycle write from breaking an already-open execution transaction. It must not be used to bypass control-plane writer selection or to reinterpret `DB_USER`/`DB_PASSWORD` as Governance DB credentials.

## Production environment authority preflight

Database mutation authority and environment/deployment authority remain separate domains. Before any Production Governance DB principal provisioning, privilege-readiness check, or governed-migration lifecycle that depends on the dedicated writer, the caller must pass `resolveGovernanceProductionPreflight()`.

The preflight composes the #6813 writer contract with the Spec 018 Environment Authority resolver without moving database authority into Spec 018. It requires:

- valid dedicated `GOVERNANCE_DB_USER` and `GOVERNANCE_DB_PASSWORD` configuration with no runtime-credential fallback;
- canonical Environment Authority resolution;
- exact `production_branch = Production`;
- exact `promotion_target_branch = Production`.

A mismatch fails closed with `GOVERNANCE_PRODUCTION_ENVIRONMENT_AUTHORITY_MISMATCH`. The returned evidence contains no usernames or password values and performs no database connection, SQL execution, Migration Apply, provider mutation, deployment, or restart.

Environment Authority therefore answers **where Production authority lives**. The Governance DB writer contract answers **which isolated database identity may perform bounded governance mutations**. Passing one never grants or substitutes for the other.

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
| `platform_resource_authority_bindings` | `SELECT, INSERT` |

`SELECT` on `platform_resource_authority_bindings` is required only for same-cycle exact writer readback after creation; runtime binding resolution continues through the ordinary read identity. `UPDATE` and `DELETE` are intentionally absent because no current runtime binding-creation path requires them.

Do **not** grant `GRANT ALL`, schema-wide write privileges, `DROP`, `ALTER`, `CREATE`, `DELETE`, `FILE`, `PROCESS`, `SUPER`, account-management authority, or equivalent administrative privileges unless a later separately reviewed contract proves a need.

A Production administrator may translate the matrix into provider-specific SQL only after separate authorization. Credentials and generated passwords must never be committed, printed to logs, attached to artifacts, or returned through status endpoints.

## Post-merge provisioning and readback

Source merge is only a prerequisite. Issue #6813 remains open until all of the following are performed through separately authorized Production governance:

1. Pass the no-secret Governance Production environment-authority preflight.
2. Create a dedicated MariaDB principal outside the application runtime.
3. Apply only the reviewed table/operation matrix, including `SELECT, INSERT` on `platform_resource_authority_bindings` if not already present.
4. Configure `GOVERNANCE_DB_*` Production secrets without exposing values.
5. Promote the merged source through the normal `main -> Production` lifecycle and prove runtime parity.
6. Run a bounded no-secret readiness probe that proves required operations are available and prohibited broad privileges are absent.
7. Re-read the governed migration ledger/state.
8. Obtain a **fresh** Migration 1050 readiness authorization; do not reuse the authorization consumed by run `31379417191`.

Migration Apply, live GitHub Ruleset apply, Production ref mutation, database grants, provider mutation, deployment/restart, and secret writes are independent governed operations and are not authorized by this source PR.

## Verification expectations

Repository CI must prove at minimum:

- runtime-only `DB_USER`/`DB_PASSWORD` cannot satisfy governance configuration;
- governance credential errors contain no secret values;
- Production preflight rejects any Environment Authority whose production branch or promotion target is not exactly `Production`;
- Production preflight returns no usernames or password values and performs no database connection or mutation;
- canonical envelope creation writes through `writerPool` while repository authority reads remain on `readPool`;
- both resource-authority binding creation surfaces write and read back through the Governance writer while ordinary binding lookup remains on the runtime reader;
- a generic runtime pool cannot be supplied as implicit resource-authority mutation authority;
- resource-authority same-cycle readback verifies the exact binding target and principal/scope before success is returned;
- the Governance privilege contract allows only `SELECT, INSERT` on `platform_resource_authority_bindings` and rejects `UPDATE`/`DELETE` as broadening;
- approval/apply-authorization and migration bootstrap select the dedicated writer by default;
- a general runtime pool cannot become lifecycle mutation authority merely because a caller supplied it as `pool`;
- only an already-open SQL transaction connection may preserve envelope lifecycle/reference atomicity, and an invalid explicit `transactionPool` fails closed;
- migration bootstrap uses separate reader and writer pools;
- batch apply preserves Governance writer transaction and same-cycle readback semantics;
- no provider call or external business write is introduced by this boundary.
