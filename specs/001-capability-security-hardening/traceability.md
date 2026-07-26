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

## Verified branch evidence — principal and surface containment

| Tasks | Implementation evidence | Automated evidence | Decision evidence |
|---|---|---|---|
| T009 | `containment-validation.md` records the exact Phase 0 scope, validated base/resolution/tree SHAs, named platform/runtime/governance owners, rollback switches, residual-risk boundary, and final-head CI requirement. | `test-spec-kit-phase0-containment-evidence.mjs` enforces T001–T009 checked, T010–T114 still open, owner/evidence fields present, rollout and traceability links present, and no implicit production-promotion approval. | Phase 0 may merge only as a containment increment after fresh reconciliation and final-head CI; later architecture, staging, deployment, and production rollout tasks remain open and separately approval-gated. |
| T001 | `platformPluginResolver.js` classifies `admin_platform_tool`, `platform_admin_tool`, and admin/platform exposure scopes as admin-only for tenant principals; canonical tool policy remains unresolved unless an explicit tenant-safe canonical action binding exists | resolver matrix covers admin surface names and admin/platform exposure scopes and proves every case is denied before `user_app_connections` lookup | response reports `surface_resolution.reason=admin_tool_forbidden`, deferred credential resolution, `execution.will_execute=false`, and no credential table in audit evidence |
| T003 | dual-surface tool aliases remain fail-closed until an explicit canonical action-policy mapping exists; action selectors continue through canonical policy while tool selectors cannot weaken it | resolver test resolves `github.repo.read` through both selector types and proves action dispatch succeeds while the same tool alias returns `tool_canonical_policy_mapping_required` before credential lookup | decision trace distinguishes `action_is_canonical_policy_key` from unresolved tool canonical policy and keeps `execution.will_execute=false` for the alias path |
| T004 | `governedExecutionPreflight.js` classifies repository mutations, connector apply runs, GPT tools, and app actions before execution; missing mutation policy or missing classification returns fail-closed evidence. `appAdapters/index.js` declares every current app action as read-only, mutating, or HTTP-method-derived. `gptToolsRoutes.js` resolves method/tags from the governed tool catalog before dispatch. | `test-explicit-mutation-policy-fail-closed.mjs` covers repository mutation, repo patch, GPT read-only/mutation/unclassified tools, app actions, connector preview/apply, and dynamic HTTP methods. Existing `test-runtime-policy-resolver.mjs`, `test-connect-routes.mjs`, `test-gpt-tools-route-syntax-regression.mjs`, and `test-test-manifest-runner.mjs` pass. | decision evidence uses stable `mutation_policy_required` and `mutation_classification_required` reasons; declared capability-envelope/readback policies continue to the tool-specific enforcement gate, while read-only operations remain executable without mutation policy. |
| T007 | `capabilityKillSwitchPolicy.js` defines five independently scoped, request-time server switches. `connectorProxyRoutes.js` enforces shell, file, Cloudflare, and n8n switches before device proxy execution. `credentialIntakeRoutes.js` enforces the raw-admin intake switch without changing tenant-safe intake. `openapi.yaml` documents 503 behavior and repairs the referenced standard response components. | `test-capability-kill-switch-policy.mjs` verifies every blocked and preserved action, independent switch scope, 503 error details, no-secret snapshots, route wiring, and tenant-safe intake isolation. OpenAPI YAML, split governance, regeneration parity, route coverage, Custom GPT schemas, tenant plugin routes, credential-intake policy/single-use, connect routes, and manifest tests pass. | enabled switches return `CAPABILITY_KILL_SWITCH_ENABLED`, `retryable=true`, bounded switch/surface/action evidence, and `secrets_included=false`; read-only diagnostics remain available for containment and recovery. |
| T008 | `platformPluginSecurityAlerts.js` classifies and schedules temporary high-severity containment alerts. `platformPluginResolver.js` invokes it immediately after surface and canonical-policy resolution, before credential lookup. Tenant-to-admin requests and active action/tool selector parity mismatches are recorded as distinct append-only audit actions. | `test-platform-plugin-security-alerts.mjs` covers classification, dual alerts, false-positive suppression, no-secret event shape, and audit-writer failure isolation. `test-platform-plugin-resolver.mjs` proves both alerts are scheduled by real resolver paths while dispatch remains blocked and credential lookup remains deferred. | result projection reports `security_alerts.scheduled_count`, stable reason codes, `severity=high`, `temporary_control=true`, and `secrets_included=false`; audit metadata records bounded principal/plugin/selector/surface reasons only. |

## Verified branch evidence — credential policy

