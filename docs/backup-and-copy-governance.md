# Platform Backup & Copy Governance

## Purpose

The platform has three administrative copy/control surfaces:

```text
repo branch        = code authority
hostinger runtime  = live runtime/deployment surface
local device path  = device working/recovery surface
```

A copy location is not automatically a backup. A backup is official only when it has an approved policy, checksum, retention, access controls, and a restore test record.

## Current scope

This document defines governance and registry records only. It does not authorize or execute any backup.

## SQL authority

Migration:

```text
http-generic-api/migrations/080_sprint61_backup_copy_governance.sql
```

Tables:

```text
platform_copy_locations
platform_backup_policies
platform_backup_runs
platform_restore_tests
```

## Copy location types

| Type | Meaning | Backup status |
|---|---|---|
| `repo_branch` | GitHub branch/tag/ref. Source of truth for code/docs/migrations. | Not a DB backup. |
| `hostinger_runtime` | Deployed runtime host. | Not source of truth for code. May be source for runtime manifests/logs. |
| `local_device_path` | Device working path or connector runtime path. | Not certified backup until validated under a backup policy. |
| `drive_folder` | Drive archive/export folder. | Archive location, not necessarily full backup. |
| `database` | SQL database source/destination. | High-risk; requires approval and restore test. |
| `object_storage` | Encrypted backup object store. | Candidate destination. |

## Seeded locations

```text
repo:main:growth-intelligence-os
provider = github
path_or_ref = mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os
is_source_of_truth = true
risk_level = high
```

```text
hostinger:auth.mad4b.com:runtime
provider = hostinger
path_or_ref = auth.mad4b.com/nodejs
risk_level = critical
status = pending_validation
```

```text
local:Essam:growth-intelligence-os
provider = local_connector
path_or_ref = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
owner_scope = platform
risk_level = high
notes = platform/admin local working copy; not tenant-accessible and not a certified backup
```

```text
local:Essam:local-connector
provider = local_connector
path_or_ref = C:\\mad4b-connector
owner_scope = device
risk_level = medium
notes = device connector runtime path; bounded tenant/user operations only when ownership rules allow
```

```text
local:Essam:growth-os-backups
provider = local_connector
path_or_ref = D:\\Nagy\\Growth-0s-Backups
owner_scope = platform
risk_level = critical
status = active
notes = local encrypted backup destination on Essam device; no backup exists until an approved apply run succeeds
```

```text
local:Essam:growth-os-backups
provider = local_connector
path_or_ref = D:\\Nagy\\Growth-0s-Backups
owner_scope = platform
risk_level = critical
status = active
notes = local encrypted backup destination on Essam device; no backup exists until an approved apply run succeeds
```

## Admin governance helper

Server-side helper:

```text
http-generic-api/scripts/backup-copy-governance-helper.mjs
```

Governed `admin_control` aliases:

```text
backup_copy_governance_helper_dry_run
backup_copy_governance_helper_apply
```

Supported actions:

```text
list-locations
register-location
list-policies
draft-policy
record-dry-run
```

These helpers record governance metadata only. They do not copy files, dump databases, upload artifacts, or schedule backup jobs.

Example list:

```json
{
  "tool": "shell",
  "action": "run",
  "alias": "backup_copy_governance_helper_dry_run",
  "extra_args": ["--action=list-locations"]
}
```

The dry-run alias rejects `--apply`; the apply alias rejects `--dry-run`.

## Draft policy templates

Current draft templates:

```text
policy:platform-db-primary:manual-draft
source = database:mysql:auth-runtime-primary
destination = local:Essam:growth-os-backups
backup_kind = database
status = draft
allowed_executor = none
retention_days = 7
encryption_required = true
checksum_required = true
approval_required = true
restore_test_required = true
```

```text
policy:platform-code-main:snapshot-draft
source = repo:main:growth-intelligence-os
destination = local:Essam:growth-os-backups
backup_kind = code
status = draft
allowed_executor = github_actions
retention_days = 30
encryption_required = false
checksum_required = true
approval_required = true
restore_test_required = true
```

Current dry-run governance records:

```text
policy:platform-db-primary:manual-draft -> dry_run/planned
policy:platform-code-main:snapshot-draft -> dry_run/planned
```

These records prove policy planning only. They do not represent executed backups.

## Backup policy requirements

A backup policy must define:

```text
source_location_id
destination_location_id
backup_kind
mode
retention_days
encryption_required
checksum_required
approval_required
restore_test_required
allowed_executor
forbidden_content_json
```

A policy starts as `draft`. It cannot be treated as active until approved.

## Forbidden by default

Do not back up these into repo branches or plaintext local folders:

```text
plaintext .env files
provider credentials
OAuth refresh tokens
API keys
service account JSON
unencrypted DB dumps
user private data exports
large generated node_modules/cache directories
```

## Artifact contract and preflight

Every future apply-mode backup must define and pass a preflight contract before execution.

Policy contract fields:

```text
artifact_format
encryption_scheme
checksum_algorithm
manifest_schema_version
preflight_required
```

Current contracts:

```text
policy:platform-db-primary:manual-draft
artifact_format = sql_dump
encryption_scheme = platform_managed
checksum_algorithm = sha256
manifest_schema_version = backup-manifest/v1
preflight_status = blocked
blockers = policy_not_active, approval_not_granted, executor_not_enabled
```

```text
policy:platform-code-main:snapshot-draft
artifact_format = zip
encryption_scheme = zip_aes256
checksum_algorithm = sha256
manifest_schema_version = backup-manifest/v1
preflight_status = blocked
blockers = policy_not_active, approval_not_granted
```

Manifest records, when an actual artifact exists, are stored in:

```text
platform_backup_artifact_manifests
```

Preflight helper action:

