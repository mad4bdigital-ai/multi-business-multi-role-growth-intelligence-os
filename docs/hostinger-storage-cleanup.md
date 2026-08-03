# Hostinger SSH Storage Cleanup

## Objective

Prevent disk or inode exhaustion from breaking Hostinger File Manager, environment-variable updates, builds, and the running Node.js application.

The tool is deliberately split into independent operations:

```text
scan -> plan -> inspect -> approval -> apply -> readback
```

`scan`, `plan`, and `inspect` do not delete application data. `apply` can delete only the exact immutable plan that was inspected and approved.

The machine-readable policy is:

```text
http-generic-api/config/hostinger-storage-cleanup-policy.json
```

The deeper architecture and platform-integration contract are documented in:

```text
docs/hostinger-storage-control-plane.md
```

## Important distinction: filesystem versus hosting-plan quota

The SSH command `df` describes the underlying filesystem. It is not the authoritative Hostinger account quota. The hPanel Resources Usage view remains the authority for the plan's disk and inode limits.

The scan therefore returns both:

- filesystem-level `df` byte and inode observations;
- account-level logical bytes, inode count, directory hotspots, and large files.

The operator must compare the SSH inventory with hPanel before authorizing deletion.

## Installation

Install from the reviewed repository checkout:

```bash
mkdir -p ~/.mad4b/bin
chmod 700 ~/.mad4b ~/.mad4b/bin
cp http-generic-api/scripts/hostinger-storage-cleanup.sh \
  ~/.mad4b/bin/hostinger-storage-cleanup
chmod 700 ~/.mad4b/bin/hostinger-storage-cleanup
```

Do not place SSH credentials in the script, repository, or command line.

## 1. Read-only scan

```bash
~/.mad4b/bin/hostinger-storage-cleanup scan --root "$HOME"
```

`scan` is designed to work during storage pressure:

- it does not create the cleanup state directory;
- it does not create plan files;
- it does not require a lock file;
- it performs no deletion.

It reports:

- filesystem bytes and inodes;
- account logical usage;
- account inode count;
- top directories by size;
- top directory buckets by inode count;
- files larger than 100 MiB;
- whether a large file belongs to a protected surface.

Large files and inode hotspots are advisory. They do not become deletion candidates automatically.

## 2. Emergency reserve

Provision a physical reserve while the account is healthy. Recommended size: 64 MiB.

```bash
~/.mad4b/bin/hostinger-storage-cleanup reserve-create \
  --root "$HOME" \
  --reserve-bytes 67108864 \
  --confirm PROVISION_HOSTINGER_STORAGE_RESERVE:67108864
```

Read the reserve state:

```bash
~/.mad4b/bin/hostinger-storage-cleanup reserve-status --root "$HOME"
```

During an actual quota emergency, copy the exact `release_confirmation` returned by `reserve-status`:

```bash
~/.mad4b/bin/hostinger-storage-cleanup reserve-release \
  --root "$HOME" \
  --confirm '<EXACT_RELEASE_CONFIRMATION>'
```

Reserve release deletes only the known reserve file. It does not scan or delete application files.

## 3. Create a conservative plan

```bash
~/.mad4b/bin/hostinger-storage-cleanup plan --root "$HOME"
```

Automatic plan candidates are restricted to:

- npm content cache older than 14 days;
- npm diagnostic logs older than 14 days;
- rotated or compressed account/domain logs older than 14 days.

The following remain review-only:

- account `tmp`;
- `node_modules`;
- deployment history;
- build artifacts;
- Git object stores;
- uploaded media;
- manual backups;
- unknown large files and inode hotspots.

The plan response contains:

- `plan_id`;
- `plan_hash`;
- category totals;
- candidate count and bytes;
- expiry;
- exact confirmation token;
- `next_action: inspect`.

Default limits:

```text
maximum files: 5000
maximum bytes: 5 GiB
TTL: 1 hour
```

## 4. Inspect the exact plan

```bash
~/.mad4b/bin/hostinger-storage-cleanup inspect \
  --root "$HOME" \
  --plan-id '<PLAN_ID>'
```

Inspection returns bounded relative paths, categories, sizes, device and inode identifiers, and current validity. It does not expose file contents or credentials.

Reject the plan when:

- a candidate is unexpected;
- a path belongs to an application or upload surface;
- the total deletion is larger than needed;
- the plan is expired;
- the plan hash differs from the hash presented for approval.

## 5. Apply the exact inspected plan

```bash
~/.mad4b/bin/hostinger-storage-cleanup apply \
  --root "$HOME" \
  --plan-id '<PLAN_ID>' \
  --expected-plan-hash '<PLAN_SHA256>' \
  --confirm '<EXACT_PLAN_CONFIRMATION>'
```

Before deleting each item, the tool verifies:

- canonical path remains under the approved root;
- the path is not protected;
- the item is a regular file and not a symlink;
- device and inode match the plan;
- size, ctime, and mtime match the plan;
- the plan is intact and unexpired;
- the plan was not already consumed;
- the expected plan hash and typed confirmation match.

A mismatch skips the item. The tool never expands the plan.

Deletion uses one exact pathname at a time:

```bash
rm -- '<exact-path>'
```

It never uses `rm -rf`, `eval`, `sudo`, wildcard deletion, or recursive permission changes.

## Protected surfaces

The cleanup policy never deletes:

- anything under `public_html`;
- `.env` and `.env.*`;
- `.ssh`, `secrets`, `.config`, `mail`, `backups`, `databases`, or `ssl`;
- private keys or certificates;
- SQL/database files;
- archives;
- package manifests;
- `.htaccess`;
- `server.js`;
- symlinks;
- files outside the approved account root.

This intentionally means the first release cannot clean an old Node deployment inside `public_html`. That class requires a separate deployment-aware policy that proves the directory is inactive and not retained for rollback.

## Readback

After apply:

```bash
~/.mad4b/bin/hostinger-storage-cleanup scan --root "$HOME"
```

Then perform all of the following:

1. Recalculate usage in hPanel Resources Usage.
2. Confirm disk and inode percentages decreased.
3. Confirm File Manager can create and delete a small test file.
4. Confirm Environment Variables can be saved.
5. Verify:

```text
/status
/health
/version
/deployment-info
```

6. Confirm the deployed branch remains `Production` and the running SHA did not change.

## Monitoring

A scheduled job may run `scan` only. Never schedule `apply`.

Recommended thresholds for both disk and inodes:

```text
warning: 70%
critical: 80%
emergency: 90%
```

At emergency pressure, block new deployments. At critical pressure, create and inspect a plan. At warning pressure, open an operational attention item and identify the growth source.

## Platform integration

This production account must use the platform-managed Hostinger SSH target, not a tenant free-form SSH tool. The final platform adapter must provide fixed operation keys, pin the SSH host-key fingerprint, require a capability envelope and workspace-owner approval for `apply`, cap and redact output, and preserve `secrets_included: false`.

The first live rollout is inventory-only. Do not enable `apply` through the platform until the actual Hostinger directory layout and active deployment root have been certified.
