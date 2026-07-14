# Frontend Dispatch Coverage Baseline

**Baseline ref**: `c734cfab028265db8ff55ce1e31364b08793dbe7`  
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 126 |
| Scope/policy-split surface families | 153 |
| Mixed-scope route files | 23 |
| HTTP operations | 939 |
| Canonical OpenAPI operations | 511 |
| Generated auth-backed operation index | 304 |
| Explicit OpenAPI exemptions | 24 |
| Remaining OpenAPI operation-presence gaps | 100 |
| Generated operations still missing reviewed detail contracts | 304 |
| Explicitly test-owned operations | 7 |
| Operations without explicit test claims | 932 |
| Fully test-owned families | 1 |
| Families with test ownership gaps | 152 |
| Ready tasks | 1 |
| Blocked tasks | 152 |

The inventory now includes optional dynamically imported route builders and splits route families at explicit surface-policy subpath boundaries. The generated runtime operation index is excluded from canonical OpenAPI coverage: it supplies presence/auth evidence only and never counts as a reviewed request/response contract.

## Auth and operation governance

| Metric | Count |
|---|---:|
| Runtime/OpenAPI auth equivalent | 476 |
| Explicit auth exemptions | 24 |
| Auth mismatches | 163 |
| Missing OpenAPI for auth comparison | 100 |
| Runtime auth unresolved | 176 |
| Non-GET operation candidates | 570 |
| Explicitly classified state changes | 4 |
| Explicitly classified non-mutating actions | 3 |
| Non-GET candidates awaiting classification | 563 |
| Fully governed state changes | 0 |

The four classified resource mutations have proven same-cycle repository readback. They remain blocked on failure rollback/post-commit compensation; the baseline does not convert readback evidence into a rollback claim.

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 93 |
| Tenant | 20 |
| Local device | 6 |
| Developer | 4 |
| Public | 3 |
| Unresolved | 27 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 26 |
| F1 tenant shell | 23 |
| F3 admin workspaces | 93 |
| F4 Local Manager | 6 |
| F5 developer/evidence | 5 |

F2 Admin BFF and F6 cutover are shared dependency work rather than route-family counts.

## Active blockers

| Blocker | Families |
|---|---:|
| Surface policy decision required | 144 |
| Runtime/OpenAPI auth contract gap | 74 |
| Operation classification gap | 124 |
| OpenAPI operation-presence gap | 11 |
| OpenAPI detail-contract gap | 66 |
| Mutation rollback/compensation gap | 1 |
| Scope unresolved | 27 |
| Test ownership gap | 152 |

Counts overlap because one family may have multiple blockers. Mutation controls and auth parity are operation-level even when the task view aggregates them by family. Test ownership requires an explicit `frontend-surface-operation` claim in a registered test. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 127 |
| High | 21 |
| Medium | 4 |
| Low | 1 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
