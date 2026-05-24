# Local Project Path Governance

## Purpose

Admins can manage the local project path for each user/device/project without relying on memory or chat history. The platform stores the intended local path in SQL and provides helper scripts to plan moves, confirm moves, and repair incomplete user-side moves.

This is not a backup process. It is a local working-copy path registry and repair workflow.

## Access policy

A local path is not automatically tenant/user-accessible just because it exists on a device.

Rules:

```text
platform repo path = platform/admin only
tenant access = allowed only for a separately registered tenant-owned path
user access = allowed only for a separately registered user/device-owned path
```

The platform admin repo path on Essam:

```text
D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
```

must remain:

```text
owner_scope = platform
allowed_subject_scope = admin
```

A tenant may use a similar path only when registered as a distinct tenant-owned row:

```text
owner_scope = tenant
allowed_subject_scope = tenant_admin
tenant_id = <tenant id>
project_key = <tenant project key>
```

Users may use only their own device/user-owned rows:

```text
owner_scope = user | device
allowed_subject_scope = user_owner
```

## SQL authority

Tables:

```text
local_project_path_registry
local_project_path_events
local_project_path_repair_runs
```

Migration:

```text
http-generic-api/migrations/078_sprint61_local_project_path_registry.sql
```

### `local_project_path_registry`

Stores the current path for a project on a specific user/device.

Key fields:

```text
tenant_id
user_id
device_id
project_key
current_path
previous_path
repo_remote
repo_branch
expected_markers_json
path_status
validation_status
last_validated_at
```

Statuses:

```text
path_status = active | pending_move | repair_required | archived
validation_status = unknown | valid | missing | partial | mismatch | inaccessible
```

### `local_project_path_events`

Append-only event log for registration, path updates, move planning, confirmation, validation, repair dry-runs, repair apply operations, and archive actions.

### `local_project_path_repair_runs`

Tracks local repair attempts and their summary counts. The actual local repair manifest is created on the device by the repair script.

## Admin DB helper

Server-side helper:

```text
http-generic-api/scripts/local-project-path-helper.mjs
```

Governed `admin_control` aliases:

```text
local_project_path_helper_dry_run
local_project_path_helper_apply
```

Dry-run example:

```json
{
  "tool": "shell",
  "action": "run",
  "alias": "local_project_path_helper_dry_run",
  "extra_args": [
    "--action=upsert",
    "--device-id=Essam",
    "--project-key=growth-intelligence-os",
    "--current-path=D:\\mad4b\\platform-working-copy",
    "--repo-remote=https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git",
    "--repo-branch=main",
    "--expected-markers-json=[\".git\",\"package.json\",\"http-generic-api\"]"
  ]
}
```

Apply example:

```json
{
  "tool": "shell",
  "action": "run",
  "alias": "local_project_path_helper_apply",
  "extra_args": [
    "--action=plan-move",
    "--device-id=Essam",
    "--project-key=growth-intelligence-os",
    "--new-path=D:\\mad4b\\platform-working-copy"
  ]
}
```

Supported actions:

```text
list
upsert
plan-move
confirm-move
mark-repair-required
archive
```

Guardrails:

- Default mode is dry-run.
- Apply requires the separate `local_project_path_helper_apply` alias.
- The dry-run alias rejects `--apply` in `extra_args`.
- The apply alias rejects `--dry-run` in `extra_args`.
- The helper writes only to SQL registry/event tables.
- It does not move files.

## Local repair script

Device-side script:

```text
http-generic-api/scripts/local-project-path-repair.mjs
```

It is intended to be run on the user device after a move was attempted manually or partially completed.

Dry-run:

```bash
node http-generic-api/scripts/local-project-path-repair.mjs \
  --source-path="D:\\old\\project" \
  --target-path="D:\\mad4b\\platform-working-copy" \
  --markers=".git,package.json,http-generic-api" \
  --dry-run
```

Apply:

```bash
node http-generic-api/scripts/local-project-path-repair.mjs \
  --source-path="D:\\old\\project" \
  --target-path="D:\\mad4b\\platform-working-copy" \
  --markers=".git,package.json,http-generic-api" \
  --apply
```

Behavior:

- Never deletes the source path.
- Copies missing files only.
- Does not overwrite conflicts.
- Reports conflicts separately.
- Excludes `node_modules`, `.cache`, `dist`, and `coverage` by default.
- Writes a `.mad4b-local-path-repair.json` manifest in apply mode.

## Move workflow

1. Admin records or updates the current path with `upsert`.
2. Admin plans a move with `plan-move`; SQL status becomes `pending_move`.
3. User moves the folder locally or runs the repair script.
4. Admin/user validates markers and git state on the device.
5. Admin confirms with `confirm-move`; SQL status becomes `active`, validation becomes `valid`.
6. If markers or files are missing, use `mark-repair-required` and run the local repair script.

## Current validated admin device paths

As of 2026-05-17, the following Essam device paths are registered and validated in SQL:

```text
device_id = Essam
project_key = growth-intelligence-os
current_path = D:\\Nagy\\Multi-Business-Multi-Role-Growth-Intelligence-OS
status = active / valid

project_key = local-connector
current_path = C:\\mad4b-connector
status = active / valid
```

The paths were verified with the governed local shell aliases `local_dir_list` and `local_file_search` before being marked valid.

As of 2026-05-24, the Nagy admin/control device is available as a separate managed connector. It is not the n8n primary runtime; n8n remains on Essam. The Nagy device is for admin control, repository inspection, and local development verification.

```text
device_id = DESKTOP-91FDEFP
aliases = nagyxs, nagy pc, nagy
project_key = growth-intelligence-os
current_path = C:\\Users\\nagyx\\source\\repos\\multi-business-multi-role-growth-intelligence-os
status = active / valid
repo_branch = main
repo_remote = https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os.git
```

Safe connector aliases configured on the Nagy device:

```text
repo_status
repo_branch
repo_log_latest
repo_compare_origin_main
repo_pull_ff_only
```

`repo_pull_ff_only` is intentionally state-changing but constrained to `git pull --ff-only origin main`; it must fail rather than merge when the local branch has divergent commits or unresolved local changes.

## Connector proxy diagnostics and timeouts

The auth-host device facade exposes:

```text
GET /connector/{device_id}/diagnostics
```

Use diagnostics before long-running device calls. It returns the selected config, candidate routes, route health metadata, and connector proxy timeout bounds without forwarding a device command or exposing connector secrets.

The connector proxy keeps a short default timeout for health and policy calls, but honors bounded `timeout_ms` from the request body/query for legitimate longer operations such as repo sync, file discovery, PowerShell, and n8n diagnostics. This avoids opaque client-side message delivery timeouts while keeping a maximum bounded proxy wait.

## Validation checklist

For each registered path:

```text
.git exists when a git working copy is expected
package.json exists when a Node project is expected
http-generic-api exists for the Growth Intelligence OS repo
remote origin matches repo_remote when provided
current branch matches repo_branch when provided
local connector allowlist permits the path only when required
```

## Not backup

This registry does not certify a backup. A local project path can be stale, partial, or untrusted until validated. Backups require a separate policy covering destination, encryption, retention, checksum, and restore tests.
