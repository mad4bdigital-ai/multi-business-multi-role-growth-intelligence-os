# Traceability Matrix

## Functional requirements to operation paths and tasks

| Requirements | Operation paths | Primary tasks | Evidence target |
|---|---|---|---|
| FR-001–FR-004 | OP-001, OP-008 | T007, T012, T019–T024 | transport conformance and compatibility report |
| FR-005–FR-008 | OP-003 | T013–T018, T033–T038 | OAuth discovery, PKCE, challenge, and token test report |
| FR-009–FR-010 | OP-002, OP-004, OP-005, OP-006 | T027–T032, T036 | Context Kernel and isolation matrix |
| FR-011–FR-017 | OP-002, OP-006 | T009, T010, T025–T030 | tool registry and annotation parity report |
| FR-018–FR-020 | OP-004, OP-005, OP-007 | T026, T029, T032 | result schema, stable-ID, and redaction report |
| FR-021–FR-022 | OP-002, OP-004 | T028–T032 | catalog eligibility and bounded-response tests |
| FR-023–FR-024 | OP-006, OP-007 | future write wave | idempotency and unknown-outcome E2E evidence |
| FR-025–FR-026 | OP-001–OP-010 | T018, T023, T024, future rollout wave | invocation evidence and revoke/disable drill |
| FR-027–FR-030 | OP-008 | T039–T041 | package validation and connection binding evidence |
| FR-031 | OP-008 | T041–T042 | prompt-selection evaluation |
| FR-032 | OP-009 | future submission wave | submission dossier and approved snapshot |

## Non-functional requirements to controls

| Requirement | Concern refs | Verification |
|---|---|---|
| NFR-001 Security | C-001, C-004–C-010, C-020 | OAuth, authorization, confirmation, architecture tests |
| NFR-002 Isolation | C-003, C-012 | multi-tenant and multi-Brand test matrix |
| NFR-003 Privacy | C-006, C-007, C-015, C-018 | schema review, data-flow inventory, secret scan |
| NFR-004 Availability | C-014 | dependency-fault and fail-closed tests |
| NFR-005 Performance | C-013, C-014 | load and latency report |
| NFR-006 Boundedness | C-013 | input/output boundary tests |
| NFR-007 Observability | C-009, C-011, C-015 | evidence completeness and redaction report |
| NFR-008 Compatibility | C-002, C-019 | consumer inventory and deprecation smoke tests |
| NFR-009 Replay safety | C-009, C-010 | duplicate, timeout, and confirmation replay tests |
| NFR-010 Maintainability | C-004, C-005, C-011, C-020 | canonical catalog and drift gate |
| NFR-011 Reviewability | C-011, C-018 | source/runtime/review fingerprint parity |
| NFR-012 Accessibility | C-017 | UI accessibility and text fallback tests when applicable |

## User journeys to acceptance evidence

| Journey | Acceptance evidence |
|---|---|
| US1 Developer connection | E2E phase 2, Inspector transcript, ChatGPT metadata fingerprint |
| US2 OAuth account link | E2E phase 3, grant lifecycle and negative token cases |
| US3 Brand operating context | authorized read result, stable identifiers, projection revision |
| US4 Cross-tenant denial | isolation matrix with neutral denial and no row leakage |
| US5 Governed write | future phase 4 operation, confirmation, idempotency, and readback evidence |
| US6 Expiry/unknown outcome | token renewal and operation reconciliation evidence |
| US7 Publish and maintain | future phase 5 submission, approval, publication, and version-maintenance evidence |

## External authority mapping

| Design area | OpenAI source category | Repository artifact |
|---|---|---|
| Plugin composition | plugin architecture | `README.md`, `spec.md` |
| Developer connection | quickstart and connect/test | `quickstart.md`, OP-008 |
| MCP transport | build MCP server | FR-001–FR-004, Phase B |
| Focused tools and annotations | define tools and build MCP server | FR-011–FR-017, C-004, C-005 |
| OAuth | authentication guide | FR-005–FR-008, OP-003, Phase C |
| Packaging | package plugin | FR-027–FR-029, T039–T040 |
| Privacy and security | security/privacy and plugin guidelines | C-006–C-018, security checklist |
| Public review | submission and MCP review requirements | FR-032, OP-009, release checklist |

## Repository authority mapping

| Existing authority | Integration responsibility |
|---|---|
| Context Kernel | principal, subject, tenant, workspace, Brand, resource, and connection resolution |
| Capability governance | tool eligibility and semantic authorization |
| Policy authority | scopes, rollout, confirmation, external action, destructive action, and tenant policy |
| Platform resource graph | canonical typed resource relationships |
| Workflow and operation runtime | durable mutation, idempotency, status, retry, compensation |
| Connector/provider authority | credential-safe external dispatch and provider readback |
| Evidence/observability | no-secret lifecycle evidence and alerts |
| Repository automation | metadata/schema validation, exact-head parity, generated contract checks |

## Blocking traceability gaps

- Physical schema reuse mapping is pending T007–T018.
- Final phase-1 tool names and schemas are pending T025–T026.
- Write-tool requirement and task expansion is intentionally deferred until read-only acceptance.
- Public submission fields and package assets are intentionally deferred until production and legal readiness.
