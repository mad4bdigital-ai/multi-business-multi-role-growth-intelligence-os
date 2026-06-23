# Rollout Strategy

## Stage A — Design review

Review asset classes, scope dimensions, union/intersection semantics, safety floor, and existing-authority bridges. No runtime changes.

## Stage B — Shadow schema and catalog

Apply additive tables and views. Populate catalog projections from canonical registries. Expose admin-only readiness and parity reports.

## Stage C — Tenant read-only discovery

Allow tenants to view adoptable assets and effective readiness. No adoption or grants yet.

## Stage D — Low-risk adoption

Enable overlay/fork creation for read-only agents, workflows, dashboard components, and knowledge profiles. Execution remains on legacy authority.

## Stage E — Scope composition

Enable workspace/brand/activity/role profiles. Start with union for discovery and explicit tenant-selected profiles; certify intersection scenarios separately.

## Stage F — Dedicated credentials

Enable connection binding for selected read-only apps. Installation and certification are required before readiness.

## Stage G — Sensitive assets

Enable adoption of write actions and approval-sensitive skills while preserving mandatory invocation approval. Do not auto-approve or auto-execute.

## Stage H — Family-by-family cutover

Promote the generic resolver only after parity for each asset family. Maintain rollback to specialized authorities.

## Rollback

- disable generic execution exports;
- keep tenant instances and versions intact;
- restore specialized resolver as sole runtime authority;
- preserve resolution and migration evidence;
- do not delete tenant versions during rollback.
