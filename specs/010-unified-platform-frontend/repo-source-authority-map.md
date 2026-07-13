# Repository Source Authority Map

This map defines what the frontend planner may trust, how conflicts are resolved, and which changes invalidate an existing dispatch plan. A hand-written screen list is never authoritative by itself.

## Precedence

| Rank | Authority | Repository sources | Planner use | Drift effect |
|---|---|---|---|---|
| A0 | Constitutional and completion policy | `.specify/memory/constitution.md`, `.specify/spec-kit-governance.json` | tenant isolation, secret boundaries, completion rules | block all dispatch |
| A1 | Mounted runtime topology | `http-generic-api/routes/index.js`, imported mounted route files | discover reachable route families and mount order | re-discover and invalidate affected tasks |
| A2 | HTTP contract authority | `http-generic-api/openapi.yaml`, `openApiEndpointInventorySync.js`, `scripts/openapi-route-coverage.mjs` | method/path contracts and missing-contract gates | block affected family |
| A3 | Logical resource authority | `resource-api-coverage.manifest.json`, Resource API routes/audit | scope, operations, permissions, changes, revisions, readback | block resource UI or mutation |
| A4 | Data and governed-surface authority | migrations, activation surface manifests, surface-contract discovery outputs | discover new tables/views/tools/policies and evidence requirements | add or reclassify work |
| A5 | Runtime boundary and generated maps | `runtime_boundary_map.md`, `docs/folder-map.md`, `docs/work-maps/*` | ownership, dependencies, runtime boundaries | re-score dependency graph |
| A6 | Existing browser surfaces | `public/connect/*`, Local Manager route HTML/assets, onboarding assets | compatibility and visual-token inputs | create parity/cutover work |
| A7 | Verification authority | `scripts/test-manifest.mjs`, route/contract/resource/security tests | test ownership and executable acceptance gates | block ready state |

## Conflict rules

1. A lower-ranked source cannot relax an A0 rule.
2. A route is considered live only when mounted by A1. An OpenAPI-only path is cataloged as contract-only until mounted.
3. A mounted route missing from A2 is an OpenAPI gap, not an implicit exemption.
4. A resource-like UI must use A3 descriptors. Raw table discovery never authorizes browser access.
5. Generated maps explain structure but cannot override mounted runtime or contracts.
6. Existing HTML proves compatibility surface presence; it does not prove unified frontend completion.
7. A family without an explicit test owner remains blocked.

## Baseline contract

Every generated plan records:

- base branch and commit SHA;
- SHA-256 for each input authority file;
- mounted route file and mount order;
- normalized method/path signatures;
- policy version and matching decision;
- generated task dependencies and gates.

Before dispatch, the planner recomputes the authority digest. A changed digest moves affected tasks to `drifted`; they must be regenerated, not patched manually.

## Manual input boundary

`http-generic-api/frontend-surface-policy.json` is the only manual classification input. It may decide `unified_ui`, `api_only`, `internal_only`, `legacy_compatibility`, or `deferred`, with an owner and rationale. It cannot invent a route, weaken authentication, hide an OpenAPI gap, or mark an untested mutation complete.

## Coverage equation

A discovered family is covered only when all applicable terms are true:

`mounted × scoped × contracted × policy-decided × test-owned × auth-safe × readback-safe × evidence-linked × production-verified`

Any zero term keeps the family out of `complete`.
