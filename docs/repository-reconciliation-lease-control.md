# Repository Reconciliation Lease Control

## Purpose

`POST /admin/repository-automation/reconciliation-lease` is the narrow governed surface for acquiring, renewing, and releasing repository-operation leases used by branch reconciliation.

It does not execute a reconciliation recipe, create commits, update refs, merge pull requests, deploy code, or apply migrations.

## Security boundary

The route requires both the backend API key and an Admin principal. The control module additionally requires:

- a ready GitHub capability resolution envelope;
- an exact typed confirmation for the selected action;
- a non-default work branch for `acquire`;
- exact expected base and branch SHAs for `acquire`;
- a SHA-256 resource fingerprint for `renew` and `release`;
- no force, protected-branch, or stale-branch bypass flags.

Responses and structured errors set `secrets_included: false`.

## Actions

### Acquire

Typed confirmation:

```text
ACQUIRE_REPOSITORY_RECONCILIATION_LEASE
```

Required binding fields include repository owner/name, work branch, default branch, expected base SHA, expected branch SHA, operation key, and holder run ID. The runtime computes the canonical operation fingerprint; a caller-supplied fingerprint is accepted only when it matches that computation.

### Renew

Typed confirmation:

```text
RENEW_REPOSITORY_RECONCILIATION_LEASE
```

Requires `lease_id`, `holder_run_id`, and `resource_fingerprint`.

### Release

Typed confirmation:

```text
RELEASE_REPOSITORY_RECONCILIATION_LEASE
```

Requires `lease_id`, `holder_run_id`, and `resource_fingerprint`. Release remains idempotent through the underlying lease service.

## Catalog V2 continuation

After this surface is merged, PR #3033 must still be rebuilt over the latest `main`. A fresh reconciliation operation and lease must be created in the same cycle before any no-force update to the PR branch. Previous resolution commits, envelopes, and lease identifiers are audit evidence only and must not be reused.
