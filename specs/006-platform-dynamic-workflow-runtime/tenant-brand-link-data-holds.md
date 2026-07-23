# Spec 006 Tenant Brand Link Data Holds

## Purpose

This note records the remaining Dynamic Container projection holds after the `tenant_brand_links` fallback migration was merged and applied. It is intentionally documentation-only and does not add inferred tenant-to-brand mappings.

## Current projection evidence

Last verified projection dry-run:

```text
projectionRunId: 94c5dd4b-0362-4940-8908-e5c82e37b187
projectedContainerCount: 84
projectedRelationshipCount: 67
projectedRoleAssignmentCount: 38
projectedResourceBindingCount: 65
heldIssueCount: 4
highRiskIssueCount: 0
providerCalls: false
credentialPayloadReads: false
externalWrites: false
secretsIncluded: false
sourceSnapshotSha256: e2af37fd3be265391ad51626fe70815457d7ea94ec4b301f6766f2d8ddce59f1
```

Dynamic rollout readiness remains `ready_for_review` because the remaining holds are data-quality mappings and no high-risk projection issues are present.

## Held data-quality items

| Tenant ID | Workspace ID | Issue code | Severity | Required resolution |
| --- | --- | --- | --- | --- |
| `00000000-0000-4000-a000-000000000001` | `0ff5982f-77d5-11f1-9a4d-d342cf4a053c` | `workspace_brand_link_missing` | medium | Populate `workspace_registry.linked_brand_key` or add one active `tenant_brand_links` row after canonical brand ownership is confirmed. |
| `792029d2-4f62-4994-8dca-00417e90438d` | `0ff599ae-77d5-11f1-9a4d-d342cf4a053c` | `workspace_brand_link_missing` | medium | Populate `workspace_registry.linked_brand_key` or add one active `tenant_brand_links` row after canonical brand ownership is confirmed. |
| `1e673d38-89a2-4872-a6b9-8bc937bd9503` | `0ff59ac4-77d5-11f1-9a4d-d342cf4a053c` | `workspace_brand_link_missing` | medium | Populate `workspace_registry.linked_brand_key` or add one active `tenant_brand_links` row after canonical brand ownership is confirmed. |
| `d7696384-ef5c-4d38-a90c-b17edaaf8c72` | `0ff59b5f-77d5-11f1-9a4d-d342cf4a053c` | `workspace_brand_link_missing` | medium | Populate `workspace_registry.linked_brand_key` or add one active `tenant_brand_links` row after canonical brand ownership is confirmed. |

## Non-goals

- Do not infer brand ownership from workspace display names alone.
- Do not add `tenant_id` directly to the global `brands` registry.
- Do not enable enforcement, promotion, or production activation as part of resolving these holds.
- Do not create a tenant-to-brand link unless the canonical brand target key is explicitly confirmed.

## Resolution checklist

Before closing these holds:

1. Confirm each tenant's canonical brand target key from an authoritative source.
2. Ensure exactly one active mapping exists per affected tenant when using `tenant_brand_links`.
3. Re-run `dynamic_container_projection_dry_run`.
4. Confirm `heldIssueCount` is reduced or any remaining hold is explicitly documented.
5. Confirm `highRiskIssueCount` remains `0`.
6. Confirm readiness remains `ready_for_review` and enforcement remains disabled until separately authorized.
