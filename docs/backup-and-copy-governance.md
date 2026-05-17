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

## Non-goals in this phase

This phase does not:

- create database dumps
- copy files
- upload backup artifacts
- rotate secrets
- schedule recurring jobs
- certify restore readiness

Those require later approved policies and dry-run helpers.
