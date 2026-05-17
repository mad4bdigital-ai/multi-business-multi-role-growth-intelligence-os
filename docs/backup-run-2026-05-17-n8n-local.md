# Backup Run — 2026-05-17 — Local n8n Data

## Status

Actual encrypted local n8n backup executed and verified.

This backup covers the local n8n user data path on the Essam device.

## Policy

```text
policy_key = policy:local-n8n-data:manual
run_mode = apply
status = succeeded
```

## Source

```text
source_path = D:\\n8n-data
source_size_bytes = 59087745
file_count = 851
```

Important markers detected:

```text
D:\\n8n-data\\.n8n\\database.sqlite = true
D:\\n8n-data\\.n8n\\database.sqlite-wal = true
D:\\n8n-data\\.n8n\\config = true
D:\\n8n-data\\.n8n\\nodes = true
D:\\n8n-data\\.n8n\\storage = true
```

## Artifact

```text
artifact_ref = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.zip.aes256gcm
manifest_ref = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.manifest.json
recovery_key_ref = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.recovery-key.json
artifact_format = zip
encryption_scheme = aes-256-gcm
checksum_algorithm = sha256
checksum_sha256 = cc3b4819a6c984d51a121446779d8110bedf15f43321deda9785676c5387fbb7
artifact_size_bytes = 13098316
```

## Method

The local path was compressed into a temporary ZIP, encrypted with AES-256-GCM, and the temporary plaintext ZIP was removed after encryption. The durable artifact is encrypted.

## Restore validation

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\n8n-local\\growth-os-n8n-local-2026-05-17T18-25-41-880Z
restore_status = passed
```

Validation checks:

```text
decrypt = passed
zip_structure_check = passed
has_n8n_root = true
has_database_sqlite = true
has_config = true
has_nodes_dir = true
plaintext_validation_zip_removed = true
```

The decrypted ZIP was created only for structure validation and removed immediately afterward. No plaintext n8n backup is retained.

## SQL records

Recorded in:

```text
platform_copy_locations
platform_backup_policies
platform_backup_approvals
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

Latest run:

```text
run_id = 928af7d1-521e-11f1-b256-614c56cd019b
status = succeeded
```

## Security notes

```text
The n8n config and database may contain encrypted credentials and encryption metadata.
The recovery key file is required to decrypt the artifact.
The recovery key should be protected and ideally copied to a separate secure location later.
No plaintext ZIP remains after validation.
```
