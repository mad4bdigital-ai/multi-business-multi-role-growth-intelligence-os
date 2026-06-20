# Requirements Traceability Matrix

| Requirement group | Primary implementation tasks | Acceptance evidence |
|---|---|---|
| FR-001–FR-008 Selector and canonical identity | T020–T033 | A01–A08 |
| FR-009–FR-014 Principal, tenant, and resource authorization | T001, T035–T037 | B01–B07 |
| FR-015–FR-021 Gate evaluation and dispatch readiness | T004, T034, T039–T045 | C01–C07 |
| FR-022–FR-028 Credential handling | T005, T046–T053 | D01–D09 |
| FR-029–FR-034 Secure intake | T006, T054–T061 | E01–E09 |
| FR-035–FR-041 Device and local execution | T062–T080 | F01–F11, G01–G08 |
| FR-042–FR-044 High-risk integrations | T084–T089 | H08–H09, I01–I07 |
| FR-045–FR-050 Status and observability | T090–T096 | J01–J08 |
| NFR-001 Fail-closed security | T001–T009, T039–T045, T107 | C01, C04–C05 |
| NFR-002 Compatibility | T032, T099, T102, T105 | A01–A05 plus migration evidence |
| NFR-003 Performance | T017, T106 | Approved p50/p95/p99 comparison |
| NFR-004 Determinism | T044–T045, T103 | Repeated-fixture consistency |
| NFR-005 Observability | T092–T096 | J04–J08 |
| NFR-006 Privacy | T052, T059, T078, T093 | D09, E09, J08 |
| NFR-007 Architecture | T010, T019, T020–T045 | Architecture review |
| NFR-008 Contract | T027–T033, T097–T101 | OpenAPI and error-contract validation |
| NFR-009 Testability | T026, T033, T044–T045, T053, T061, T070, T080, T089, T096, T103–T108 | Full matrix |
| NFR-010 Rollback | T007, T110, T113 | Flag and rollback exercise |

## P0 finding-to-remediation map

| Finding | Containment | Permanent remediation | Closure tests |
|---|---|---|---|
| Selector-type privilege escalation | T003 | T020–T026, T031, T043 | A01–A08 |
| Tenant access to admin tools | T001, T006 | T035–T037, T054–T060 | B03, E03 |
| Multiple selectors silently accepted | T002 | T027–T031 | A03–A04 |
| Explicit tool treated as no action | T003 | T042–T043 | C03 |
| State-changing tool without approval | T004 | T081–T084 | H01–H09 |
| Credential/authorization conflation | T005 | T046–T053 | D01–D09 |
| Raw admin credential intake exposed | T006 | T054–T061 | E01–E09 |
| Missing policy may fail open | T004 | T039–T045 | C01, C04–C05 |

## P1 finding-to-remediation map

| Finding | Permanent remediation | Closure tests |
|---|---|---|
| Device identity/ownership not evidenced | T062–T070 | F01–F11 |
| Local consent not evidenced | T071–T072 | F10–F11 |
| Shell/files rely on skill only | T073–T080 | G01–G08 |
| Registered device described as healthy | T090–T091 | J01–J03 |
| Gate evidence incomplete | T092–T096 | J04–J08 |
| Cloudflare/n8n target scoping | T085–T089 | I01–I07 |

## Verified branch evidence — credential policy

| Tasks | Implementation evidence | Automated evidence | Decision evidence |
|---|---|---|---|
| T047 | `platformPluginResolver.js` separates `loadScopedConnections` from plugin/binding discovery and invokes it only after plugin, principal scope, binding, surface, canonical-policy, and skill gates pass | `test-platform-plugin-resolver.mjs` proves no `user_app_connections` query for missing binding, forbidden admin tool surface, missing skill grant, or incomplete tenant principal scope | response includes `principal_scope` and `credential_lookup`; audit read-model tables include `user_app_connections` only when lookup was authorized |

## Verified branch evidence — secure intake

| Tasks | Implementation evidence | Automated evidence | Contract/data evidence |
|---|---|---|---|
| T055 | `credentialIntakeBindingPolicy.js`; binding columns in migration 1021; tenant route derives subject, tenant, integration, target, and purpose from JWT and active policy | `test-credential-intake-binding-policy.mjs`; `test-tenant-platform-plugin-routes.mjs` | `data-model.md`; tenant and main OpenAPI request contracts |
| T056 | `normalizeCredentialIntakeRedirect`; same-origin relative paths and exact registered HTTPS allowlist matching | redirect traversal, protocol-relative, HTTP, unregistered-host, and approved-host cases in `test-credential-intake-binding-policy.mjs` | `redirect_uri` documented in both OpenAPI files; runtime code in `error-catalog.md` |
| T057 | `credentialIntakeSingleUse.js`; row lock, single commit, replay denial, rollback preservation | concurrent-consumption and rollback tests in `test-credential-intake-single-use.mjs` | migration 072 plus migration 1021; single-use state model |
| T058 | `validateCredentialIntakeSessionSecurity`; authority snapshot comparison during page load and inside the consume transaction; pending session revocation before connection creation | membership role/status, tenant state, policy state/source mode, app state, and missing-authority tests | authority snapshot fields and revocation reason in migration 1021 and `data-model.md` |

## Release trace rule

A requirement is not complete when code is merged. It is complete only when:

1. implementation task is complete,
2. automated or governed acceptance evidence exists,
3. decision traces prove the expected gates,
4. contract/documentation is synchronized,
5. release-readiness approval is recorded.
