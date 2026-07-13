# Frontend Dispatch Coverage Baseline

**Baseline ref**: `e383cf3ffb830f63351407ba0b7386e240ec8e11`  
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 122 |
| Scope-split surface families | 146 |
| Mixed-scope route files | 21 |
| HTTP operations | 910 |
| OpenAPI documented operations | 445 |
| OpenAPI gaps | 465 |
| Test-owned families | 113 |
| Families without mapped tests | 33 |
| Ready tasks | 2 |
| Blocked tasks | 144 |

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 83 |
| Tenant | 18 |
| Local device | 5 |
| Developer | 4 |
| Public | 1 |
| Unresolved | 35 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 33 |
| F1 tenant shell | 19 |
| F3 admin workspaces | 83 |
| F4 Local Manager | 5 |
| F5 developer/evidence | 6 |

F2 Admin BFF and F6 cutover are shared dependency work rather than route-family counts.

## Active blockers

| Blocker | Families |
|---|---:|
| Surface policy decision required | 130 |
| OpenAPI contract gap | 91 |
| Mutation readback gap | 80 |
| Scope unresolved | 35 |
| Test ownership gap | 33 |

Counts overlap because one family may have multiple blockers. The next dispatch cycle should first resolve scope and product policy, then contract/test ownership, then mutation readback. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 112 |
| High | 18 |
| Medium | 13 |
| Low | 3 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
