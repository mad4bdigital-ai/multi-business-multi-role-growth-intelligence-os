<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **warn** |
| Blocking gaps | 0 |
| Warning or informational gaps | 6 |
| Input fingerprint | `1cecc631ad08e8fbda09fad0974e3ee88346c54de8ab017ef0921083150bf1de` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | 6,612 |
| Inventory bytes | 58,006,359 |
| Workflows | 150 |
| Workflows without explicit permissions | 2 |
| Broad write permission matches | 11 |
| Suspected secret files | 0 |
| Dependency audit mode | not-run |
| .NET availability | not-evaluated |

## Checks

| Check | Status | Exit code |
|---|---|---:|
| `inventory-check` | passed | 0 |
| `inventory-selftest` | passed | 0 |
| `typecheck` | passed | 0 |
| `root-tests` | passed | 0 |

## Gaps

| Gap | Domain | Severity | Status | Lifecycle | Blocking |
|---|---|---|---|---|---|
| `AUTO-CI-SURFACE-SIZE` | maintainability | low | open | new | no |
| `DEP-AUDIT-NOT-EVALUATED` | dependencies | medium | not-evaluated | new | no |
| `ENV-DOTNET-NOT-EVALUATED` | environment | medium | not-evaluated | new | no |
| `MAINT-LARGE-TRACKED-FILES` | maintainability | low | open | new | no |
| `SEC-CI-BROAD-WRITE` | security | medium | open | new | no |
| `SEC-CI-EXPLICIT-PERMISSIONS` | security | medium | open | new | no |

## Loop contract

The loop reads the Git index-backed inventory, runs the configured checks, generates stable gap identifiers, optionally compares a baseline, and verifies its outputs with npm run evaluation:check. npm run evaluation:test validates deterministic generation and the report schema.
