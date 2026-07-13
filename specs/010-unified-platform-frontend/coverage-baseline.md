# Frontend Dispatch Coverage Baseline

**Baseline ref**: `38febb72963ec3221dd0b2473d09be0ab6a65447`
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 124 |
| Scope-split surface families | 147 |
| Mixed-scope route files | 21 |
| HTTP operations | 924 |
| OpenAPI documented operations | 478 |
| OpenAPI gaps | 446 |
| Explicitly test-owned operations | 3 |
| Operations without explicit test claims | 921 |
| Fully test-owned families | 1 |
| Families with test ownership gaps | 146 |
| Ready tasks | 1 |
| Blocked tasks | 146 |

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 84 |
| Tenant | 18 |
| Local device | 5 |
| Developer | 3 |
| Public | 2 |
| Unresolved | 35 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 33 |
| F1 tenant shell | 20 |
| F3 admin workspaces | 84 |
| F4 Local Manager | 5 |
| F5 developer/evidence | 5 |

F2 Admin BFF and F6 cutover are shared dependency work rather than route-family counts.

## Active blockers

| Blocker | Families |
|---|---:|
| Surface policy decision required | 144 |
| OpenAPI contract gap | 86 |
| Mutation readback gap | 80 |
| Scope unresolved | 35 |
| Test ownership gap | 146 |

Counts overlap because one family may have multiple blockers. Test ownership now requires an explicit `frontend-surface-operation` claim in a registered test; the former filename heuristic was removed because it produced false readiness. The next dispatch cycle should resolve scope and product policy, add reviewed operation claims, then close contract and mutation readback gaps. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 129 |
| High | 12 |
| Medium | 5 |
| Low | 1 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
