# Governance DB Writer Authority

## Purpose

Canonical capability-envelope **control-plane**, governed-migration authorization, bounded resource-authority persistence, and governed response-chunk mutations must not execute with the ordinary runtime database identity. The application therefore uses a dedicated Governance DB writer pool for those reviewed tables while preserving the ordinary `DB_*` pool for normal runtime/authority reads and preserving an already-open execution transaction when envelope consumption must be atomic with a business mutation.

This source contract addresses the DB write-authority incident tracked by Issue #6813 and the related runtime privilege-regression findings. It does **not** provision a Production principal, grant privileges, configure secrets, deploy Production, execute a migration, or prove Production readiness by itself.

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

- Runtime reader (`getPool()`): repository/resource authority resolution, response-chunk schema/load operations, and other non-mutating runtime reads.
- Governance writer (`getGovernancePool()`): envelope creation/approval/apply-authorization, governed migration authorization/policy/certification writes, standalone lifecycle mutations, resource-authority binding insertion and writer readback, governed response-chunk persistence/TTL extension/expiry cleanup, and other explicitly reviewed same-cycle governance readback.
- Platform resource-authority creation writes and performs its first readback on the Governance writer, then independently verifies visibility through the ordinary runtime read plane. A generic runtime pool is never accepted as its mutation authority.
- Governed response chunks use the runtime reader for schema inspection and ordinary load, while `INSERT ... ON DUPLICATE KEY UPDATE`, TTL `UPDATE`, expiry `DELETE`, and immediate post-write integrity readback use the Governance writer. A generic injected `pool` remains a read dependency only; tests or callers that need an explicit writer must provide `writerPool` or an explicit SQL connection.
- Execution transaction exception: when a business mutation already holds an **actual SQL connection with transaction primitives** (`beginTransaction`, `commit`, and `rollback`), lifecycle/reference consumption may reuse that explicit connection so envelope state and the business mutation remain atomic. A general pool exposing `getConnection()` does not qualify and is never promoted into mutation authority.
- Legacy `pool` compatibility is therefore structural and narrow: it is honored only for ordinary reads or, in lifecycle code, for an already-open transaction connection. A broad runtime pool is ignored for lifecycle-writer selection and the dedicated Governance writer is used instead.
- An explicitly supplied `transactionPool` that is not an actual transaction connection fails closed with `CAPABILITY_ENVELOPE_LIFECYCLE_TRANSACTION_INVALID` and no secret-bearing details.
- Capability envelope creation performs authority/dry-run resolution with the runtime reader, then resolves the governance writer only at the canonical ledger `INSERT` boundary.
- Envelope approval and apply-authorization use a single Governance writer transaction for current-state read, mutation, conditional update, and same-cycle readback.
- Governed migration authorization resolves the capability envelope with the runtime reader, then performs authorization/policy/certification registry reads and writes with the Governance writer.
- Batch-expire dry-run remains read-only; batch-expire apply is a standalone governance mutation and stays on the Governance writer.

The execution transaction exception exists only to prevent a separate-principal post-commit lifecycle write from breaking an already-open execution transaction. It must not be used to bypass control-plane writer selection or to reinterpret `DB_USER`/`DB_PASSWORD` as Governance DB credentials.

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
| `governed_tool_response_chunks` | `SELECT, INSERT, UPDATE, DELETE` |

The `DELETE` above is a reviewed exception limited to expired-row cleanup on `governed_tool_response_chunks`; it does **not** authorize schema-wide `DELETE` or deletion on another table.

Do **not** grant `GRANT ALL`, schema-wide privileges, `DROP`, `ALTER`, `CREATE`, `FILE`, `PROCESS`, `SUPER`, account-management authority, `GRANT OPTION`, or equivalent administrative privileges unless a later separately reviewed contract proves a need. Do not grant an operation on an additional table merely because that table also participates in a runtime workflow; add it only after a source-level mutation inventory proves the need.

A Production administrator may translate the matrix into provider-specific SQL only after separate authorization. Credentials and generated passwords must never be committed, printed to logs, attached to artifacts, or returned through status endpoints.

## Governance DB privilege readiness

`governanceDbWriteReadiness.js` performs a bounded no-secret effective-authority probe before a workflow depends on governed persistence. It:

1. obtains the dedicated Governance writer connection;
2. reads `CURRENT_USER()` and `DATABASE()`;
3. reads `SHOW GRANTS FOR CURRENT_USER` only inside the process;
4. normalizes the effective grant statements into the reviewed table/operation matrix;
5. reports each missing required operation;
6. rejects broad, administrative, DDL, schema-wide, global, or otherwise unreviewed privileges; and
7. returns structured evidence with `raw_grants_included=false` and `secrets_included=false`.

The raw `SHOW GRANTS` strings are never returned by the readiness result. Any missing required privilege, prohibited broad privilege, missing Governance credential, or failed effective-grant probe yields the stable degraded classification:

```text
runtime_db_write_authority_degraded
```

This makes the original privilege regression observable before the first durable governance mutation rather than waiting for `ER_TABLEACCESS_DENIED_ERROR` in the middle of an execution workflow.

## Post-merge provisioning and readback

Source merge is only a prerequisite. Issue #6813 remains open until all of the following are performed through separately authorized Production governance:

1. Create a dedicated MariaDB Governance writer principal outside the application runtime.
2. Apply only the reviewed table/operation matrix above.
3. Configure `GOVERNANCE_DB_*` Production secrets without exposing values.
4. Promote the merged source through the normal `main -> Production` lifecycle and prove runtime parity.
5. Run the bounded no-secret Governance DB readiness probe and prove all required operations are present and prohibited broad privileges are absent.
6. Prove envelope create/approval, resource-authority binding persistence with runtime readback, and governed response-chunk persist/load/expiry operations without a Provider/GitHub mutation.
7. Re-read the governed migration ledger/state.
8. Obtain a **fresh** Migration 1050 readiness authorization; do not reuse the authorization consumed by run `31379417191`.

Migration Apply, live GitHub Ruleset apply, Production ref mutation, database grants, provider mutation, deployment/restart, and secret writes are independent governed operations and are not authorized by this source PR.

## Verification expectations

Repository CI must prove at minimum:

- runtime-only `DB_USER`/`DB_PASSWORD` cannot satisfy governance configuration;
- governance credential errors contain no secret values;
- canonical envelope creation writes through `writerPool` while repository authority reads remain on `readPool`;
- approval/apply-authorization and migration bootstrap select the dedicated writer by default;
- platform resource-authority binding creation writes through the Governance writer and is independently visible through the runtime reader;
- governed response-chunk schema/load reads remain on the read plane while persist/update/delete and immediate write verification use the Governance writer;
- a general runtime pool cannot become Governance mutation authority merely because a caller supplied it as `pool`;
- only an already-open SQL transaction connection may preserve envelope lifecycle/reference atomicity, and an invalid explicit `transactionPool` fails closed;
- migration bootstrap uses separate reader and writer pools;
- batch apply preserves Governance writer transaction and same-cycle readback semantics;
- readiness reports the complete reviewed privilege matrix, detects missing DML and broad/admin grants, and never returns raw grant statements or secrets;
- no provider call or external business write is introduced by this boundary.
