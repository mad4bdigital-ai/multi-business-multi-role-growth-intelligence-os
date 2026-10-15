# P1 — Governed Staging backup executor core (Issue #8534)

## What is implemented

A staged **local-connector core**, not a deployed backup service. `http-generic-api/stagingGovernedEncryptedBackup.mjs` requires all of the following before it writes anything:

- Exact `staging_local_windows_docker` identity, verified local connector and source SHA.
- The named QA database policy `policy:staging-qa-db:approved`, active and explicitly bound to a Staging database and an active local destination.
- A separate approved, unexpired `backup_apply` decision for the same policy, plus an owner-signed Ed25519 lease matching the run, policy ID, source SHA/endpoint, device, destination path, key-custody reference and short expiry. The owner public key must come from the trusted connector, never request-controlled input. Apply-mode uses its own clock rather than a caller-supplied timestamp.
- Independently provided key custody reference (`local-custody:...`) and an exact destination path. Neither the artifact nor manifest contains the AES-256 key. A separate private, durable replay ledger is required: an exclusive, synced nonce record is created **before** opening the database dump; even failed runs consume their signed run ID.
- A trusted streaming dump adapter and trusted database table/row census, supplied by the authorized local connector rather than a production-facing app endpoint.
- A separate Ed25519 signing adapter. The manifest signature is checked before the ciphertext artifact is finalized.

Only ciphertext is written to disk; streamed plaintext is compressed and encrypted in memory. Files are created exclusively with private permissions. SHA-256 is checked by reading the artifact back; a failed stream or signature removes the temporary directory. The result explicitly reports `artifact_created_restore_not_attested`. It **never** authorizes QA fixture writes or Production promotion.

## Security boundary

This release does not activate the database policy, issue owner approvals, install Staging read grants, or run the local connector against a live database. It does not modify the old `db-backup-exporter.mjs` because that exporter is a separate legacy route with temporary plaintext files and adjacent key material; it is **not** an authorized substitute for this governed path. The existing `backup-executor-guard.mjs --action=execute --apply` remains intentionally blocked until an independently reviewed, locally authenticated adapter binds its authority, key custody and source stream.

The code has NO HTTP endpoint and NO arbitrary command or SQL execution. Its dependency-injected adapters must not be treated as a self-authenticating remote interface: `verify_authority_snapshot` must independently re-read the latest revocation/approval and source identity (the test fixture alone returns true), and both the trusted owner key and private ledger root must be provisioned by a separately reviewed local connector. The replay ledger must survive process crashes/restarts; operators must never clear or rotate consumed nonces simply to retry. Production and Staging runtime DBs are unchanged by source-level tests.

## Local synthetic verification

```sh
node http-generic-api/test-staging-governed-encrypted-backup-executor.mjs
node http-generic-api/test-staging-backup-restore-authority.mjs
node http-generic-api/test-isolated-db-restore-safety.mjs
```

The new regression verifies Ed25519 lease and manifest, AES-256-GCM/GZIP encrypt/decrypt, artifact SHA-256, no cleartext SQL files, tamper rejection, forged/revoked/expired owner authority, source and destination mismatches, strict Production denial, streaming failure and cleanup.

## Required to close P1 operationally (NOT delivered here)

1. Build and independently review the authenticated `local_connector` database reader, source identity and consistent dump census. Use dedicated least-privileged Staging-only credentials, never MariaDB root or shared Production access.
2. Add governed API lifecycle `plan → approve → dispatch → execute → verify` with durable nonce/replay ledger, destination storage controls, key custody and approval revocation readback. Do not widen `runtime_app` privileges.
3. Obtain separate owner policy-activation and per-run approval through the governed platform API, not by direct SQL or a chat message alone.
4. Produce a new encrypted backup from *real* Staging, then independently attest restoring that same encrypted artifact into a disposable Docker network-none target. Check schema, row integrity, source SHA, expiry, cleanup and verified rollback.
5. Keep Issue #8534 open; do not create QA identities or start OA/MC 18-case live acceptance until separate fixture authority is approved and rollback rehearsed.

`qa_fixture_write_authorized=false`; `production_promotion_authorized=false`; `production_mutation=false`.
