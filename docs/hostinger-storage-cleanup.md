# Hostinger SSH Storage Cleanup

## Purpose

Prevent Hostinger storage exhaustion from breaking File Manager, environment-variable updates, builds, and runtime operations.

This tool is intentionally conservative. It separates inspection, planning, and deletion into three distinct phases:

```text
scan -> plan -> human review -> typed confirmation -> apply -> readback
```

`scan` and `plan` never delete application data. `apply` can only delete files recorded in an unexpired, integrity-checked plan.

## Protected surfaces

The cleanup policy never deletes:

- anything inside `public_html`;
- `.env` or `.env.*` files;
- `.ssh`, `secrets`, `.config`, `mail`, `backups`, or `databases` directories;
- private keys, certificates, SQL/database files, archives, package manifests, `.htaccess`, or `server.js`;
- symlinks;
- files outside the SSH account home;
- files that changed after the plan was created.

The default conservative cleanup profile includes only:

- npm content cache files older than 14 days;
- npm diagnostic logs older than 14 days;
- account `tmp` files older than 7 days;
- rotated or compressed account/domain logs older than 14 days.

Active `.log` files are not candidates.

## Installation through SSH

From the repository checkout, copy the script to the Hostinger account:

```bash
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> 'mkdir -p ~/.mad4b/bin && chmod 700 ~/.mad4b ~/.mad4b/bin'
scp -P <SSH_PORT> http-generic-api/scripts/hostinger-storage-cleanup.sh \
  <SSH_USER>@<SSH_HOST>:~/.mad4b/bin/hostinger-storage-cleanup
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> \
  'chmod 700 ~/.mad4b/bin/hostinger-storage-cleanup'
```

Do not place credentials in the command line, repository, or script. Use the existing governed SSH connection or an SSH key.

## Scan

Read filesystem usage, largest directories, and files larger than 100 MiB:

```bash
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> \
  '~/.mad4b/bin/hostinger-storage-cleanup scan'
```

The response is JSON and includes:

- filesystem total, used, and available space;
- top directories by size;
- largest files;
- `deletion_executed: false`.

Large-file discovery is advisory only. A large file is not automatically a deletion candidate.

## Create a cleanup plan

```bash
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> \
  '~/.mad4b/bin/hostinger-storage-cleanup plan'
```

The plan response includes:

- `plan_id`;
- candidate count and bytes;
- plan expiry;
- exact typed `confirmation` token;
- `deletion_executed: false`.

Plans are stored under:

```text
~/.mad4b-storage-cleanup/plans
```

with mode `0700` for the state directory and `0600` for plan files.

Default caps:

```text
maximum files per plan: 5000
maximum bytes per plan: 5 GiB
plan TTL: 1 hour
```

The caps can be reduced, but not raised above 10,000 files or 10 GiB.

## Apply an approved plan

Copy the exact `plan_id` and `confirmation` from the plan response:

```bash
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> \
  '~/.mad4b/bin/hostinger-storage-cleanup apply \
    --plan-id <PLAN_ID> \
    --confirm <EXACT_CONFIRMATION_TOKEN>'
```

Before each deletion, the tool verifies again that:

- the path remains under the allowed account root;
- the path is not protected;
- the item is still a regular non-symlink file;
- size and modification time match the approved plan;
- the plan is unexpired and untampered;
- the typed confirmation matches the exact plan.

The tool deletes one validated file at a time using `rm -- <exact-path>`. It never uses `rm -rf`, `eval`, `sudo`, wildcard deletion, or recursive permission changes.

## Readback

After apply, compare:

```bash
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> 'df -h "$HOME"'
```

and rerun:

```bash
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST> \
  '~/.mad4b/bin/hostinger-storage-cleanup scan'
```

The tool writes a bounded audit record to:

```text
~/.mad4b-storage-cleanup/audit.jsonl
```

The audit contains counts and byte totals, not credentials or file contents.

## Monitoring policy

A scheduled job may run `scan` only. Do not schedule `apply` without a separate governed approval mechanism.

Recommended thresholds:

```text
warning: 75% used
critical: 85% used
emergency: 92% used
```

At warning level, inspect growth sources. At critical level, create and review a plan. At emergency level, pause deployments until storage is reduced and hPanel read/write operations recover.

## Platform integration contract

When this script is invoked through the platform SSH connection:

- execution must occur on the dedicated SSH worker or local connector, not the public web runtime;
- `scan` and `plan` are read-only operation keys;
- `apply` requires a workspace-owner approval hold and the exact plan confirmation;
- no free-form shell command is accepted;
- stdout/stderr must be capped and secret-redacted;
- the result must preserve `secrets_included: false`;
- the SSH connection remains tenant/user scoped.

The first rollout should certify `scan` and `plan`. Enable `apply` only after a real Hostinger dry-run, plan review, and deletion/readback drill on non-production test files.
