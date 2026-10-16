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

## Broker session lifecycle composition (follow-up)

`runWithIndependentStagingBackupBroker` in the provider module now exposes
an intentionally **injected-only** composition step; it does not register a
network endpoint, CLI runner, app route, Windows service or database identity.

The orchestration verifies the short-lived Ed25519 owner-operation approval and
exact source-bound grant plan **before opening** any privileged session. The
independently installed broker must implement `openOneShotSession({capability_key,
plan,approval})`, separately verify the signature using independently pinned
trust, measure the Docker identity, enforce one-time replay reservation and open
a dedicated MariaDB administrative session from independent OS secret custody.

The returned session must have an observed `query()`, mandatory `close()`,
and a broker-issued authority tuple including exact `run_id`, `plan_sha256`,
source SHA, device, capability and an unexpired maximum-ten-minute ticket.
The app-side code checks these fields but **cannot authenticate a broker from
caller-supplied JSON**; only an isolated trusted issuer can establish that.
Both the lifecycle and broker must retain append-only audit and durable replay
records. Even a successful grant/census/revocation result fails closed if the
administrative session fails to close.

Synthetic regression tests cover the successful composition, invalid signed
approval before session issuance, wrong plan/run/source, issued-in-future or
expired tickets, a non-single-use ticket, absent broker and failed close. None
of those tests proves that a real broker, DBA account, secret store, independent
owner-operation signing key or approved runtime binding exists.

## Independent Staging broker core (next implementation)

The source-owned Local Connector **broker core** now exists in:
- `local-connector/staging-backup-db-admin-broker.mjs`;
- `local-connector/staging-backup-db-broker-file-state.mjs`.

It composes with `runWithIndependentStagingBackupBroker` **in the same
independently isolated process**, not through the public API. The core verifies
the independently pinned Ed25519 owner **operation** signature and exact
source/device/network-bound plan before opening a dedicated administrative
client. An **independent measured-identity provider** is mandatory. The broker
requires a private atomic one-shot reservation, restricted append-only audit,
a separately injected `backup_grant_service` MariaDB admin-client factory
with independently attested **actual runtime-db host, port, network, schema,
source SHA and device identity**, and an explicit isolated Staging process
attestation. Checking only `CURRENT_USER()`/`DATABASE()` is insufficient to
distinguish an identically named Production database. No default client exists.

Broker session SQL is restricted to the fixed staging schema, temporary reader
account, table inventory, four fixed table-level SELECT grants, SHOW GRANTS and
DROP USER. The independently observed MariaDB principal must be
`backup_grant_service`, never root, runtime_app or the Control Plane writer.
The broker retries exact reader cleanup on interrupted operations and verifies
the principal's absence at session closure. Failed cleanup, failed closure or
missing audit **blocks** successful readback; the broker never promotes itself
to a provider or a Production authority.

The private file-state adapter requires **two existing, distinct, private,
non-symlink, absolute Staging directories**, validates POSIX permissions, and
requires an independent Windows ACL verifier on Windows. It uses exclusive
`wx` files with fsync for atomic run-id replay denial that survives process
restarts, and redacted fsynced NDJSON audit events with no SQL or passwords.
This is a filesystem-backed audit ledger, **not** an independently notarized
tamper-proof evidence store; protect it using OS access controls and export
evidence to a trusted immutable audit sink before live certification.

### Explicitly not activated by this source change

- **No Windows service installation, Docker container, route, CLI execution
  alias, remote SQL endpoint or Staging broker binding** is created.
- No DB admin principal or privileged grants are created; the
  `adminClientFactory` and OS trust roots are **injected**, not fabricated.
- No owner Ed25519 operation key is generated. The prior GitHub source-head
  `OWNER_ATTEST_SINGLE_OWNER` cannot replace a fresh, single-use signed
  database operation plan.
- No MariaDB live census, encrypted backup, isolated restore, QA fixture
  creation or Production mutation is performed by tests or deployment.
- Merely setting `isolatedStagingProcessAttested=true` in application code is
  **not proof of OS isolation**. The executable and permissions need
  independent host-operator verification before enabling a live client.

### Remaining deployment acceptance

1. Install and independently attest the OS-isolated Staging-only broker
   process and device identity; separately custody the dedicated DBA secret,
   owner trust key, ledger and audit paths with verified Windows ACLs.
2. Independently authorize a short-lived, exact plan-bound owner operation,
   then execute the **one-shot** provision / four SELECT grants / policy census /
   DROP / absence-readback through the dedicated broker only.
3. Collect sealed operational evidence, obtain separate real Backup and
   isolated-Restore approvals, and certify the 18 OA/MC live cases. Do not
   publish Production until all relevant gates pass.

New read-only/synthetic contract tests:

```sh
node local-connector/test-staging-backup-db-admin-broker.mjs
node local-connector/test-staging-backup-db-broker-file-state.mjs
```

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
