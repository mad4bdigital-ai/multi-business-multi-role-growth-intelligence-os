# Platform Recomposition Staging

This directory contains clean-room staging copies for rebuilding the Growth Intelligence Platform instructions and runtime contracts without overwriting the current generated canonicals or live schemas.

## Status

- Created as a non-destructive staging area.
- Files here are not runtime authority until explicitly promoted.
- Root canonical files remain generated indexes.
- Promotion requires updating canonical sources, schema manifests, runtime code, SQL registry rows, and validation checks together.

## Staged files

| File | Purpose |
|---|---|
| `memory_schema.clean-v1.json` | Valid clean draft of the memory/state schema with the missing output/sink/chain/local connector state blocks restored. |
| `system_bootstrap.clean-v1.md` | Clean runtime contract overlay for SQL-first activation, validation, agent execution, sinks, local connector, and workbook recovery roles. |
| `module_loader.clean-v1.md` | Clean loader contract overlay for dependency loading, governed context, schema resolution, and runtime wiring. |
| `prompt_router.clean-v1.md` | Clean routing contract overlay for intent resolution, task routes, validation states, and execution handoff. |
| `direct_instructions_registry_patch.clean-v1.md` | Clean direct-instruction overlay for authority, compatibility, and repair-first behavior. |
| `drive-workbooks-review-2026-05-18.md` | Drive workbook inventory and review status for the Production folder. |

## Promotion rule

Do not copy these files into runtime blindly. For every promoted point, apply the full stack:

1. Canonical source update under `canonicals/`.
2. Generated root rebuild with `node build-canonicals.mjs`.
3. Schema/manifest update when state shape changes.
4. Runtime enforcement wiring.
5. SQL registry/table alignment.
6. Validation/readback tests.
7. Release-readiness evidence.
