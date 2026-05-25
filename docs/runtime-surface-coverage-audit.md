# Runtime Surface Coverage Audit

## Purpose

The Runtime Surface Coverage Audit is a non-mutating diagnostic for the SQL-primary registry migration. It identifies which legacy Workbook/Sheet registry surfaces have been migrated into SQL but have not yet regained their full runtime enforcement role in the current JavaScript execution stack.

This closes the gap between the older governance canonicals (`prompt_router`, `module_loader`, `system_bootstrap`, and direct instruction patches) and the current JS runtime.

## Why this exists

The platform now treats SQL as runtime authority and Google Sheets as async mirror/recovery. The data migration succeeded for the major registry surfaces, but some surfaces are still used mainly as registry memory, readiness evidence, or diagnostics rather than active execution gates.

The audit makes that gap explicit before we add enforcement.

## Covered surfaces

P0 runtime authority surfaces:

- `execution_policies`
- `registry_surfaces_catalog`
- `validation_repair`
- `task_routes`
- `workflows`
- `actions`
- `endpoints`

P1 context authority surfaces:

- `brand_core`
- `brand_paths`
- `business_activity_types`
- `business_type_profiles`

P2 site and provider preflight surfaces:

- `hosting_accounts`
- `site_runtime_inventory`
- `site_settings_inventory`
- `plugins`

P3 evidence and memory surfaces:

- `json_assets`
- `execution_log`

## Governed Canonical Agent Runtime bridge

The audit also records the target architecture for Anthropic/Claude-style model logic. The intended direction is not to clone any third-party harness. The direction is to build a governed canonical agent runtime inside the platform:

- provider adapters
- canonical content-block message protocol
- streaming event normalizer
- deferred tool search
- governed tool-use loop
- runtime policy loader
- surface authority resolver
- repair policy router
- pre-tool and post-tool hooks
- session compaction
- usage and cost ledger

The legacy registry surfaces become the authority chain for that loop:

- `execution_policies` drives blocking/degraded policy classification.
- `actions`, `endpoints`, and `workflows` drive tool manifest and executable authority.
- `task_routes`, business profiles, and brand paths drive prompt routing and context gates.
- `registry_surfaces_catalog` drives read/write surface authority.
- `validation_repair` drives repair routing and readback requirements.
- `execution_log` and `json_assets` capture durable evidence and memory.

## Tooling

The script is available at:

```text
http-generic-api/scripts/runtime-surface-coverage-audit.mjs
```

It is exposed through the built-in admin shell alias:

```text
runtime_surface_coverage_audit
```

Recommended calls:

```text
admin_control shell run runtime_surface_coverage_audit --json
admin_control shell run runtime_surface_coverage_audit --markdown
```

The script is read-only and returns `secrets_included: false`.

## Next phase

The next implementation phase should add `runtimePolicyLoader` and `governedExecutionPreflight`, then wire the first blocking policy to repo/GitHub mutation flows:

- `repo_patch_apply`
- `github pr merge`
- branch delete

A first policy candidate is `Repository Mutation Governance / Stale Duplicate Branch Merge Guard` in `execution_policies`.
