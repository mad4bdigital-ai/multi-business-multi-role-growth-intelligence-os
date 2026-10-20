# P2 — Staging Local Connector backup authority readback

Tracking: Issue #8534. Base main: 8b545fe5a2215dd6aba754d2e32afefe19f97cad.

## Implementation

The new stagingBackupLocalAuthorityAdapter.mjs is a library, NOT an HTTP
endpoint, privilege broker, credential store or CLI backup dispatcher.

1. Plan (read only): planLocalStagingBackup accepts a dedicated SELECT-only
   Staging DB handle, measured local identity, exact deployed SHA, owner approval
   ID and a reference to independent key custody. It reads one named database
   policy and one exact backup_apply approval and returns safe readiness facts.
2. Approve: no approval or policy activation is issued here. The governing
   owner must separately authorize policy activation and time-bound backup_apply.
3. Execute (NOT exposed/deployed): executeWithTrustedLocalConnector is a
   connector-only composition seam requiring explicit apply intent, a pinned
   owner key, Ed25519 owner-signed lease, approved run record, private ACL/ledger,
   key-store, trusted dump stream and signer. It rereads policy, approval and
   run state immediately before the encrypted P1 stream.
4. Verify: P1 validates ciphertext SHA-256 and signed artifact manifest. An
   actual isolated restore is separate work and is not attested here.

Exactly three fixed, parameterized SQL SELECT statements are used. No dynamic
SQL identifiers, cross-schema queries, password, raw credentials, SQL writes,
grants, repository mutation or Production writes. Missing SELECT grants, revoked
approval, policy mismatch and unprepared run all fail closed.

The injected identityProvider MUST obtain independent local connector runtime
evidence: real deployed source SHA, exact device, local staging-only DB endpoint,
approved source/destination keys and target path. It must NOT accept request
JSON or model-generated claims as this evidence. The read-only DB handle must
have separately provisioned least-privilege Staging credentials; never root.

This code is NOT ready to expose through a generic remote interface or execute
against a live database. Independently review local connector authentication,
approval/audit persistence, SQL DATETIME/timezone handling, encrypted custody
ACLs, consistent dump snapshot, ledger durability and real restore verification
before activation. The currently observed Staging source is older than main.

## Synthetic test

    node http-generic-api/test-staging-backup-local-authority-adapter.mjs

The regression tests source mismatches, SELECT-only parameterized reads, policy
and approval duplicates, revoked approval, expired or inactive authority,
permission failure, signed synthetic encrypted dump and one-time nonce replay.

## Operational acceptance remains blocked

- Certify a reviewed code cut deployed on the actual Staging Local Connector.
- Independently provision narrowly scoped Staging SELECT and dump credentials;
  never grant privileges implicitly.
- Validate private destination ACLs, trusted keys, signing authority and ledger.
- Obtain separate policy activation and exact time-bound backup_apply approval.
- Export a real encrypted Staging backup, then restore THE SAME artifact into
  an isolated disposable Docker target. Validate tables, rows, checksum and
  plaintext cleanup before issuing a restore attestation.
- Only then consider QA identities and the 18 OA/MC live cases with independent
  authorization.

production_mutation=false; qa_fixture_write_authorized=false;
restore_attested=false for this phase. Keep Issue #8534 open.