```text
preflight-policy
```

Preflight is a gate. It never creates a backup artifact.

## Local destination layout

The Essam local destination is prepared with governance folders only:

```text
D:\\Nagy\\Growth-0s-Backups\\artifacts
D:\\Nagy\\Growth-0s-Backups\\manifests
D:\\Nagy\\Growth-0s-Backups\\restore-tests
D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated
D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout
D:\\Nagy\\Growth-0s-Backups\\logs
D:\\Nagy\\Growth-0s-Backups\\.growth-os-backup-destination.json
```

Reusable helper:

```text
http-generic-api/scripts/local-backup-destination-prepare.mjs
```

This helper creates or validates folders and writes a destination marker only. It does not create backup artifacts.

## Executor guard

Server-side guard:

```text
http-generic-api/scripts/backup-executor-guard.mjs
```

Governed `admin_control` aliases:

```text
backup_executor_guard_dry_run
backup_executor_guard_apply
```

Actions:

```text
plan-run
prepare-run-record
execute
```

The executor guard evaluates whether a policy is allowed to execute. It can produce a plan and record metadata, but it does not implement backup artifact creation. Apply-mode `execute` remains blocked until a reviewed executor implementation is added.

Current expected blockers:

```text
policy:platform-db-primary:manual-draft -> policy_not_active, activation_gate_not_ready, preflight_not_promoted_to_active, approval_not_granted, executor_not_enabled, database_executor_must_be_local_connector_or_explicitly_changed
policy:platform-code-main:snapshot-draft -> policy_not_active, activation_gate_not_ready, preflight_not_promoted_to_active, approval_not_granted
```

## Mandatory run lifecycle

Every official backup run must be recorded in `platform_backup_runs`:

```text
run_mode = dry_run | apply
status = planned | running | succeeded | failed | cancelled | verification_failed
source_snapshot_ref
destination_ref
checksum_sha256
size_bytes
manifest_json
initiated_by
verified_by
```

No run should be marked `succeeded` unless checksum and manifest requirements pass.

## Restore test requirement

Every official backup policy that says `restore_test_required=true` must have a `platform_restore_tests` row proving the backup can be restored.

Minimum restore test evidence:

```text
restore_target
validated_commit_sha, when code backup
validated_tables_count, when DB backup
validated_healthcheck_json, when runtime restore
validated_checksum_sha256
status = passed | failed
```

## Approval and restore-test gates

Current approval requests:

```text
policy:platform-db-primary:manual-draft -> policy_activation/requested
policy:platform-code-main:snapshot-draft -> policy_activation/requested
```

Current planned restore-test records:

```text
policy:platform-db-primary:manual-draft -> D:\\Nagy\\Growth-0s-Backups\\restore-tests\\db-isolated
policy:platform-code-main:snapshot-draft -> D:\\Nagy\\Growth-0s-Backups\\restore-tests\\code-clean-checkout
```

These are only approval requests and planned restore targets. They do not approve or execute a backup.

Helper actions:

```text
list-approvals
list-restore-tests
decide-approval
evaluate-activation-gate
activate-policy
```

Approval guardrails:

```text
decide-approval --decision=approved requires --decision-token=APPROVE:<policy_key>
activate-policy requires --activation-token=ACTIVATE:<policy_key>
activation requires activation_gate_status=ready
```

These actions decide or activate policy metadata only. They do not execute backup artifacts.

## Approval boundary

No backup apply-mode operation should run until:

1. Source and destination copy locations are registered.
2. Backup policy is created and approved.
3. Dry-run is recorded.
4. Forbidden content rules are reviewed.
5. Restore test plan is defined.
6. Admin approval is explicit in the current session or recorded in DB.

## Tenant/user rule

Tenants and users may only back up or copy their own tenant-owned/user-owned/device-owned locations. Platform locations stay admin-only.

```text
platform repo path = admin only
tenant location = tenant_id scoped and owner_scope=tenant
user/device location = user_id/device_id scoped and owner_scope=user|device
```

## Actual backup runs

First actual backup run:

```text
docs/backup-run-2026-05-17-code-main.md
```

Summary:

```text
policy = policy:platform-code-main:snapshot-draft
run_mode = apply
status = succeeded
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-code-main-85ea6e4f7894-20260517T174320Z.zip
checksum_sha256 = 6c99cf7dccdbc8a2f78c9d2971c7056cadebe19a02f2f87e3ed32d0559bd110f
restore_status = passed
```

This was the first code backup. The first database backup is documented here:

```text
docs/backup-run-2026-05-17-db-primary.md
```

Database backup summary:

```text
policy = policy:platform-db-primary:manual-draft
run_mode = apply
status = succeeded
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-db-primary-2026-05-17T18-10-17-164Z.sql.gz.aes256gcm
checksum_sha256 = e7ac7a51a4d74d55e31954d55edf659c05ddadbacf73a0f66ea48f902f2f4756
restore_status = passed
plaintext_restore_sql_removed = true
```

First local n8n backup run:

```text
docs/backup-run-2026-05-17-n8n-local.md
```

n8n backup summary:

```text
policy = policy:local-n8n-data:manual
run_mode = apply
status = succeeded
source = D:\\n8n-data
artifact = D:\\Nagy\\Growth-0s-Backups\\artifacts\\growth-os-n8n-local-2026-05-17T18-25-41-880Z.zip.aes256gcm
checksum_sha256 = cc3b4819a6c984d51a121446779d8110bedf15f43321deda9785676c5387fbb7
restore_status = passed
plaintext_validation_zip_removed = true
```

## Non-goals in this phase

This phase does not:

- create database dumps
- copy files
- upload backup artifacts
- rotate secrets
- schedule recurring jobs
- certify restore readiness

Those require later approved policies and dry-run helpers.
