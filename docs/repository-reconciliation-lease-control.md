# Repository Reconciliation Lease Control

## Purpose

`POST /admin/repository-automation/reconciliation-lease` is the narrow governed surface for acquiring, renewing, and releasing repository-operation leases used by branch reconciliation.

It does not execute a reconciliation recipe, create commits, update refs, merge pull requests, deploy code, or apply migrations.

## Security boundary

The route requires both the backend API key and an Admin principal. The control module additionally requires:

- a ready, apply-authorized GitHub capability resolution envelope;
- an envelope resource URI bound to the exact repository work branch for `acquire`;
- an envelope binding SHA-256 matching the canonical operation fingerprint for `acquire`, or the lease resource fingerprint for `renew` and `release`;
- an exact typed confirmation for the selected action;
- a non-default work branch for `acquire`;
- exact expected base and branch SHAs for `acquire`;
- a SHA-256 resource fingerprint for `renew` and `release`;
- no force, protected-branch, or stale-branch bypass flags.

A generic `repo_mutation` intent is not accepted as lease authority. The envelope must carry a lease-control-specific operation intent. Responses and structured errors set `secrets_included: false`.

## Runtime registration and API contract

The additive migration:

```text
http-generic-api/migrations/20260730_repository_reconciliation_lease_control_tool.sql
```

registers `repository_reconciliation_lease_control` in `admin_platform_endpoint_tools`. This makes the surface discoverable through `listAdminTools` and callable through `callAdminTool` after governed migration apply and readback.

The PR includes the migration but does not apply it. Authorization, dry-run, apply confirmation, ledger evidence, and post-apply registry readback remain separate governed release steps.

The canonical modular OpenAPI contract is:

```text
http-generic-api/openapi/repository-reconciliation-lease-control.yaml
```

It documents three action-specific request variants, the exact confirmations, Admin authentication, consequential classification, bounded responses, and secret-safe structured errors. The direct operation is excluded from compact Custom GPT projections because Admin GPT reaches it through the dynamic tool registry.

## Generated artifact and CI lifecycle

Changes to routes or modular OpenAPI contracts trigger the bounded PR artifact refresh. The workflow regenerates and verifies the frontend dispatch index and compact GPT schemas, then commits only the allowlisted generated files.

Because that generated commit is authored by `github-actions[bot]`, a subsequent human-authored, source-neutral commit may be required to run the repository's full pull-request checks on the generated head. This does not authorize merging or applying the registry migration.

## Verified generated readback

The bounded refresh is accepted only when all of the following remain true:

- operation-governance coverage reports all discovered candidates as generated rules with zero rejected candidates;
- the lease endpoint is classified as a governed `state_change` from a generated operation rule with no blockers;
- preflight, typed approval, transactional readback, rollback, and parameter bindings are present;
- runtime and OpenAPI authentication remain equivalent with no route-contract gaps;
- `test-repository-reconciliation-lease-control.mjs` is attached to the endpoint and is absent from `untested_operations`.

## Final reconciliation checkpoint

The source set was reconciled without force over the then-current `main`. Workflow-owned generated artifacts must be rebuilt after semantic integration with the expanded Canary governance rules. The temporary one-shot workflow is limited to that semantic merge, runs the focused Governance and Lease regressions, and removes itself after committing the integrated source set.

This source-neutral checkpoint exists to trigger and record that bounded semantic reconciliation before review finalization and merge. Migration apply, deployment, and reuse of prior capability envelopes or lease identifiers remain separately governed.

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

After this surface is merged and its registry migration is governed-applied with readback, PR #3033 must still be rebuilt over the latest `main`. A fresh reconciliation operation, capability envelope, and lease must be created in the same cycle before any no-force update to the PR branch. Previous resolution commits, envelopes, reconciliation identifiers, and lease identifiers are audit evidence only and must not be reused.
