# Frontend Dispatch Coverage Baseline

**Baseline ref**: `c734cfab028265db8ff55ce1e31364b08793dbe7`  
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 126 |
| Scope/policy-split surface families | 155 |
| Mixed-scope route files | 22 |
| HTTP operations | 938 |
| Canonical OpenAPI operations | 532 |
| Generated auth-backed operation index | 389 |
| Explicit OpenAPI exemptions | 17 |
| Remaining OpenAPI operation-presence gaps | 0 |
| Generated operations still missing reviewed detail contracts | 389 |
| Explicitly test-owned operations | 7 |
| Operations without explicit test claims | 931 |
| Fully test-owned families | 1 |
| Families with test ownership gaps | 154 |
| Ready tasks | 1 |
| Blocked tasks | 154 |

The inventory includes optional dynamically imported route builders, normalizes optional Express parameters, ignores commented legacy registrations, and splits route families at explicit surface-policy and auth boundaries. Generated Custom GPT projections and the runtime operation index are excluded from canonical detail coverage: they supply projection or presence/auth evidence only and never count as reviewed request/response contracts.

## Auth and operation governance

| Metric | Count |
|---|---:|
| Runtime/OpenAPI auth equivalent | 921 |
| Explicit auth exemptions | 17 |
| Auth mismatches | 0 |
| Missing OpenAPI for auth comparison | 0 |
| Runtime auth unresolved | 0 |
| Non-GET operation candidates | 569 |
| Explicitly classified state changes | 4 |
| Explicitly classified non-mutating actions | 9 |
| Non-GET candidates awaiting classification | 556 |
| Fully governed state changes | 0 |

Exact auth rules now cover handler-level, imported-handler, public bootstrap, connector bearer, and signed-query-token cases. They cannot weaken a statically discovered guard: a conflicting rule fails closed. The four classified resource mutations have proven same-cycle repository readback, but remain blocked on failure rollback/post-commit compensation; the baseline does not convert readback evidence into a rollback claim.

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 98 |
| Tenant | 19 |
| Local device | 6 |
| Developer | 5 |
| Public | 14 |
| Unresolved | 13 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 13 |
| F1 tenant shell | 33 |
| F3 admin workspaces | 98 |
| F4 Local Manager | 6 |
| F5 developer/evidence | 5 |

F2 Admin BFF and F6 cutover are shared dependency work rather than route-family counts.

## Active blockers

| Blocker | Families |
|---|---:|
| Surface policy decision required | 145 |
| Runtime/OpenAPI auth contract gap | 0 |
| Operation classification gap | 125 |
| OpenAPI operation-presence gap | 0 |
| OpenAPI detail-contract gap | 73 |
| Mutation rollback/compensation gap | 1 |
| Scope unresolved | 13 |
| Test ownership gap | 154 |

Counts overlap because one family may have multiple blockers. Mutation controls and auth parity are operation-level even when the task view aggregates them by family. Test ownership requires an explicit `frontend-surface-operation` claim in a registered test. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 113 |
| High | 23 |
| Medium | 16 |
| Low | 3 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
