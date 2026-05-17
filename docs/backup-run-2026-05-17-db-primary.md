# Backup Run — 2026-05-17 — Primary Database

## Status

Actual encrypted database backup executed and verified.

This was a database backup only. The code backup is documented separately in `docs/backup-run-2026-05-17-code-main.md`.

## Policy

```text
policy_key = policy:platform-db-primary:manual-draft
run_mode = apply
status = succeeded
```

## Artifact

```text
artifact_ref = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-db-primary-2026-05-17T18-10-17-164Z.sql.gz.aes256gcm
manifest_ref = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-db-primary-2026-05-17T18-10-17-164Z.manifest.json
recovery_key_ref = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-db-primary-2026-05-17T18-10-17-164Z.recovery-key.json
artifact_format = sql_dump
encryption_scheme = aes-256-gcm
compression = gzip
checksum_algorithm = sha256
checksum_sha256 = e7ac7a51a4d74d55e31954d55edf659c05ddadbacf73a0f66ea48f902f2f4756
size_bytes = 4633945
```

## Source

```text
database_name = u338416126_growthOS
table_count = 155
row_count = 39515
```

Connection host and credentials are intentionally redacted and are not stored in the runbook.

## Method

The server-side exporter used the application DB connection to create a SQL dump, gzip it, encrypt it with AES-256-GCM, and create a manifest plus recovery-key file. Temporary download links were token-gated and time-limited. The final artifact, manifest, and recovery key were downloaded to the Essam local backup destination.

## Restore validation

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated\\growth-os-db-primary-2026-05-17T18-10-17-164Z
restore_status = passed
```

Validation checks:

```text
decrypt = passed
gunzip = passed
create_table_count = 155
insert_statement_count = 39561
sql_size_bytes = 63802376
plaintext_restore_sql_removed = true
```

Plaintext SQL was generated only for structural restore validation and removed immediately afterward. The durable backup artifact is encrypted.

## SQL records

Recorded in:

```text
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

Latest run:

```text
run_id = 32658583-521c-11f1-b256-614c56cd019b
status = succeeded
```

## Security notes

```text
No DB credentials are stored in this runbook.
No plaintext SQL remains in the restore-test folder.
The recovery key file is required to decrypt the artifact.
The recovery key should be protected and ideally copied to a separate secure location later.
```
