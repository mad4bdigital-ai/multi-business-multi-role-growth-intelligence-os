<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **warn** |
| Blocking gaps | 0 |
| Warning or informational gaps | 2 |
| Input fingerprint | `3623dfea0b0208879f361772a1387738ea1e5b040a868feb139e05b24463b628` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | 7,063 |
| Inventory bytes | 67,687,079 |
| Workflows | 161 |
| Workflows without explicit permissions | 0 |
| Broad write permission matches | 0 |
| Unpinned action references | 0 |
| Automation overlap check | passed |
| Workflow budget | 160 |
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
