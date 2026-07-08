# SQL Cache Resilience — Implemented Historical Record

Status: **Implemented / Historical**  
Original design branch: `gpt/006-sql-cache-resilience-20260628`  
Original PR: #1940 — closed as superseded, not merged

This directory preserves the durable design intent of the SQL cache resilience work after implementation and production verification. It is not an active task plan and must not be used as evidence that rollout work remains pending.

## Maintained documents

- `implemented-specification.md` — the curated historical requirements, implemented architecture, and evidence map.
- [`docs/runbooks/sql-cache-operations.md`](../../runbooks/sql-cache-operations.md) — the current operational authority for policy reads and updates, diagnostics, rollback, migration authorization, and incident response.

## Implemented delivery record

| PR | Delivered outcome | Merge commit |
| --- | --- | --- |
| #1954 | MySQL-primary SQL cache runtime policy and revision-guarded policy management | `a479e759a42cdeccae1375449e2d21d6105049bd` |
| #1950 | Governed Admin tool export and read-only wrapper support | `29f5cde5dc624fc197cb2c9c32eda606bf3637f2` |
| #2008 | Repair of the Admin tool migration JSON contract | `4bb2049a9e318de0e12599c61a2930e9dcded215` |
| #2015 | Guarded checksum reauthorization for reviewed, unapplied migrations | `2761bcd4fa6ae9b47ae1a4d49198bfece661803f` |
| #2021 | Runtime diagnostics, isolated load testing, redacted migration failures, alerts, tests, and runbook | `060224424d9b472586b8d2248be4cf2fe3aa8ef9` |
| #2025 | Explicit same-cycle readback policy for operational-alert mutations | `0158e11a6f5d487f4acdfc23c8feffdf582bba1e` |
| #2028 | Removal of false truncation for the singleton SQL cache runtime alert source | `d16c1aff0021a360eb845096863f10f36a818981` |

## Historical production verification

The following is a point-in-time verification snapshot from July 1, 2026. It is historical evidence, not a substitute for reading current runtime state.

- Runtime policy source: `mysql_primary`
- Policy stale state: `false`
- Immutable security denylist includes: `endpoints`
- SQL cache diagnostics state: `healthy`
- Observed hit ratio: `52.54%`
- Observed runtime cache errors: `0`
- Controlled isolated benchmark: 120 baseline loader calls reduced to 1 cached loader call
- Controlled loader-call reduction: `99.17%`
- Benchmark touched production Redis: `false`
- Benchmark touched production MySQL: `false`
- Operational-alert sync: `completed`
- Operational-alert result completeness: `true`
- Truncated alert sources: none

Migration evidence for the SQL cache Admin tool export was recorded in `governed_migration_ledger` under run ID `1784d75d-5d57-4ce2-81a3-a3ff64513213` with checksum `c503df8476680e4fbb67f4c0aeaa031bf8a94c8fcd2dbdaa2f683b406a8f6798`.

## Intentionally excluded legacy artifacts

The original branch remains available as historical Git context, but the following stale artifacts are intentionally not copied to `main`:

- `completion.json`
- `tasks.md`
- old implementation and release-readiness checklists
- the generated `docs/auto-docs-agent/pr-1940.md` file
- the original phase plan that described completed rollout work as pending

Future changes must update the current runbook, implementation tests, canonical observability guidance, and relevant governed migrations rather than reviving the obsolete task plan.
