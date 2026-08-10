# Runtime Immutability Inventory — Spec 018 C01–C06

## Scope

This inventory covers routine local/SSH application-code mutation paths for the Hostinger production application and the read-only diagnostics used to prove deployed runtime integrity. It does not authorize break-glass mutation, provision credentials, apply migrations, deploy Production, or mutate provider resources.

## Application-code mutation surface

### Hostinger SSH deploy executor

`http-generic-api/hostingerSshDeployExecutor.js` is the bounded compatibility executor that can perform application-code mutation only on an allowlisted `/home/...` application path when non-dry-run execution is otherwise authorized. Its mutation sequence includes fixed-SHA Git checkout and release/restart work. It is not the normal Production delivery path.

For the known Hostinger production target, `20260810_environment_branch_authority_v1.sql` sets:

- `deployment_strategy = github_production_auto_deploy`
- `deployment_allowed = false`
- `ssh_normal_updates_allowed = false`
- `ssh_break_glass_only = true`

Those metadata fields are already consumed by `evaluateHostingerSshDeployTargetPolicy()` / `assertHostingerSshDeployTargetPolicy()` before credential resolution and network I/O. Therefore routine local application-code mutation remains fail-closed. Phase C does not create an exception. A future exception requires the separately governed Break-Glass lifecycle in phase D.

### Hostinger SSH target probe

The SSH target probe and its runner-mode helpers are diagnostic surfaces. They must remain read-only and must not be reinterpreted as application-code mutation authority.

### Hostinger storage orchestration

Spec 014 Hostinger storage tools have separate path/resource authority. Phase C does not widen those tools into application-code write authority. Any storage operation that would overlap an application-code path remains subject to its own allowlists and governance and is not a substitute for break-glass application-code mutation.

## Runtime readback surface

### `/deployment-info`

`http-generic-api/routes/deploymentInfoRoutes.js` already exposes deployment manifest, branch, commit, and Git checkout identity without provider mutation. Phase C extends this read-only response with a distinct `runtime_integrity` object.

Runtime integrity is not service health. A service may return `ok: true` while `runtime_integrity.state = degraded` if tracked application files are dirty or the checkout cannot be verified.

### Runtime integrity classifier

`http-generic-api/runtimeIntegrity.js` performs a bounded local Git readback using fixed argv and `shell: false`. It checks only tracked-file status (`--untracked-files=no`) so runtime-only untracked metadata such as deployment manifests does not create false application-code drift. `GIT_OPTIONAL_LOCKS=0` is used to keep the diagnostic non-locking/read-oriented.

The response never returns modified file paths, file contents, credentials, environment secrets, or raw Git output. It returns only bounded counts, booleans, state, and reason codes.

## Integrity reason codes

- `runtime_checkout_integrity_unavailable`
- `runtime_checkout_not_detected`
- `runtime_expected_commit_unavailable`
- `runtime_checkout_commit_unavailable`
- `runtime_commit_mismatch`
- `unapproved_dirty_runtime`

Any reason makes runtime integrity `degraded`; no reason makes it `verified`.

## Phase boundary

C01–C06 establish default denial, read-only detection, and separate integrity reporting. They do not implement break-glass persistence, incident binding, expiry, rollback, reconciliation, or governed Git representation. Those remain phase D tasks.
