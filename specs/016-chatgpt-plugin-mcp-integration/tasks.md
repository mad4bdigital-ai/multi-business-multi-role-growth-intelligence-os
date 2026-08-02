# Tasks

Tasks are dependency ordered. `[P]` marks genuinely parallel work after its prerequisites are complete. Specification tasks do not authorize runtime mutation.

## Phase 0 — Specification review

- [ ] **T001** Review OpenAI plugin, MCP, authentication, packaging, privacy, and review source links for freshness.
- [ ] **T002** Review `spec.md`, `research.md`, `operation-paths.md`, and `concerns.md` with platform architecture, identity, product, security, and operations owners.
- [ ] **T003** Run the canonical Work Map scaffold/gate for `016-chatgpt-plugin-mcp-integration` and reconcile `work-map-integration.json`.
- [ ] **T004** Resolve or assign all open questions with owned gates.
- [ ] **T005** Validate every JSON, YAML, Markdown reference, manifest count, and completion field.
- [ ] **T006** Open the specification PR and complete architecture, security, privacy, and product review.

## Phase 1 — Existing-surface and consumer inventory

- [ ] **T007** Inventory all route mounts and consumers of `/mcp/initialize`, `/mcp/tools/list`, and `/mcp/tools/call`.
- [ ] **T008** Inventory query-token usage, logging exposure, configuration, and secret ownership.
- [ ] **T009** Map every current `mcpRuntime.js` tool to user goal, data sensitivity, capability, resource, principal class, and side-effect behavior.
- [ ] **T010** Identify broad/generic tools that must remain internal-only.
- [ ] **T011** Verify DNS, TLS, routing, deployment, health, and ownership posture for `mcp.mad4b.com`.
- [ ] **T012** Produce a deprecation and compatibility matrix for existing MCP consumers.

## Phase 2 — OAuth and identity conformance

- [ ] **T013** Assess the current authorization server against protected-resource metadata, OAuth discovery, resource propagation, PKCE, client registration, token validation, and revocation requirements.
- [ ] **T014** Select CIMD, DCR, or predefined client registration for development, review, and production environments.
- [ ] **T015** Define resource identifier, scope taxonomy, consent copy, and tenant/workspace admin policy.
- [ ] **T016** Define bearer challenge and structured authentication error behavior.
- [ ] **T017** Define access-token validation and cache-invalidation behavior.
- [ ] **T018** Define user unlink, grant revoke, client disable, and emergency deny paths.

## Phase 3 — Protocol adapter

- [ ] **T019** Add and pin the supported MCP SDK with dependency and license review.
- [ ] **T020** Implement a dedicated Streamable HTTP adapter at `/mcp` without changing legacy route semantics.
- [ ] **T021** Implement protocol initialization, version negotiation, server identity, and concise instructions.
- [ ] **T022** Implement bounded request parsing, content-type handling, request-size limits, deadlines, and structured protocol errors.
- [ ] **T023** Add initialization and transport observability with no-secret logging.
- [ ] **T024** Add endpoint health, readiness, and metadata fingerprint readback.

## Phase 4 — Read-only tool catalog

- [ ] **T025** Approve the minimum phase-1 user-goal inventory and final tool names.
- [ ] **T026** Define canonical input/output schemas for each phase-1 tool.
- [ ] **T027** Bind every tool to Context Kernel, capability, projection, evidence, and rollout authorities.
- [ ] **T028** Implement principal-aware and tenant-policy-aware tool discovery.
- [ ] **T029** Implement stable IDs, pagination, field allowlists, result-size limits, and structured result envelopes.
- [ ] **T030** Add annotation parity validation against actual handler behavior.
- [ ] **T031** Add cross-tenant, cross-workspace, cross-Brand, hidden-tool, and neutral-denial tests.
- [ ] **T032** Add prompt-injection, oversized-input, malformed-input, and result-redaction tests.

## Phase 5 — OAuth implementation and protected reads

- [ ] **T033** Publish protected-resource metadata on the MCP resource server.
- [ ] **T034** Integrate authorization-server discovery and selected client registration mode.
- [ ] **T035** Implement authorization code plus PKCE `S256` and resource-bound token issuance/acceptance.
- [ ] **T036** Enforce issuer, signature, audience/resource, subject, expiry, scope, and revocation on every protected tool.
- [ ] **T037** Add conformance tests for valid, expired, revoked, altered, wrong-resource, wrong-issuer, and insufficient-scope tokens.
- [ ] **T038** Verify account linking, relinking, unlinking, and revocation through ChatGPT developer mode.

## Phase 6 — Packaging and developer-mode evaluation

- [ ] **T039** Create the plugin package source template and validate `.codex-plugin/plugin.json`.
- [ ] **T040** Create a safe local connection-binding generator or example for `.app.json` without committing a live `plugin_asdk_app...` ID.
- [ ] **T041** Connect the deployed development MCP server in ChatGPT Developer mode and compare discovered metadata fingerprints.
- [ ] **T042** Run the complete direct, indirect, follow-up, invalid, unauthorized, write-attempt, and unsupported prompt evaluation set.

## Future implementation waves

The following work is intentionally outside the first 42-task specification count and must be expanded in implementation PRs after phase-1 acceptance:

- governed write-tool selection and contracts;
- confirmation receipts and operation idempotency;
- unknown-outcome reconciliation and compensation;
- optional UI and exact CSP;
- public submission dossier and review;
- production rollout, monitoring, revocation drills, legacy deprecation, and closeout.

## Dependency rules

- T019–T024 require T007–T018 and approved architecture.
- T025–T032 require a working protocol adapter but can use mocked identity until T033–T038 complete.
- T033–T038 require identity conformance approval from T013–T018.
- T039–T042 require transport, read-only tools, OAuth, and metadata parity.
- No write-tool task may begin before phase-1 developer-mode acceptance and a separate task expansion with operation-level traceability.
- No public submission task may begin before production availability, privacy/legal readiness, verified publisher identity, and release authorization.
