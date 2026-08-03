# Hostinger Storage Control Plane

## Why cache cleanup alone is not enough

The incident was caused by the hosting plan reaching its storage limit. On Hostinger, disk usage and inode usage are separate pressure dimensions. A plan can still have free bytes while being unable to create a file because the inode limit is exhausted. The hPanel Resources Usage view is the authority for the plan limits; `df` over SSH describes the underlying filesystem and must not be treated as the hosting-plan quota.

The cleanup system therefore has two jobs:

1. prevent pressure by measuring bytes and inodes before deployment;
2. recover safely without guessing which application files are disposable.

## Correct ownership boundary

`auth.mad4b.com` is platform production infrastructure. Its storage control must use the platform-managed Hostinger SSH target and admin authority. It must not be implemented as an unrestricted tenant SSH command or as a free-form shell surface.

The existing remote-runtime layer already provides the correct primitives:

- platform-managed Hostinger target resolution;
- path and command allowlists;
- capability envelopes;
- approval gates;
- bounded, redacted execution evidence;
- dedicated worker or connector dispatch.

The storage tool should become a provider adapter on that control plane, not a parallel SSH subsystem.

## Pressure model

The state is computed independently for disk and inodes:

```text
normal      < 70%
warning     >= 70%
critical    >= 80%
emergency   >= 90%
```

The effective pressure state is the worst of the two dimensions. A deployment should be blocked at emergency. At critical, a deployment may proceed only when the predicted install footprint fits within the remaining budget plus the protected reserve.

### Required measurements

- hPanel plan disk limit and current use;
- hPanel inode limit and current use;
- SSH account logical bytes from `du`;
- SSH account inode count;
- top byte-consuming directories;
- top inode-consuming directory buckets;
- large files;
- current deployment root and immutable deployment SHA;
- npm cache, npm logs, rotated logs, deployment copies, and `node_modules` footprints.

The first four values identify pressure. The remaining values identify the source.

## Candidate classes

### Low-risk, rebuildable candidates

These may enter a cleanup plan automatically after retention checks:

- npm content cache older than 14 days;
- npm diagnostic logs older than 14 days;
- rotated or compressed logs older than 14 days.

### Review-required candidates

These must never enter an automatic deletion plan without additional evidence:

- account `tmp` content;
- `node_modules`;
- old deployment directories;
- build output;
- Git object stores;
- uploaded media;
- manual backups;
- unknown large files;
- unknown inode hotspots.

For an old deployment to become eligible, the planner must prove all of the following:

- it is not the active hPanel application root;
- it is not referenced by the running process;
- it is not the current `Production` SHA;
- it is not one of the retained rollback releases;
- its dependencies can be recreated from a lockfile;
- deleting it will not remove shared uploads, secrets, or runtime state.

## Operation lifecycle

```text
scan
  -> pressure classification
  -> plan
  -> inspect exact items
  -> owner approval + capability envelope
  -> apply exact plan hash
  -> filesystem readback
  -> hPanel usage recalculation
  -> runtime health and deployment readback
```

A plan has a one-hour TTL and is immutable. The apply request binds to:

- target ID;
- root path;
- policy version;
- plan ID;
- SHA-256 plan hash;
- candidate count and bytes;
- workspace-owner approval;
- capability envelope;
- typed confirmation.

Each file is revalidated immediately before deletion by canonical path, file type, device, inode, size, ctime, and mtime. A mismatch skips the file rather than broadening the plan.

## Emergency reserve

A 64 MiB physical reserve file should be provisioned while the account is healthy. It exists only to preserve enough writable space for:

- cleanup state and audit metadata;
- a small environment-variable update;
- hPanel/File Manager recovery;
- deployment failure diagnostics.

Releasing the reserve is a separate exact-path operation with typed confirmation. The reserve must never be released automatically by a scheduled scan.

## Data model for platform integration

### `storage_pressure_snapshots`

- snapshot ID;
- target ID;
- provider;
- observed disk bytes and percentage;
- observed inode count and percentage;
- source timestamps;
- pressure state;
- top directory summaries;
- active deployment evidence.

### `storage_cleanup_plans`

- plan ID and hash;
- target ID and root;
- policy version;
- candidate totals;
- expiry;
- status;
- approval and capability-envelope references.

### `storage_cleanup_plan_items`

- relative path or encrypted path reference;
- category;
- size;
- device and inode;
- ctime and mtime;
- eligibility evidence;
- execution result.

### `storage_cleanup_runs`

- run ID;
- plan ID;
- before/after snapshots;
- deleted and skipped totals;
- interruption checkpoint;
- audit event IDs;
- readback result.

### `storage_pressure_incidents`

- incident state;
- opened and resolved times;
- pressure dimension;
- deployment blocks;
- reserve release evidence;
- Hostinger support reference when applicable.

## Fixed command surface

The platform adapter should expose fixed operation keys only:

```text
hostinger_storage_scan
hostinger_storage_plan
hostinger_storage_inspect_plan
hostinger_storage_apply_plan
hostinger_storage_readback
hostinger_storage_reserve_status
hostinger_storage_reserve_create
hostinger_storage_reserve_release
```

No operation accepts a shell command, wildcard path, arbitrary root, or delete expression.

## SSH security

Production storage operations must pin the Hostinger SSH host-key fingerprint. `StrictHostKeyChecking=no` is not acceptable for consequential cleanup. The dedicated worker should use a target-specific `known_hosts` entry and fail closed when the fingerprint changes.

Credentials remain in the credential resolver and are never copied into plan files, logs, approval records, or command output.

## Deployment prevention gate

Before promoting a release to `Production`, run a read-only storage scan. Block deployment when:

- disk or inode pressure is emergency;
- the predicted dependency install exceeds remaining budget;
- the emergency reserve is absent at critical pressure;
- hPanel limits are unknown and the SSH inventory shows material growth since the previous successful release.

The gate must never run cleanup automatically. It can create a plan and an operational attention item.

## Rollout phases

### Phase A — inventory certification

- run SSH `scan` only;
- compare SSH bytes/inodes with hPanel;
- discover the actual Node.js deployment layout;
- identify whether storage growth comes from npm cache, `node_modules`, deployment history, logs, or another website on the same plan.

### Phase B — conservative plan certification

- enable `plan` and `inspect` for low-risk classes only;
- confirm no `public_html` or active deployment path appears;
- test an expired plan, a tampered plan, a replaced inode, and a replayed plan.

### Phase C — controlled apply drill

- create non-production synthetic cache and rotated-log files;
- approve one exact plan;
- apply and verify bytes/inodes before and after;
- verify application runtime and Hostinger File Manager.

### Phase D — monitoring

- schedule scan only;
- create alerts at warning/critical/emergency;
- retain snapshots for growth trending;
- require a human approval for every apply.

### Phase E — deployment-aware cleanup

Only after the real Hostinger deployment layout is certified, add an adapter for old deployment copies with retained rollback releases and exact active-SHA exclusion.
