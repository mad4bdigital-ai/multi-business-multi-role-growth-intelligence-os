# Staging Backup reader lifecycle — governed provisioning interface

Tracking: [Issue #8534](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/8534).

## Why this exists

The deployed, read-only `stagingBackupPolicyReader.mjs` can perform a four-table
census only after a dedicated database principal has been provisioned. Earlier
attempts to run direct `CREATE USER / GRANT` against live Staging through a
generic remote device command were blocked by the execution safety gate.
**Do not repackage that command to bypass the gate**. The goal of this
increment is to define an auditable, purpose-specific trusted local admin
interface, with no such operation exposed to regular API callers.

## Implemented in source

`stagingBackupReaderGrantLifecycle.mjs` exposes:
- `planStagingBackupReaderGrant`: deterministic, nonsecret exact-operation plan
  pinned to the certified Staging SHA, Local Connector device, `runtime-db`,
  `growth_runtime`, `http-generic-api_default`, `172.18.0.0/16`, the exact
  `backup_policy_reader@172.18.%` identity, four fixed table-level SELECT
  grants and mandatory cleanup. It has no SQL write capability.
- `verifySignedReaderGrantApproval`: validates an independent Ed25519
  owner authorization with `OWNER_ATTEST_SINGLE_OWNER`, exact plan digest,
  SHA, device and run ID. A signed grant lease can last at most ten minutes.
  A chat confirmation is **not** a cryptographic key, and a copied GitHub
  comment alone is **not** an approved admin-execution token.
- `runGovernedStagingBackupReaderCensus`: a strict *local composition seam*
  requiring injected measured Staging identity, approved owner signature,
  externally trusted DB administration/reader adapters, a durable atomic
  single-use run-ID ledger, and append-only audit.
  It rejects preexisting reader identities or absent tables, verifies the
  effective four-table SELECT grant set, performs a reader-only census,
  and always attempts revocation and identity-absence readback after any
  partial create. A failed cleanup, audit append, reader grant verification
  or SQL census **cannot** produce a positive certificate.

No direct connection to MariaDB root, secrets file, HTTP route, root shell,
generic SQL execution endpoint, Production resource, or provider grant surface
is included. No credentials or account names from live providers are printed.
Reports never authorize a real database export, restore, QA fixtures or
Production promotion.

## The remaining integration boundary

This source component **does not create a live DBA channel by itself**. A
separately reviewed, explicitly permitted Staging Local Connector provider
must supply the following isolated operations:

1. `measuredIdentity()` independently reads actual device, Docker network,
   active exact image SHA and private runtime-db schema identity, rather than
   trusting caller-provided JSON.
2. `admin.inspect(binding)` checks actual presence of the four fixed tables,
   checks the exact account is absent and confirms no Production endpoint.
3. `admin.provisionTemporaryReader(binding)` generates the ephemeral
   credential internally, creates only the exact account and four table-level
   SELECT grants, and returns an opaque lease. No secret may enter ChatGPT,
   logs, the long-running app environment, PR/issue comments or the repo.
4. `admin.readReaderGrants(binding)` gets `SHOW GRANTS` for the exact account
   via an administrator-controlled session; the code rejects any additional
   or schema-level permissions.
5. `reader.census({lease,...})` runs the fixed SELECT-only backup policy
   inventory with the independent principal and returns only the verified
   count and read status, with no rows/credentials.
6. `admin.revokeTemporaryReader(binding)` and `admin.readerAbsent(binding)`
   remove the exact short-lived login and verify its absence even if creation
   or the read failed. A cleanup failure must create an operator incident.
7. `ledger.consumeOnce(runId,planSha)` must atomically persist a nonce
   **before** any account creation; it may never be cleared to allow a retry.
   `audit.append` must independently persist the plan attempt/outcome.

Connector provider authority must be bound to the Staging database only,
and must not expose raw `execute_sql`, SSH, arbitrary command, user-controlled
account names, arbitrary schemas or dynamic table identifiers. The provider
must implement permissions that the execution host actually enforces.
Approval and provider binding review must happen **before** connecting any
real DBA credentials. The previous tool safety block remains in effect.

## Test and acceptance

Run from `http-generic-api`:

```sh
node test-staging-backup-reader-grant-lifecycle.mjs
node test-staging-backup-independent-policy-reader.mjs
node test-staging-backup-restore-authority.mjs
node test-staging-backup-local-authority-adapter.mjs
node test-staging-governed-encrypted-backup-executor.mjs
```

All tests are synthetic. A successful test is not a real Staging grant or
backup certification. The operational checklist remains: provision the
dedicated provider with separate approval, conduct the live one-shot census
and verify principal revocation, then independently approve policy activation,
`backup_apply`, encryption key custody, real backup and same-artifact isolated
restore before the 18 OA/MC live scenarios.

Production mutation is **never** part of this contract.
