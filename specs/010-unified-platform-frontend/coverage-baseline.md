# Frontend Dispatch Coverage Baseline

**Baseline ref**: `7b71b014412102552326e78ca44e1143f977b6de`
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 129 |
| Scope/policy-split surface families | 158 |
| Mixed-scope route files | 21 |
| HTTP operations | 958 |
| Canonical OpenAPI operations | 562 |
| Generated auth-backed operation index | 380 |
| Explicit OpenAPI exemptions | 16 |
| Remaining OpenAPI operation-presence gaps | 0 |
| Generated operations still missing reviewed detail contracts | 380 |
| Explicitly test-owned operations | 30 |
| Operations without explicit test claims | 928 |
| Fully test-owned families | 4 |
| Families with test ownership gaps | 154 |
| Ready tasks | 1 |
| Blocked tasks | 157 |

The inventory includes optional dynamically imported route builders, expands optional Express parameters into both served path variants, expands `router.all` registrations across every governed HTTP method, ignores commented legacy registrations, and splits route families at explicit surface-policy and auth boundaries. Generated Custom GPT projections and the runtime operation index are excluded from canonical detail coverage: they supply projection or presence/auth evidence only and never count as reviewed request/response contracts. Fifteen session-insight read models now have reviewed request/response schemas; lifecycle status enums are checked against their persistence migrations, and thirty operations have explicit test ownership.

## Auth and operation governance

| Metric | Count |
|---|---:|
| Runtime/OpenAPI auth equivalent | 942 |
| Explicit auth exemptions | 16 |
| Auth mismatches | 0 |
| Missing OpenAPI for auth comparison | 0 |
| Runtime auth unresolved | 0 |
| Non-GET operation candidates | 582 |
| Explicitly classified state changes | 4 |
| Explicitly classified non-mutating actions | 32 |
| Non-GET candidates awaiting classification | 546 |
| Fully governed state changes | 0 |

Exact auth rules now cover handler-level, imported-handler, public bootstrap, connector bearer, signed-query-token, and multi-method root-discovery cases. They cannot weaken a statically discovered guard: a conflicting rule fails closed. Twelve newly mounted admin operations were synchronized to the runtime admin bearer/API-key alternatives, and canonical 401/403 bodies now match the shared runtime guards. The adapter-contract, target-adapter, adapter-apply-readiness, promotion-review, payload-preview-review, capability-envelope-plan, request-gate, dispatch-dry-run, actual-request-preflight, actual-request, approval, dispatch-readback, adapter-execution-gate, backlog-target-write, target-write-readback, and remaining-scope-completion POST filters are classified as SELECT-only read actions with canonical contracts and executable tests. Smoke-certification status, effective-policy resolution, and policy listing are also proven SELECT-only actions; adjacent certify and policy-upsert operations remain consequential. The actual-request, approval, dispatch-readback, adapter-execution-gate, backlog-write, and remaining-scope lifecycle status schemas accept every value permitted by their migrations. The four classified resource mutations have proven same-cycle repository readback, but remain blocked on failure rollback/post-commit compensation; the baseline does not convert readback evidence into a rollback claim.

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 101 |
| Tenant | 19 |
| Local device | 6 |
| Developer | 5 |
| Public | 15 |
| Unresolved | 12 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 12 |
| F1 tenant shell | 34 |
| F3 admin workspaces | 101 |
| F4 Local Manager | 6 |
| F5 developer/evidence | 5 |

F2 Admin BFF and F6 cutover are shared dependency work rather than route-family counts.

## Active blockers

| Blocker | Families |
|---|---:|
| Surface policy decision required | 147 |
| Runtime/OpenAPI auth contract gap | 0 |
| Operation classification gap | 125 |
| OpenAPI operation-presence gap | 0 |
| OpenAPI detail-contract gap | 72 |
| Mutation rollback/compensation gap | 1 |
| Scope unresolved | 12 |
| Test ownership gap | 154 |

Counts overlap because one family may have multiple blockers. Mutation controls and auth parity are operation-level even when the task view aggregates them by family. Test ownership requires an explicit `frontend-surface-operation` claim in a registered test. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 115 |
| High | 23 |
| Medium | 17 |
| Low | 3 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
