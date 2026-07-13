# Frontend Dispatch Coverage Baseline

**Baseline ref**: `38febb72963ec3221dd0b2473d09be0ab6a65447`
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 124 |
| Scope-split surface families | 149 |
| Mixed-scope route files | 23 |
| HTTP operations | 924 |
| Canonical OpenAPI operations | 502 |
| Generated auth-backed operation index | 299 |
| Explicit OpenAPI exemptions | 24 |
| Remaining OpenAPI operation-presence gaps | 99 |
| Generated operations still missing reviewed detail contracts | 299 |
| Explicitly test-owned operations | 7 |
| Operations without explicit test claims | 917 |
| Fully test-owned families | 1 |
| Families with test ownership gaps | 148 |
| Ready tasks | 1 |
| Blocked tasks | 148 |

The historical `446` value counted route occurrences as if `openapi.yaml` were the only contract source. The corrected model resolves complete OpenAPI documents under `openapi/`, counts approved exemptions separately, and generates only high-confidence operation/auth indexes. Generated indexing is not treated as request/response schema completion.

## Auth and operation governance

| Metric | Count |
|---|---:|
| Runtime/OpenAPI auth equivalent | 471 |
| Explicit auth exemptions | 24 |
| Auth mismatches | 157 |
| Missing OpenAPI for auth comparison | 99 |
| Runtime auth unresolved | 173 |
| Non-GET operation candidates | 564 |
| Explicitly classified state changes | 4 |
| Explicitly classified non-mutating actions | 3 |
| Non-GET candidates awaiting classification | 557 |
| Fully governed state changes | 0 |

The four classified resource mutations have proven same-cycle repository readback. They remain blocked on failure rollback/post-commit compensation; the baseline does not convert readback evidence into a rollback claim.

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 91 |
| Tenant | 20 |
| Local device | 5 |
| Developer | 4 |
| Public | 2 |
| Unresolved | 27 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 26 |
| F1 tenant shell | 22 |
| F3 admin workspaces | 91 |
| F4 Local Manager | 5 |
| F5 developer/evidence | 5 |

F2 Admin BFF and F6 cutover are shared dependency work rather than route-family counts.

## Active blockers

| Blocker | Families |
|---|---:|
| Surface policy decision required | 144 |
| Runtime/OpenAPI auth contract gap | 70 |
| Operation classification gap | 123 |
| OpenAPI operation-presence gap | 10 |
| OpenAPI detail-contract gap | 65 |
| Mutation rollback/compensation gap | 1 |
| Scope unresolved | 27 |
| Test ownership gap | 148 |

Counts overlap because one family may have multiple blockers. Mutation controls and auth parity are operation-level even when the task view aggregates them by family. Test ownership requires an explicit `frontend-surface-operation` claim in a registered test. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 124 |
| High | 21 |
| Medium | 3 |
| Low | 1 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
