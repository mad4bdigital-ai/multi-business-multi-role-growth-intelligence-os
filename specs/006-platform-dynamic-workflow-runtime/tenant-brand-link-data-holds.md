# Spec 006 Tenant Brand Link Data Holds

## Purpose

This note records the Dynamic Container projection holds related to legacy workspace-to-brand classification. It distinguishes genuine brand-link evidence from repair-created default workspaces that were classified as `brand` only because the database column default was used.

## Current projection evidence

Last verified projection dry-run before the default-workspace classification repair:

```text
projectionRunId: fec98ecb-a1d1-4a09-9dbb-0b4909a55f31
projectedContainerCount: 89
projectedRelationshipCount: 72
projectedRoleAssignmentCount: 38
projectedResourceBindingCount: 65
heldIssueCount: 3
highRiskIssueCount: 0
providerCalls: false
credentialPayloadReads: false
externalWrites: false
secretsIncluded: false
sourceSnapshotSha256: cc7d8d3090559e542064bacf24e000500fd4f55ae5dfd88eee659a57befb7410
```

Dynamic rollout readiness remains `ready_for_review`. The three held rows are medium-severity classification holds; no high-risk projection issue is present.

## Resolved evidence-backed brand link

Tenant `792029d2-4f62-4994-8dca-00417e90438d` was linked to active brand target `wovacation_wp` through `http-generic-api/migrations/20260723_wovacation_tenant_brand_link.sql`.

The evidence was direct and independent:

```text
workspace_assets.brand_ref: wovacation_wp
workspace_resource_grants.resource_type: brand
workspace_resource_grants.resource_ref: wovacation_wp
brands.target_key: wovacation_wp
```

That migration was applied successfully and reduced `heldIssueCount` from 4 to 3.

## Repair-created default workspace classification

The remaining three rows were created together by the historical repair identified by:

```text
repair_key: capability_gate_default_workspace_registry_20260704
bootstrap_trigger_run_id: capability-default-repair-20260704
default_workspace: true
```

The repair created minimal workspace records for active tenants that had memberships and default workspace grants but no workspace registry row. It did not persist brand evidence. Because `workspace_registry.workspace_type` defaults to `brand`, all repair-created rows inherited the brand classification.

The current projection logic requires brand authority only when `workspace_type = 'brand'`. A `project` workspace without a brand link remains a valid workspace container and does not generate `workspace_brand_link_missing`.

`http-generic-api/migrations/20260723_default_workspace_classification_repair.sql` therefore changes only the three known repair-created rows from `brand` to `project`, and only when all safeguards remain true:

- the exact workspace and tenant IDs match;
- the original repair key and `default_workspace` marker remain present;
- `linked_brand_key` remains empty;
- no active `tenant_brand_links` row exists;
- the tenant type is `platform_owner` or `managed_client_account`.

## Classification repair items

| Tenant ID | Workspace ID | Tenant type | Current classification | Corrective action |
| --- | --- | --- | --- | --- |
| `00000000-0000-4000-a000-000000000001` | `0ff5982f-77d5-11f1-9a4d-d342cf4a053c` | `platform_owner` | repair-created `brand`, no brand evidence | Reclassify to `project`; do not create a brand link. |
| `1e673d38-89a2-4872-a6b9-8bc937bd9503` | `0ff59ac4-77d5-11f1-9a4d-d342cf4a053c` | `managed_client_account` | repair-created `brand`, no brand evidence | Reclassify to `project`; do not create a brand link. |
| `d7696384-ef5c-4d38-a90c-b17edaaf8c72` | `0ff59b5f-77d5-11f1-9a4d-d342cf4a053c` | `managed_client_account` | repair-created `brand`, no brand evidence | Reclassify to `project`; do not create a brand link. |

## Non-goals

- Do not infer brand ownership from workspace or tenant display names.
- Do not create `tenant_brand_links` or `linked_brand_key` values for the three classification-repair rows.
- Do not reclassify repair-created rows that now have active tenant-brand evidence.
- Do not modify the global `brands` registry.
- Do not enable enforcement, promotion, or production activation as part of this repair.

## Validation checklist

1. Confirm CI and the focused migration safeguards test pass.
2. Authorize the migration by exact checksum and statement count.
3. Run governed migration dry-run before apply.
4. Apply only through the governed migration runner.
5. Read back the three workspace rows and the persisted repair metadata.
6. Re-run `dynamic_container_projection_dry_run`.
7. Confirm `heldIssueCount` decreases from 3 to 0 and `highRiskIssueCount` remains `0`.
8. Confirm readiness remains `ready_for_review` and enforcement remains disabled until separately authorized.
