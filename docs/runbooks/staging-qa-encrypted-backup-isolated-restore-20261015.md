# Staging QA database backup → isolated restore safety

Tracking: [#8534](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/8534).

## Scope and release boundary

This first slice introduces a **read-only and fail-closed prerequisite inventory** and hardens the existing MariaDB isolated restore certifier. It is **not** a backup executor, a policy activation, a four-principal QA fixture authorizer, or a Production promotion authority.

Never update the existing owner, broaden `runtime_app` database grants, activate a policy without explicit owner evidence, or use the backup exporter against real Staging data until the executor and key custody have independent review.

## Read-only inventory

Run inside the certified Staging application, specifying the exact deployed source SHA:

```sh
node scripts/staging-backup-restore-readiness.mjs --expected-source-sha=<EXACT_STAGING_SOURCE_SHA>
```

The command must be run only where `DEPLOYMENT_ENVIRONMENT` identifies Staging. It selects an allowlisted policy `policy:staging-qa-db:approved` and never reads policy JSON, credentials, OAuth grants, user IDs or recovery keys. Exit code **2** intentionally means not authorized. A missing/permission-denied policy, inactive destination, absent approval or lack of verified backup/restore evidence must remain a release blocker. The existing exporter is independent and must not be invoked as a shortcut.

## Synthetic isolated restore proof

```sh
RUN_ISOLATED_RESTORE_INTEGRATION=1 node test-staging-synthetic-db-isolated-restore.mjs
```

Requires an already-installed `mariadb:11.4` Docker image. No pull or Production connection is allowed by the test. It generates a two-row synthetic SQL database, encrypts with AES-256-GCM, verifies SHA-256, restores into a disposable MariaDB container started with `--network none` and without exposed ports, then removes the container, plaintext and temporary keys. A tampered artifact is intentionally rejected before container startup. The test is opt-in; in CI without opt-in, its output is `not_run`, **not** a certified restore.

The certifier rejects unallowlisted images, unsafe database identifiers, mismatched artifact/key/manifest bindings, incorrect AES envelope lengths and unsupported encryption formats; success requires the exact table count and confirmed cleanup. Never attach the recovery key, encrypted artifact, URL containing access tokens, or raw SQL to issue comments.

## Independent approval still required

To open the fixture gate, the operational owner must supply approved, time-bounded evidence that:
1. The Staging DB policy is active and locally executed by `local_connector`, with a dedicated destination, approved authorization record and no shared Production endpoint.
2. A **fresh** encrypted backup was exported from the exact running Staging source, and its encrypted SHA-256 and source identity independently verified.
3. A qualified operator proved isolated restore of **that same backup**, including integrity, exact schema identity, confidential key handling and complete cleanup. The synthetic restore above is insufficient.
4. The approved fixture `plan → apply → verify → revoke → cleanup` supports four distinct subjects and two Tenants with specific ownership, expiry and rollback.
5. All 18 OA/MC cases pass live, restore/cleanup are confirmed with zero residue and the Production promotion authority is reviewed separately.

Until then, `qa_fixture_write_authorized=false` and `production_promotion_authorized=false` are intentional final states.
