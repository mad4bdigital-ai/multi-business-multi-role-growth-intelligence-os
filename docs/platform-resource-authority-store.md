# Platform Resource Authority Store

`platform_resource_authority_bindings` is a **Governance DB-owned** table. It must not be read or written through the ordinary Runtime DB pool.

## Database ownership

The application uses two independent MySQL identities and databases on Hostinger Web/Cloud:

| Data class | Database variables | Allowed responsibility |
|---|---|---|
| Runtime | `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Business data, runtime registries, memberships, provider metadata, ledgers, and evidence tables |
| Governance | `GOVERNANCE_DB_HOST`, `GOVERNANCE_DB_NAME`, `GOVERNANCE_DB_USER`, `GOVERNANCE_DB_PASSWORD` | `platform_resource_authority_bindings` authority state and its read/write/readback operations |

`governanceDb.js` requires a dedicated Governance identity and rejects a Governance user equal to `DB_USER`. When the Governance configuration is absent or invalid, `getGovernancePool()` fails closed; the application does not fall back to `getPool()`.

## Code contract

`platformResourceAuthorityStore.js` is the shared executor contract. Production callers resolve the store through `resolvePlatformResourceAuthorityPool()`. Tests may inject `authorityStorePool` or `governancePool` explicitly. A generic `pool` argument is not accepted as a Governance executor, and `assertPlatformResourceAuthorityStoreSource()` rejects the same object being used as both Runtime and Governance executor.

All binding CRUD, target-authority resolution, capability dry-run binding reads, repository governance reads/writes/readbacks, resource-recipe authority checks, release-readiness binding counts, and authority evidence reads use the Governance store. Queries that join Runtime-owned provider metadata are split into a Governance binding read followed by a Runtime provider validation query; no cross-database SQL join is assumed.

The capability-assurance reconciliation path reads authority rows from the Governance DB and writes redacted evidence rows to the Runtime DB transaction. It does not attempt to join or mutate the Governance table from the Runtime transaction.

## Operational prerequisites

This change is code-only. It does not create a Hostinger database or user, change environment variables, run a migration/backfill, redeploy the service, or claim live privilege readiness. Before runtime enablement, an operator must create the separate Governance database and user, provision the `platform_resource_authority_bindings` schema there, set the `GOVERNANCE_DB_*` variables, rebuild/redeploy the service, and perform a real SQL readback of the Governance identity and table privileges. Any missing or failed prerequisite remains fail-closed.

## Safety boundary

No secrets are returned by the Authority Store contract. No provider write, database migration, deployment, or Cloudflare mutation is performed by this patch.
