<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **pass** |
| Blocking gaps | 0 |
| Warning or informational gaps | 0 |
| Input fingerprint | `b268d2a4ed1078d4c8d56d991ec5e5eb0bbd817d9ea0d84f150327c4f987529b` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | 6,652 |
| Inventory bytes | 58,594,386 |
| Workflows | 150 |
| Workflows without explicit permissions | 0 |
| Broad write permission matches | 0 |
| Unpinned action references | 0 |
| Automation overlap check | passed |
| Workflow budget | 160 |
| Workflow budget warning | 155 |
| Workflow budget status | within-budget |
| Unapproved large files | 0 |
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
| none | — | — | — | — |

## Loop contract

The loop reads the Git index-backed inventory, runs the configured checks, generates stable gap identifiers, optionally compares a baseline, and verifies its outputs with npm run evaluation:check. npm run evaluation:test validates deterministic generation and the report schema.
