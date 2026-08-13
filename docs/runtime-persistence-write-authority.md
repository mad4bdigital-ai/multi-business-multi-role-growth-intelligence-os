# Runtime Persistence Write Authority

## Decision

The current repository architecture uses `DB_USER` through `http-generic-api/db.js#getPool()` as the shared ordinary runtime database identity. Window 3 therefore chooses **option A**: retain `DB_USER` as the runtime writer and add bounded table/operation contracts instead of introducing a one-table Runtime Persistence Writer credential.

This is intentionally distinct from the Governance DB writer. Governance/control-plane writes that require a dedicated governance identity remain under their existing governance contract and are not migrated back to `DB_USER` by this work.

### Explicit runtime executor boundary

The runtime persistence authority now requires callers to inject an explicit `runtimePersistencePool` with a callable `query` method. It no longer falls back implicitly to `pool`, `connection`, or `getPool()`. The server wiring obtains this pool only from the dedicated `RUNTIME_PERSISTENCE_DB_HOST`, `RUNTIME_PERSISTENCE_DB_NAME`, `RUNTIME_PERSISTENCE_DB_USER`, and `RUNTIME_PERSISTENCE_DB_PASSWORD` environment variables, with optional `RUNTIME_PERSISTENCE_DB_PORT`, `RUNTIME_PERSISTENCE_DB_CONNECTION_LIMIT`, and `RUNTIME_PERSISTENCE_DB_CONNECT_TIMEOUT_MS`. If the dedicated configuration is absent, the executor is `null` and governed response-chunk persistence fails closed with `RUNTIME_PERSISTENCE_POOL_REQUIRED` rather than writing through the default application pool.

This preserves the shared `DB_USER` identity contract when an explicitly configured runtime pool uses that identity, but it does not establish that the live account satisfies the bounded privilege matrix. Live table privileges, active grants, and runtime account parity remain separate readback requirements.

## Canonical current-main inventory

Run from `http-generic-api`:

```bash
node scripts/runtime-persistence-write-inventory.mjs
node scripts/runtime-persistence-write-inventory.mjs --markdown
```

The scanner walks runtime source files, selects direct `getPool()/db.js` bindings, records SQL mutation verbs/table tokens, resolves simple table constants, avoids double-counting `ON DUPLICATE KEY UPDATE`, and excludes tests/build outputs. It emits every detected surface with file, line, operation, table token, classification, and classification reason.

### Classification matrix

| Classification | Meaning | Typical examples | Window 3 treatment |
|---|---|---|---|
| ordinary business/runtime persistence | Application/runtime state written while serving normal platform behavior | governed response chunks, audit/log/runtime state, tenant/customer/session/connection/outbox persistence | first PR enforces the chunk lifecycle; remaining surfaces stay inventoried for bounded follow-up |
| governance/control-plane | Policy, authority, approval, grant, release/certification, registry/control state | authority/grant tools, repository governance, certification and admin control routes, registry adapters | inventory only unless directly coupled to chunk lifecycle |
| migration/DDL/admin | Schema/user/database lifecycle or explicit DDL/admin operations | governed migration runners, database table lifecycle, schema import/admin scripts, DDL/GRANT/REVOKE | inventory only; no migration lifecycle expansion in this PR |

`platformResourceAuthorityGrantTool.js` is intentionally visible in the inventory and classified as `governance/control-plane`, but Window 3 does not modify it because it belongs to Window 2.

## First bounded contract

| Table | Direct privileges required by the complete lifecycle |
|---|---|
| `governed_tool_response_chunks` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` |

Operation-specific readiness is narrower:

- persist / same-owner duplicate replacement: `SELECT + INSERT + UPDATE`
- durable read / post-write verification: `SELECT`
- sliding expiry extension: `UPDATE`
- expired-row cleanup: `DELETE`

The readiness evaluator rejects broad global/schema write privileges that could authorize the target table, extra target-table privileges, target column grants, grant option, and applicable roles. It deliberately ignores unrelated direct table grants because `DB_USER` is the shared runtime writer across other ordinary persistence surfaces.

## Preserved response chunk invariants

The authority layer does not replace application ownership checks. The chunk store still requires and tests:

- tenant/workspace/principal owner isolation;
- unauthorized reads return the same result as a missing chunk;
- unauthorized overwrite does not alter the existing row;
- exact-owner overwrite remains allowed;
- privileged compatibility overwrite is restricted to legacy ownerless rows;
- SHA-256 and UTF-8 byte-length verification before serving;
- secret-bearing response rejection;
- positive TTL and expired-row rejection;
- bounded schema readiness and privilege readiness caching;
- bounded expiry cleanup.

## Out-of-scope follow-up

The inventory demonstrates that `DB_USER` is used across many ordinary runtime write surfaces. Applying an exact privilege matrix to every table in one PR would cause scope explosion and would mix business, control-plane, and admin lifecycles. Follow-up work should consume the canonical inventory and group ordinary tables by cohesive lifecycle (for example outbox/delivery, session/runtime evidence, tenant/customer state, connector/OAuth state) before adding further bounded contracts.

No live Production SQL, `GRANT`, database-user creation, Hostinger secret mutation, deployment, or migration apply is authorized by this source slice.
