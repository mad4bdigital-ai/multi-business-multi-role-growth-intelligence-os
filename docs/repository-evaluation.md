<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **warn** |
| Blocking gaps | 0 |
| Warning or informational gaps | 2 |
| Input fingerprint | `cb5c9d8385e4b09cb20a73259e4cecb223ed48f2a79c8268b9e91118922d0cc1` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | 7,217 |
| Inventory bytes | 70,408,203 |
| Workflows | 170 |
| Workflows without explicit permissions | 0 |
| Broad write permission matches | 0 |
| Unpinned action references | 0 |
| Automation overlap check | passed |
| Workflow budget | 100 |
| Workflow budget warning | 155 |
| Workflow budget status | exceeded |
| Unapproved large files | 2 |
| Suspected secret files | 0 |
| Dependency audit mode | not-run |
| CI dependency audit contract | required |
| .NET availability | contracted |

## Checks

| Check | Status | Exit code |
|---|---|---:|
| `inventory-check` | passed | 0 |
| `inventory-selftest` | passed | 0 |
| `typecheck` | passed | 0 |
| `root-tests` | passed | 0 |
| `automation-overlap` | passed | 0 |

## Gaps

| Gap | Domain | Severity | Status | Lifecycle | Blocking |
|---|---|---|---|---|---|
| `AUTO-CI-SURFACE-SIZE` | maintainability | low | open | new | no |
| `MAINT-LARGE-TRACKED-FILES` | maintainability | low | open | new | no |

## Loop contract

The loop reads the Git index-backed inventory, runs the configured checks, generates stable gap identifiers, optionally compares a baseline, and verifies its outputs with npm run evaluation:check. npm run evaluation:test validates deterministic generation and the report schema.
