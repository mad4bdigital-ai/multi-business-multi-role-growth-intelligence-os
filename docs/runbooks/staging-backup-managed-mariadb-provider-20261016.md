# Staging Backup managed MariaDB provider — implementation and binding acceptance

Tracks Issue #8534. Base: merged main `d1b544d7552f852a713b93274c14828093d240da`.

## Implementation added

`http-generic-api/stagingBackupManagedMariaDbProvider.mjs` defines the actual
**fixed-query MariaDB adapter** for the already merged
`runGovernedStagingBackupReaderCensus` orchestration. It is **not registered
as an HTTP route, CLI command, arbitrary SQL interface, plugin action or
executable through remote Desktop Commander**.

The factory requires an injected, **independently trusted administrative session**
with a broker-issued authorization attestation pinned to:

- Capability: `staging.backup.reader.provision-census-revoke`.
- `staging_local_windows_docker`, exact source SHA and device identity.
- `runtime-db`, `growth_runtime`, `http-generic-api_default`.
- `independent_owner_signature_verified=true`, `no_production_mutation=true`,
  `redacts_query_parameters=true` and `single_use_ephemeral_session=true`.

This is one defense; the upstream orchestration also independently validates
Ed25519 owner approval, signed plan SHA, replay ledger and append-only audit.
Do not treat caller-provided JSON or ChatGPT messages as broker attestation.

### Exactly allowed SQL operations

The private factory issues ONLY:

1. `SELECT DATABASE(), CURRENT_USER()` and rejects unexpected schema and
   privileged admin identities including `root`, `runtime_app` and
   `control_plane_writer`.
2. `SELECT` against `information_schema.TABLES` to verify four fixed
   Backup registry tables, plus scoped `mysql.user` presence checks.
3. `CREATE USER 'backup_policy_reader'@'172.18.%' IDENTIFIED BY ?`,
   with an ephemeral 48-byte random password, never logged or returned.
4. Exactly four `GRANT SELECT ON growth_runtime.<fixed_table>` statements.
   The caller cannot select principals, tables, hosts, privileges or SQL text.
5. `SHOW GRANTS FOR` the exact temporary principal.
6. A separate one-connection `mysql2` reader using the temporary credential,
   verifying its `DATABASE()`, `CURRENT_USER()`, and effective four-table
   grants, then a fixed query for the Staging QA backup policy key with `LIMIT 2`.
7. `DROP USER IF EXISTS` the exact principal and independent absence readback.

The upstream lifecycle verifies cleanup even after a partial CREATE/GRANT error
and cannot mark census verified if cleanup, audit or policy readback fail.
The temporary credential is held in an in-memory private map only within the
isolated provider process, then dropped after revoke attempt. It is never
passed to the long-running web app, GitHub, stdout, debug logs or generic
device-command invocation.

## Provider separation: what is NOT implemented or approved

This PR **does not mint the owner operation signature**, create a DB-admin
principal, connect a live privileged MariaDB session, bind or enable an
independent broker, install an operating-system secret vault, expose a remote
DB admin action, or authorize Backup/Restore.

An independent security-reviewed **Staging-local managed DB broker** must first
be supplied by the host operator. It needs:

- Real identity and Docker network attestation not derived from caller fields.
- A dedicated admin account with only the privileges necessary for the exact
  four-table reader lifecycle (not `root`, `runtime_app` or a Production writer).
- A purpose-limited session, with a strictly enforced single-use owner
  authorization, short TTL, SQL allowlist and redacted bound parameter logging.
- OS-level isolation from the long-running app, separate credential custody,
  transactional audit/outcome recording, error incident escalation and cleanup.
- Real operation authorization from an independently held signing key.
  GitHub `OWNER_ATTEST_SINGLE_OWNER` for a source SHA is not the same as the
  new short-lived Ed25519 operation signature.
- A separately permitted deployment/binding channel. A previously blocked
  generic remote command cannot be relabeled as a provider operation.

**Operational acceptance still requires independent proof of**: approved
broker identity and scope, signed plan, live four table SELECT grants, physical
policy count, absence of the reader login after execution and sealed logs.
Only after that may the independently authorized real encrypted backup and
same-artifact isolated restore take place, before the OA/MC 18-case acceptance.
Production must remain unchanged.

## Verification

```sh
cd http-generic-api
node test-staging-backup-managed-mariadb-provider.mjs
node test-staging-backup-reader-grant-lifecycle.mjs
node test-staging-backup-independent-policy-reader.mjs
node test-staging-backup-restore-authority.mjs
node test-staging-backup-local-authority-adapter.mjs
node test-staging-governed-encrypted-backup-executor.mjs
```

The added test injects a synthetic managed DB session and synthetic SELECT-only
reader driver, proves exact SQL and denial cases, and checks revocation after
partial CREATE and GRANT failure. It does **not** connect to live MariaDB.
