# Frontend Dispatch Coverage Baseline

**Baseline ref**: `401a84034432de0b089f34baffde70606256913d`
**Generated contract**: `http-generic-api/frontend-surface-dispatch.generated.json`  
**Policy**: fail closed; unresolved items are work, not exemptions.

## Inventory

| Metric | Count |
|---|---:|
| Mounted route files | 130 |
| Scope/policy-split surface families | 162 |
| Mixed-scope route files | 24 |
| HTTP operations | 968 |
| Canonical OpenAPI operations | 574 |
| Generated auth-backed operation index | 378 |
| Explicit OpenAPI exemptions | 16 |
| Remaining OpenAPI operation-presence gaps | 0 |
| Generated operations still missing reviewed detail contracts | 378 |
| Explicitly test-owned operations | 53 |
| Operations without explicit test claims | 915 |
| Fully test-owned families | 6 |
| Families with test ownership gaps | 156 |
| Ready tasks | 3 |
| Blocked tasks | 159 |

The inventory includes optional dynamically imported route builders, expands optional Express parameters into both served path variants, expands `router.all` registrations across every governed HTTP method, ignores commented legacy registrations, and splits route families at explicit surface-policy and auth boundaries. Generated Custom GPT projections and the runtime operation index are excluded from canonical detail coverage: they supply projection or presence/auth evidence only and never count as reviewed request/response contracts. Fifteen session-insight read models plus the tenant Activation session list and bounded turn-batch write now have reviewed request/response schemas; lifecycle status enums are checked against their persistence migrations, and fifty-three operations have explicit test ownership. Operation governance for the current atomic-resource and canary-closeout wave is now generated deterministically from checksum-bound route, service, transaction, and registered-test evidence; incomplete evidence fails closed and produces no rule.

## Auth and operation governance

| Metric | Count |
|---|---:|
| Runtime/OpenAPI auth equivalent | 952 |
| Explicit auth exemptions | 16 |
| Auth mismatches | 0 |
| Missing OpenAPI for auth comparison | 0 |
| Runtime auth unresolved | 0 |
| Non-GET operation candidates | 589 |
| Explicitly classified state changes | 8 |
| Explicitly classified non-mutating actions | 49 |
| Non-GET candidates awaiting classification | 532 |
| Fully governed state changes | 7 |

Exact auth rules now cover handler-level, imported-handler, public bootstrap, connector bearer, signed-query-token, and multi-method root-discovery cases. They cannot weaken a statically discovered guard: a conflicting rule fails closed. Twelve newly mounted admin operations were synchronized to the runtime admin bearer/API-key alternatives, and canonical 401/403 bodies now match the shared runtime guards. The adapter-contract, target-adapter, adapter-apply-readiness, promotion-review, payload-preview-review, capability-envelope-plan, request-gate, dispatch-dry-run, actual-request-preflight, actual-request, approval, dispatch-readback, adapter-execution-gate, backlog-target-write, target-write-readback, and remaining-scope-completion POST filters are classified as SELECT-only read actions with canonical contracts and executable tests. Smoke-certification status, effective-policy resolution, and policy listing are also proven SELECT-only actions; adjacent certify and policy-upsert operations remain consequential. Seventeen further manifest, readiness, readback, health, governance-proposal, smoke-policy, remote-catalog, private-resolution, agent-intelligence, and repository-planning operations are source-proven read actions with explicit tests. Tenant Activation now owns a signed-user session list and a bounded transcript-turn batch write; both enforce exact JWT tenant/user scope, the write reuses the `session_archive_write` capability family, and its immutable audit correction policy is additive rather than destructive rollback. The Activation session list is additionally restricted to `originator = 'gpt_action'`, preventing ordinary tenant sessions from leaking through the alias. The signed-user tenant bootstrap remains classified as a Managed-mode state change with same-cycle readback. The four tenant resource mutations now run authorization, mutation, and scoped readback on one acquired SQL connection and roll back on any failure. The canary-closeout route is also generated as a governed state change from its admin guard, capability envelope, typed confirmation, transaction, readback, and registered regression evidence. Bootstrap's separate workspace/activation commits remain the only mutation rollback/compensation blocker.

## Scope distribution

| Scope | Families |
|---|---:|
| Admin | 101 |
| Tenant | 21 |
| Local device | 6 |
| Developer | 6 |
| Public | 16 |
| Unresolved | 12 |

## Wave distribution

| Wave | Families |
|---|---:|
| F0 authority resolution | 12 |
| F1 tenant shell | 37 |
| F3 admin workspaces | 101 |
| F4 Local Manager | 6 |
| F5 developer/evidence | 6 |

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
| Test ownership gap | 156 |

Counts overlap because one family may have multiple blockers. Mutation controls and auth parity are operation-level even when the task view aggregates them by family. Test ownership requires an explicit `frontend-surface-operation` claim in a registered test. No blocker should be bulk-waived.

## Risk

| Risk | Families |
|---|---:|
| Critical | 114 |
| High | 25 |
| Medium | 19 |
| Low | 4 |

Risk is conservative by design. Admin/local authority, mutations, unknown scope, missing contracts, missing tests, and missing product decisions add weight.
