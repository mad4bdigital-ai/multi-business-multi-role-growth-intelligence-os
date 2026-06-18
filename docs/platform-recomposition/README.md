# Platform Recomposition

This directory preserves the design evidence, clean-room overlays, and promotion records used to move the platform from workbook-era assumptions to SQL-primary runtime authority.

## Authority boundary

- Runtime authority lives in SQL registries, runtime code, active schemas, and canonical source files under `canonicals/`.
- Root canonical markdown files are generated indexes.
- Files in this directory are design evidence or promotion references. They are not runtime authority unless an active canonical, schema, runtime module, migration, and validation test implements the same contract.
- Historical review files keep the evidence available at the time they were written. Later checkpoints override their status statements without rewriting their original evidence.

## Current status

- Schema cleanup phases S1-S5 are complete.
- Root `memory_schema.json` is the promoted SQL-first memory/state contract.
- `memory_schema.clean-v1.json` is retained as the staging-source snapshot. It must remain semantically equal to the promoted root schema after resolving its directory-relative `$ref` paths.
- Runtime registry reads are SQL-primary. Google Sheets are async mirror, diagnostics, recovery, or explicit user-facing artifact surfaces only.
- The active follow-up register is [current-state-checkpoint-2026-06-06.md](current-state-checkpoint-2026-06-06.md).

## Document register

| File | Classification | Current role |
|---|---|---|
| `README.md` | active index | Authority boundary, lifecycle, and document register. |
| `current-state-checkpoint-2026-06-06.md` | active checkpoint | Current promoted state, verified evidence, and remaining recomposition work. |
| `schema-cleanup-and-promotion-plan-2026-05-28.md` | completed promotion record | Records completed S1-S5 schema/runtime cleanup and follow-up boundaries. |
| `memory_schema.clean-v1.json` | promoted staging snapshot | Source snapshot for root `memory_schema.json`; directory-relative refs are expected. |
| `system_bootstrap.clean-v1.md` | reference overlay | Consolidated desired bootstrap contract; use active canonicals/runtime for enforcement status. |
| `module_loader.clean-v1.md` | reference overlay | Consolidated desired loader contract and unresolved deterministic workflow-selection requirement. |
| `prompt_router.clean-v1.md` | reference overlay | Consolidated desired routing contract and blocked/degraded behavior. |
| `direct_instructions_registry_patch.clean-v1.md` | reference overlay | Consolidated authority and promotion guard rules. |
| `runtime-sheet-evidence-removal-note.md` | completed decision note | Records removal of Sheets fallback/evidence from governed runtime registry reads. |
| `drive-workbooks-review-2026-05-18.md` | historical review | Point-in-time workbook inventory and classification evidence. |
| `local-development-review-2026-05-18.md` | historical review | Point-in-time review of local design documents and extracted platform concepts. |
| `local-gateway-tools-design-2026-05-18.md` | historical design | Gateway registry and routing design snapshot. |
| `local-connector-autoreconnect-and-desktop-manager-2026-05-18.md` | evolving implementation record | Local connector rollout history and remaining operational follow-ups. |
| `tenant-execution-surface-containment-2026-06-18.md` | active containment record | Tenant discovery/dispatch denylist, strict runtime preview validation, and canonical Repository Intelligence descriptors. |
| `../growth-intelligence-platform-architecture.md` | active architecture | Defines the first value-producing Tenant/Brand Growth Intelligence workflow and authority boundaries. |
| `../sequential-plan-orchestration-architecture.md` | active architecture | Defines durable plan compilation, atomic sequential execution, approval stops, checkpoints, and resume behavior. |
| `../growth-intelligence-operational-runbook.md` | active runbook | Defines baseline, warning/failure response, pilot checks, and recovery evidence. |
| `../release-train-policy.md` | active release policy | Separates governance, runtime, product workflow, and provider-capable release lanes. |

## Promotion lifecycle

For every promoted design point, update the full implementation stack:

1. Canonical source under `canonicals/`.
2. Generated root canonical with `node build-canonicals.mjs`.
3. Schema and manifest when state shape changes.
4. Runtime enforcement wiring.
5. SQL registry/table alignment.
6. Validation and readback tests.
7. Release-readiness evidence.
8. This directory's checkpoint and document register.

Do not promote a reference overlay by copying it over an active canonical. Promote individual decisions through the lifecycle above.
Agent governance runtime: `../agent-governance-runtime-architecture.md` defines internal-first research, presentation-only response profiles, opaque handoffs, prompt quarantine, and skill coverage.
