# Runtime Authority and Dispatch Certification Registries

Date: 2026-06-02

## Purpose

This document describes migration `178_sprint66_runtime_authority_certification_registries.sql`.

The migration adds two additive SQL registry foundations:

- `resource_authority_route_family_registry`
- `runtime_dispatch_certification_registry`

These registries make route-family authority and runtime dispatch certification explicit without enabling broad enforcement in the same change.

## Resource authority route-family registry

Table:

```text
resource_authority_route_family_registry
```

Purpose:

```text
Map route families to operation class, risk class, authority requirement, dry-run/audit/readback requirements, and enforcement status.
```

Seeded route families include:

- WordPress publish routes
- WordPress draft routes
- Cloudflare DNS routes
- GitHub repository mutation routes
- Local connector configuration routes
- GPT session writeback routes
- Tenant-safe docs reader routes
- Release dashboard routes
- Runtime audit routes

## Runtime dispatch certification registry

Table:

```text
runtime_dispatch_certification_registry
```

Purpose:

```text
Track whether a tool/action/surface is only baseline registered, read-only certified, diagnostic certified, or requires a future dry-run/apply certification path.
```

The registry records:

- surface key/family
- tool or action key
- risk class
- smoke strategy
- dispatch/apply flags
- resource authority requirement
- dry-run/audit/readback requirements
- evidence references
- certification timestamps

## Risk classes

```text
A = read-only safe
B = diagnostic with dependency
C = mutation-capable with dry-run/synthetic smoke requirement
D = apply/mutation requires explicit resource authority
```

## Safety contract

The migration is additive and idempotent:

- `CREATE TABLE IF NOT EXISTS`
- `INSERT IGNORE`
- no `DROP`
- no `DELETE`
- no `TRUNCATE`
- no broad `UPDATE`
- no secrets
- no `CAST(? AS JSON)` usage

## Enforcement status

This migration does not make all route families blocking immediately.

It establishes registry authority so each route family can later be enforced one at a time with:

- focused tests
- dry-run path where needed
- audit evidence
- readback verification
- explicit rollback plan

## Related routes and surfaces

Read-only certified or diagnostic certified surfaces:

- tenant docs reader
- release dashboard
- fast runtime surface audit

Baseline-registered high-risk surfaces:

- admin Cloudflare
- connector activation
- local connector self repair
- GPT session write/end
- release session archive smoke
- WordPress publish orchestration

## Operational flow

1. Merge the migration and runner allowlist.
2. Run governed migration dry-run.
3. Apply with typed confirmation.
4. Confirm ledger records the apply.
5. Confirm `release_readiness` returns pass.

The migration must be applied through `governed-migration-runner`; do not use ad-hoc SQL for production application.
