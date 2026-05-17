# Backup Run — 2026-05-17 — Code Main

## Status

Actual code backup executed and verified.

This was a code backup only. No database dump was created.

## Policy

```text
policy_key = policy:platform-code-main:snapshot-draft
run_mode = apply
status = succeeded
```

## Artifact

```text
artifact_ref = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.zip
manifest_ref = D:\\Nagy\\Growth-0s-Backups\\manifests\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.manifest.json
artifact_format = zip
encryption_scheme = none
checksum_algorithm = sha256
checksum_sha256 = 6c99cf7dccdbc8a2f78c9d2971c7056cadebe19a02f2f87e3ed32d0559bd110f
size_bytes = 1907954
file_count = 555
```

## Source

```text
source_path = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
source_branch = main
source_commit = 85ea6e4f7894e72e5c35558ceaac13d3f2476932
```

## Method

The backup was created from tracked Git files only using `git archive` with a per-command `safe.directory` override. This avoids copying untracked local files such as `.env`.

Tracked secret-like files were checked before archive creation. The run allowed source code and `.env.example` templates, and blocked real `.env`, private key, and service-account style files.

## Restore test

```text
restore_target = D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout\\growth-os-code-main-85ea6e4f7894-20260517T174320Z
restore_status = passed
```

Validated markers:

```text
package.json = true
http-generic-api = true
local-connector = true
```

## SQL records

Recorded in:

```text
platform_backup_runs
platform_backup_artifact_manifests
platform_restore_tests
```

Latest run:

```text
run_id = fa521736-5217-11f1-b256-614c56cd019b
status = succeeded
```

## Not included

```text
No DB dump
No plaintext .env
No provider credentials
No OAuth refresh tokens
No service account JSON
No untracked local files
```

## Follow-up

The database backup policy remains blocked until a reviewed local/hosted DB executor is implemented with encryption, checksum, manifest, and restore-test flow.
