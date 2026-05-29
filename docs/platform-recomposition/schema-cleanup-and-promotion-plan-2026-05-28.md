# Schema cleanup and promotion plan — 2026-05-28

## Purpose

This plan tracks the cleanup from workbook-era memory/schema contracts to the SQL-first clean schema model.

The repository had two conflicting states:

1. Root `memory_schema.json` was invalid JSON and still contained workbook/sheet-era assumptions.
2. `docs/platform-recomposition/memory_schema.clean-v1.json` already staged a cleaner SQL-first contract, but it was not promoted.

## Current promotion decision

Promote `docs/platform-recomposition/memory_schema.clean-v1.json` to root `memory_schema.json` with root-relative `$ref` paths.

Promoted root schema requirements:

```text
data_source_state.runtime_authority = sql
data_source_state.sheets_role = async_mirror_and_recovery
data_source_state.sheets_required_for_runtime = false
```

This establishes the root memory schema as SQL-first and makes Sheets/Drive diagnostic and recovery surfaces only.

## Why not copy everything blindly

The platform still contains older domain schemas in `schemas/*.schema.json`. Some of those definitions preserve workbook-era terms such as:

```text
sheet
spreadsheet
worksheet_gid
workbook
gid
source_sheet
```

Not every occurrence has the same severity:

- Some are historical audit metadata and may remain as recovery evidence.
- Some are still referenced by active root schema `$ref` entries and must be cleaned or reclassified.
- Some live in unused or legacy definitions and should be deprecated in a later focused phase.

## Immediate cleanup scope

The first safe promotion scope is:

1. Replace invalid root `memory_schema.json` with the clean SQL-first schema.
2. Keep the root under the 45 KB validation limit.
3. Ensure root `$ref` entries resolve through `schemas/`.
4. Clean governance rules that still describe `worksheet_gid` or Registry Workbook surfaces as runtime authority.
5. Document remaining workbook-era schema cleanup as follow-up work.
6. Run `node validate-memory-schema.mjs` and CI.

## Remaining schema cleanup inventory

The following areas require staged cleanup after the root schema promotion lands:

| File | Legacy term class | Cleanup direction |
|---|---|---|
| `schemas/execution.schema.json` | `googleWorkspaceExecutionState`, `registryBinding`, `worksheet_gid`, spreadsheet write proof | Split Google Workspace diagnostics/recovery from SQL runtime validation; replace runtime authority names with SQL registry keys. |
| `schemas/governance.schema.json` | governance rules, sheet/header/column validation wording | Keep schema drift concepts but make SQL table contracts primary; workbook headers become mirror/recovery checks only. |
| `schemas/operations.schema.json` | active sheet bindings, dependency worksheet, operations log sheet names | Rename active runtime bindings to SQL table/registry bindings; preserve sheet fields as recovery metadata. |
| `schemas/analytics.schema.json` | `source_sheet`, workbook-derived score terminology | Reclassify source sheet as legacy evidence or replace with SQL/warehouse source references. |
| `schemas/repair_audit.schema.json` | direct_sheet, cluster writeback to workbook stage | Reclassify direct sheet modes as import/recovery modes; SQL repair tables remain primary. |
| `schemas/wordpress_api.schema.json` | brand playbook sheet gid | Move to asset registry / brand core asset key; retain sheet gid only as legacy import metadata. |
| `schemas/business_identity.schema.json` | file_type spreadsheet, gid | Clarify as document/file metadata, not runtime authority. |

## Promotion phases

### Phase S1 — Root schema promotion

Status: in progress.

Deliverables:

```text
memory_schema.json valid JSON
root schema SQL-first
root schema references clean or intentionally staged domain schemas
platform-recomposition README updated
CI validation green
```

### Phase S2 — Governance and execution schema cleanup

Status: in progress.

Clean the definitions that directly influence runtime validation:

```text
governance_rules
runtimeValidation
registryBinding
writeProof
authoritativeWriteTargets
googleWorkspaceExecutionState
```

Expected result:

```text
SQL registry keys are primary
Drive/Sheets checks are diagnostic/recovery only
worksheet_gid and spreadsheet ids are not runtime binding authority
execution authoritative write targets are SQL tables: execution_log, output_artifacts, sink_dispatch_log, agent_chain_events
```

