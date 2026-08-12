<!-- GENERATED FILE. Run npm run evaluation:write. Do not edit manually. -->
# Repository Evaluation

This report is generated from the dynamic Repository Inventory and deterministic evaluation rules. It classifies evidence-backed gaps; it does not apply code or dependency mutations automatically.

## Gate

| Metric | Value |
|---|---:|
| Decision | **pass** |
| Blocking gaps | 0 |
| Warning or informational gaps | 0 |
| Input fingerprint | `41eef65b1d1e65bd7631551fbf046d3d89661e3047a1b84272ee89ea84416e06` |

## Repository signals

| Signal | Value |
|---|---:|
| Inventory files | 6,661 |
| Inventory bytes | 58,685,034 |
| Workflows | 151 |
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
