# Validation Repair Policy Router

## Purpose

This phase restores `validation_repair` as an executable runtime registry, not just a migrated audit table.

The first integration enriches Brand Core agent-loop blocks with repair candidates from SQL `validation_repair`.

## Runtime module

```text
http-generic-api/repairPolicyRouter.js
```

Exports:

```text
resolveRepairCandidates(...)
resolveBrandCoreRepairCandidates(...)
```

## Authority chain

Before reading `validation_repair`, the router verifies the surface authority of:

```text
surface.validation_and_repair_registry_sheet
```

via:

```text
resolveSurfaceAuthority(SURFACE_KEYS.VALIDATION_REPAIR_REGISTRY, { requireExecution: true })
```

This means repair routing depends on `registry_surfaces_catalog` just like policy loading now depends on the Execution Policy Registry surface.

## First integration

`governedExecutionPreflight.evaluateAgentLoopPreflight(...)` now does this when the Brand Core blocking policy fires:

```text
brand_writing_requires_brand_core
→ resolveBrandCoreRepairCandidates(brandKey)
→ evidence.repair_policy
```

The block still happens, but the response includes actionable repair routing evidence.

## Secret-free repair evidence

Returned repair candidates include only runtime metadata:

- `validation_id`
- `entity_key`
- `surface_id`
- `surface_name`
- `rule_id`
- `validation_target`
- `validation_type`
- `validation_status`
- `result_state`
- `repair_action`
- `repair_handler`
- `repair_stage`
- `repair_owner`
- `repair_required`
- `repair_recommended`
- `repair_status`
- `readback_required`
- `priority`
- `severity`
- `execution_readiness_status`
- `updated_at`
- `score`
- `secrets_included: false`

Raw notes, secrets, file IDs, folder IDs, and raw document content are not returned.

## Brand Core repair mapping

The router maps:

```text
brand_writing_requires_brand_core
→ add_brand_core_assets
```

It then searches `validation_repair` for the matching brand and Brand Core surface.

## Why this matters

The old Workbook/Sheet governance expected Validation & Repair Registry to drive recovery routing and repair classification. After migration to SQL, the table existed but most runtime paths did not consume it for actionable repair routing.

This phase makes `validation_repair` visible at the point where a policy blocks execution, starting with Brand Core-first enforcement.

## Next targets

- Surface authority failures → repair_surface_authority
- Readback failures → repair_readback
- App action failures → adapter-specific repair candidates
- Connector route failures → connector route repair candidates
- Execution log write failures → execution evidence repair candidates
