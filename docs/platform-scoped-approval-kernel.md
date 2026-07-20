# Platform Scoped Approval Kernel

## Purpose

T022 adds a scoped approval request and append-only decision kernel for adaptive authorization execution governance. It sits after the revision-bound execution envelope and before any future adapter execution.

This PR is intentionally non-executing. It does not persist approvals, call providers, mutate external systems, create migrations, or cut over enforcement.

## Scoped approval request

A scoped approval request binds an approval to execution envelope id, execution envelope manifest hash, tenant/workspace/boundary/capability scope, requested permissions, single-use maximum, issued and expiry timestamps, and no-provider-apply execution boundaries.

The request has a stable `request_scope_hash` and `manifest_hash`. Validation fails closed if the scope is changed, the request expires, secrets are present, or any execution boundary attempts to allow provider apply, mutation, or cutover.

## Append-only decisions

Each decision is a hash-chained record with request manifest hash, decision sequence, previous decision hash, approved/rejected/abstained decision, approver identity, and decision note hash.

The kernel appends decisions by returning a new log and never mutating the provided log. Existing records are validated before any append. Tampering with any previous decision breaks the hash chain. Approved and rejected decisions are terminal for the scoped request.

## Safety guarantees

All request and decision outputs force `provider_apply_allowed: false`, `mutation_allowed: false`, `enforcement_cutover: false`, and `secrets_included: false`.

## Non-goals

This PR does not implement persistence, approval routes, provider execution, adapter execution, migration execution, or canary enforcement. Persistence and stale/idempotency/concurrency controls remain T023.
