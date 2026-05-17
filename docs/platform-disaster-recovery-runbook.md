# Platform Disaster Recovery Runbook

## Status

First full local recovery baseline completed on 2026-05-17.

Successful backups exist for:

```text
Code repo
Runtime MySQL database
Local n8n data
Local connector runtime
Runtime/platform manifests
```

Local destination:

```text
D:\\Nagy\\Growth-0s-Backups
```

## Artifacts

### Code

```text
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.zip
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.manifest.json
checksum_sha256 = 6c99cf7dccdbc8a2f78c9d2971c7056cadebe19a02f2f87e3ed32d0559bd110f
restore_status = passed
```

### Database

```text
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-db-primary-2026-05-17T18-10-17-164Z.sql.gz.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-db-primary-2026-05-17T18-10-17-164Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-db-primary-2026-05-17T18-10-17-164Z.recovery-key.json
checksum_sha256 = e7ac7a51a4d74d55e31954d55edf659c05ddadbacf73a0f66ea48f902f2f4756
restore_status = passed
plaintext_restore_sql_removed = true
```

### n8n local data

```text
source = D:\\n8n-data
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.zip.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.recovery-key.json
checksum_sha256 = cc3b4819a6c984d51a121446779d8110bedf15f43321deda9785676c5387fbb7
restore_status = passed
plaintext_validation_zip_removed = true
```

### Local connector runtime

```text
source = C:\\mad4b-connector
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-local-connector-2026-05-17T18-48-34-422Z.zip.aes256gcm
manifest = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-local-connector-2026-05-17T18-48-34-422Z.manifest.json
recovery_key = D:\\Nagy\\Growth-0s-Backups\\keys\\growth-os-local-connector-2026-05-17T18-48-34-422Z.recovery-key.json
checksum_sha256 = 1d3a0a41c77686ff77be358ea6097d1f44a6fb120a557633aa660e7c877747f2
restore_status = passed
```

## Manifests

```text
runtime-manifest-2026-05-17.json
dns-cloudflare-manifest-2026-05-17.json
backup-retention-policy-2026-05-17.json
backup-automation-plan-2026-05-17.json
off-device-transfer-plan-2026-05-17.json
```

## Restore order

1. Restore source code from GitHub or the code ZIP artifact.
2. Restore the local connector runtime or reinstall connector from the repo installer.
3. Restore the database into an isolated database first; validate table count and app health.
4. Restore n8n data into an isolated n8n instance first; validate workflows and credentials encryption key behavior.
5. Rebind runtime env variables through Hostinger/managed env, never from plaintext docs.
6. Verify `auth.mad4b.com` health.
7. Verify `connector.mad4b.com` health.
8. Verify n8n local status and workflows.
9. Run release readiness and GitHub Actions.
10. Only then move traffic or declare production recovered.

## Security requirements

```text
Never commit recovery keys.
Never upload plaintext SQL.
Never retain plaintext DB restore SQL after validation.
Never retain plaintext n8n ZIP after validation.
Protect D:\\Nagy\\Growth-0s-Backups\\keys with admin-only ACLs.
Copy recovery keys to a separate secure vault/off-device location.
```

## Retention policy

Default retention metadata:

```text
code: keep_last=7, keep_days=30
database: keep_last=14, keep_days=30
n8n_local: keep_last=14, keep_days=30
local_connector: keep_last=7, keep_days=30
```

Deletion rules:

```text
Dry-run before deletion is required.
Never delete the last restore-passed artifact of any backup kind.
Deletion requires explicit admin approval.
```

## Automation state

Automation is planned but intentionally not scheduled yet.

Reason:

```text
Off-device destination and key escrow are not finalized.
```

## Off-device status

Current status:

```text
pending_destination
```

Allowed payload:

```text
encrypted artifacts + manifests only
```

Do not upload recovery keys to the same destination unless access is split.

## Cloudflare / DNS status

Cloudflare export is complete for this baseline.

Persisted manifest:

```text
local_manifest_path = D:\\Nagy\\Growth-0s-Backups\\manifests\\cloudflare-dns-manifest-2026-05-17.json
drive_manifest_file_id = 1dF6cMcwh4Sy2ebVatGJqTYReBjfJbkbU
manifest_sha256 = 2db10b875123f964b40fc4dc7657cfb1c1bb1d2a4da26ceb0f6d2c6d744f1c93
```

Validated domains:

```text
auth.mad4b.com
connector.mad4b.com
```

## Runbooks

```text
docs/backup-run-2026-05-17-code-main.md
docs/backup-run-2026-05-17-db-primary.md
docs/backup-run-2026-05-17-n8n-local.md
```

## Final baseline conclusion

The platform has a verified local DR baseline. It is not yet off-device disaster-proof until encrypted artifacts and recovery keys are stored in separate secure locations.