S2 implemented changes:

```text
registryBinding now uses registry_source / registry_table / registry_row_id / binding_key
writeProof now uses target_table / target_primary_key / target_row_id
legacy spreadsheet/gid evidence moved under legacy_mirror_* fields
authoritativeWriteTargets now defaults to SQL tables instead of *_sheet targets
governance patch parity evidence source now defaults to table.execution_log
```

### Phase S3 — Operations and repair schema cleanup

Status: in progress.

Clean operational/audit naming:

```text
systemContext.active_sheet_bindings
canonical dependency worksheet metadata
repair direct_sheet modes
operations log sheet references
```

Expected result:

```text
SQL execution_log / audit_log / output_artifacts / sink_dispatch_log / agent_chain_events are primary
workbook fields are legacy_mirror_* or recovery_* only
```

S3 implemented changes:

```text
systemContext.active_sheet_bindings renamed to active_sql_registry_bindings
legacy_mirror_sheet_bindings added for mirror/recovery evidence
approved_registry_tabs renamed to approved_registry_tables
registry_workbook split into registry_database + legacy_registry_workbook_mirror
operations_workbook_binding split into operations_database_binding + legacy_operations_workbook_mirror
repair cluster_source_mode direct_sheet renamed to recovery_mirror_import
```

### Phase S4 — Analytics, WordPress, and asset schema cleanup

Status: in progress.

Clean source-specific remnants:

```text
source_sheet
brand_playbook_sheet_gid
spreadsheet file metadata
gid fields
```

Expected result:

```text
warehouse/source connector/brand core asset keys are primary
sheet ids remain optional import/recovery metadata only
```

S4 implemented changes:

```text
analytics score signals use source_registry_table / source_connector_key
analytics source_sheet retained only as legacy_mirror_sheet_name
WordPress preflight uses brand_playbook_asset_key as primary
brand_playbook_sheet_gid renamed to legacy_brand_playbook_sheet_gid
operations logging_surface uses SQL execution_log table
operations workbook runtime remnants reclassified as legacy_operations_workbook_runtime_mirror
business identity source_registry uses registry_source / registry_table / registry_row_id
business identity spreadsheet metadata moved to legacy_mirror_* fields
```

### Phase S5 — Runtime enforcement alignment

Status: in progress.

After schema cleanup, confirm runtime enforcement uses the same model:

```text
governanceValidationEngine
execution readiness dry-run
output sink router
local connector dispatch
policy approval holds
schema validation tests
```

S5 implemented changes:

```text
readGovernedSheetRecords is now a SQL-first compatibility wrapper
Brand Registry and Hosting Account Registry reads use sqlAdapter/readTable by default
legacy Google Sheets fallback is disabled unless LEGACY_SHEET_REGISTRY_RUNTIME_ENABLED or allowLegacySheetRegistryRead=true is set
hostingerSshRuntimeRead reports table.hosting_accounts as authoritative_source
legacy sheet names are returned only as legacy_mirror_source
new tests cover SQL-first registry resolution and disabled legacy fallback
```

Compatibility note:

```text
Some registry surface ids still contain historical names such as surface.operations_log_unified_sheet.
Those ids are database identity keys and must be migrated separately with registry row aliases/replacement ids before code constants are renamed.
They no longer imply workbook runtime authority after S1-S5.
```

## Non-goals for S1

S1 does not rewrite all historical schemas in one PR. Large semantic rewrites should remain small, reviewable, and tested.

S1 also does not remove governed Drive/Sheets provider probes from activation. They remain connectivity evidence only, not runtime authority.

## Validation checklist

Before merging S1:

```text
node validate-memory-schema.mjs
npm test where applicable
search root memory_schema.json for invalid legacy required blocks
search active referenced governance rules for worksheet_gid authority wording
confirm platform-recomposition README marks clean schema promoted
confirm CI green
```

Before merging S2-S4:

```text
search schemas/ for sheet/spreadsheet/worksheet_gid/workbook/gid
classify each occurrence as runtime-authority, recovery metadata, or legacy dead definition
update tests and docs with each schema semantics change
```
