<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **warn** |
| Blocking gaps | 0 |
| Warning or informational gaps | 2 |
| Input fingerprint | `875258df0fb2046ad5d31988ad0dd24463ee14034ef840514b3317b17c514a28` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | 7,153 |
| Inventory bytes | 69,823,935 |
| Workflows | 167 |
| Workflows without explicit permissions | 0 |
| Broad write permission matches | 0 |
| Unpinned action references | 0 |
| Automation overlap check | not-run |
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
| `inventory-check` | not-run | — |
| `inventory-selftest` | not-run | — |
| `typecheck` | not-run | — |
| `root-tests` | not-run | — |
| `automation-overlap` | not-run | — |

## Gaps

| Gap | Domain | Severity | Status | Lifecycle | Blocking |
|---|---|---|---|---|---|
| `AUTO-CI-SURFACE-SIZE` | maintainability | low | open | new | no |
| `MAINT-LARGE-TRACKED-FILES` | maintainability | low | open | new | no |

## Loop contract

The loop reads the Git index-backed inventory, runs the configured checks, generates stable gap identifiers, optionally compares a baseline, and verifies its outputs with npm run evaluation:check. npm run evaluation:test validates deterministic generation and the report schema.