| Tasks | Implementation evidence | Automated evidence | Decision evidence |
|---|---|---|---|
| T046 | `platformPluginResolver.js` defines immutable `CredentialRequirement`, `CredentialResolutionState`, and `CredentialUsabilityState` enums and emits all three dimensions for every evaluated/deferred outcome | resolver tests assert usable, missing, scope-denied, unusable, and not-required projections | `data-model.md` documents the three independent dimensions and invariants |
| T047 | `platformPluginResolver.js` separates `loadScopedConnections` from plugin/binding discovery and invokes it only after plugin, principal scope, binding, surface, canonical-policy, and skill gates pass | tests prove no `user_app_connections` query for missing binding, forbidden admin tool surface, missing skill grant, or incomplete tenant principal scope | response includes `principal_scope` and `credential_lookup`; audit read-model tables include `user_app_connections` only when lookup was authorized |
| T048 | explicit `credential_source=none` is preserved even under managed/dedicated policy composition and bypasses only credential lookup | tests prove `not_required` can dispatch when all other gates pass and remains denied when the skill gate fails | decision trace reports `requirement=not_required`, `resolution_state=not_required`, `usability_state=not_applicable`, and zero credential rows read |
| T049 | `connectionIsUsable` requires active lifecycle plus an explicitly accepted validated state before returning an executable connection | tests cover validated success and pending-validation denial | decision trace distinguishes `resolved/usable`, `resolved/unusable`, and `missing/not_evaluated` without exposing secrets |
| T050 | `platformPluginTargetAuthority.js` resolves scoped platform-managed target permission from `platform_resource_authority_bindings`; resolver requires the decision before dispatch and records hashed target evidence only | `test-platform-plugin-target-authority.mjs` covers not-applicable, missing target, foreign target, allowed target, disallowed mode, unavailable authority, and admin compatibility; resolver integration proves no `user_app_connections` lookup for platform-managed credentials | `target_authorization` reports pass/deny/not_applicable, lookup evidence, permission metadata, and `secrets_included=false`; both OpenAPI contracts document the optional request context and response evidence |
| T051 | `CredentialDenialCode` and target-authority denial codes provide stable machine-readable outcomes while preserving legacy `reason` text | resolver tests assert `CREDENTIAL_SCOPE_MISMATCH`, `CREDENTIAL_NOT_USABLE`, and `DEDICATED_CONNECTION_REQUIRED`; target tests assert all target-authority denial codes | `error-catalog.md` and both OpenAPI resolver contracts document stable denial evidence without exposing foreign targets or credentials |
| T052 | resolver output projects only bounded connection metadata and never projects credential payload fields; target evidence stores only a SHA-256 reference | resolver tests inject access token, refresh token, password, API key, and encrypted credential sentinels and assert none appear in response/audit serialization; foreign target URI is also absent | response and audit evidence retain `secrets_included=false`; connection SQL selects metadata fields only |
| T053 | credential acceptance coverage exercises valid, missing, pending-validation, revoked, wrong-tenant, wrong-scope, platform-managed unauthorized target, and no-secret inspection cases D01-D09 | `test-platform-plugin-resolver.mjs` and `test-platform-plugin-target-authority.mjs` assert lifecycle, tenant/user query predicates, stable denial codes, no foreign connection leakage, and fail-closed target authority | `acceptance-matrix.md` D01-D09 and this traceability table map each credential outcome to automated evidence |

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
## Unified tenant reverification and PR review closure

| Evidence | Scope | Closure status |
|---|---|---|
| `tenant-reverification-unified-report-2026-06-23.md` | 34 tenant-safe waves, three contract-blocked groups, P0/P1/P2 findings, evidence IDs, and no-execution safety declaration | Preserved as authoritative residual-risk input; does not grant execution or production readiness. |
| Codex review comment `3462323198` | Broad GPT-tool execution policy could bypass missing explicit mutation policy | Closed by unconditional declared-mutation-policy enforcement plus regression coverage with a seeded generic policy. |
| Codex review comment `3462323203` | Broad app-action advisory policy could satisfy a mutating app action | Closed by requiring a policy whose execution scope contains both normalized `app_key` and `action_key`, with broad-policy denial and specific-policy allow regressions. |
| Credential access ordering | App action credentials were refreshed before authorization preflight | Closed by moving `ensureFreshCredentials` after successful `evaluateAppActionPreflight`; source-order regression protects the invariant. |
| `checklists/pr-1879-phase0-merge.md` | PR author, testing, API, database, review, and merge checks | Phase 0 items are explicit; final-head CI/reconciliation and review-thread resolution remain live merge gates. |

The tenant report findings that exceed the PR scope map to T010–T114 and remain open. They must not be reclassified as closed merely because Phase 0 containment merges.
