# Cross-Cutting Concerns

## C-001 — OAuth contract mismatch

**Risk**: The existing identity service may not expose protected-resource metadata, authorization-server discovery, resource propagation, supported client registration, or PKCE behavior required by the MCP authorization contract.  
**Control**: Run a conformance assessment before implementation. Prefer adapting an established identity provider. Block protected tools until conformance tests pass.  
**Evidence**: discovery snapshots, authorization trace, resource-bound token claims, negative tests.

## C-002 — Secret in URL compatibility debt

**Risk**: The existing query-token MCP contract can leak through browser history, logs, proxies, or monitoring and cannot represent end-user authorization.  
**Control**: Never expose query-token auth on the new endpoint. Keep legacy routes separately flagged, inventory consumers, and deprecate with evidence.  
**Evidence**: route configuration, log-redaction tests, consumer inventory.

## C-003 — Cross-tenant and cross-Brand access

**Risk**: A model can supply a tenant or Brand identifier that belongs to another customer.  
**Control**: Resolve authorized context from the verified token and Context Kernel. Treat tool arguments only as selectors within the authorized set. Fail closed on mismatch.  
**Evidence**: isolation matrix, denial records, no-row-leak tests.

## C-004 — Generic super-tool exposure

**Risk**: Broad public tools such as `execute_action` or arbitrary connected-app calls may be selected incorrectly and can obscure permission, confirmation, and review semantics.  
**Control**: Expose focused user-goal tools. Keep generic dispatch internal. Bind each public tool to a fixed operation family, input schema, capability, policy, annotations, and result schema.  
**Evidence**: tool-to-operation registry and selection evaluation.

## C-005 — Incorrect safety annotations

**Risk**: A write or external action is advertised as read-only, reducing host confirmation and review protections.  
**Control**: Derive or validate annotations against actual handler behavior and operation metadata. CI rejects mismatches.  
**Evidence**: annotation parity report and negative fixtures.

## C-006 — Prompt injection and malicious content

**Risk**: User content, connected documents, or provider responses may contain instructions that attempt to broaden tool use or disclose data.  
**Control**: Treat all content as data, not authority. Validate all inputs, constrain tools, isolate secrets, and never let returned content alter authorization.  
**Evidence**: prompt-injection test corpus and authorization invariance tests.

## C-007 — Overcollection of conversation context

**Risk**: Tool schemas request broad chat history or unrelated context.  
**Control**: Accept only task-specific fields. Do not expose a full transcript input. Reuse stable IDs and server-side records for follow-up context.  
**Evidence**: schema review and privacy data-flow inventory.

## C-008 — Token replay or wrong audience

**Risk**: A token issued for another resource or client is accepted by the MCP server.  
**Control**: Validate issuer, audience/resource, subject, expiry, not-before, scope, signature, token type, and revocation on every protected call.  
**Evidence**: invalid-audience, expired, revoked, altered, and cross-resource tests.

## C-009 — Mutation replay and unknown outcome

**Risk**: A timeout causes ChatGPT or a user to repeat a write that already succeeded.  
**Control**: Use durable idempotency keys, operation records, status tools, and provider readback. Never replay an unknown outcome before reconciliation.  
**Evidence**: duplicate-request and timeout-injection tests.

## C-010 — Confirmation confusion

**Risk**: The host confirmation prompt is treated as authorization, or a typed platform confirmation is accepted for a different operation.  
**Control**: Bind confirmations to principal, tool, canonical resource, intended transition, input hash, expiry, and operation fingerprint. Reauthorize immediately before execution.  
**Evidence**: confirmation replay and mismatch tests.

## C-011 — Metadata drift

**Risk**: The deployed tool list differs from reviewed source or the public metadata snapshot.  
**Control**: Produce deterministic catalog fingerprints. Compare source, runtime, developer connection, and submission scan. Require a new reviewed version for metadata changes.  
**Evidence**: exact-head metadata parity report.

## C-012 — Tool list information leakage

**Risk**: Listing tools reveals capabilities, provider names, or admin functions unavailable to the current user.  
**Control**: Filter discovery by rollout, client eligibility, scope, tenant policy, capability readiness, and principal class. Use neutral denial behavior.  
**Evidence**: tool visibility matrix.

## C-013 — Oversized or unbounded responses

**Risk**: Large result sets increase latency, cost, leakage, and model confusion.  
**Control**: Pagination, field allowlists, maximum rows, maximum bytes, maximum nesting, summary-first responses, and narrow follow-up tools.  
**Evidence**: boundary and load tests.

## C-014 — Dependency outage and backpressure

**Risk**: Identity, database, Context Kernel, registry, provider, or evidence services are unavailable.  
**Control**: Separate initialization from protected operations, cache only safe metadata, use timeouts and circuit breakers, report retryability, and fail closed when authority cannot be resolved.  
**Evidence**: dependency-fault matrix and health readback.

## C-015 — Logging and trace leakage

**Risk**: Authorization headers, tokens, credentials, raw provider payloads, or customer records appear in logs and traces.  
**Control**: Structured allowlist logging, redaction before emission, no body logging for protected endpoints, bounded fingerprints, and automated secret scans.  
**Evidence**: log fixture inspection and secret-scanning report.

## C-016 — Plugin package identity leakage

**Risk**: A personal `plugin_asdk_app...` connection ID or OAuth secret is committed to the repository.  
**Control**: Commit schemas, templates, and examples only. Inject environment-specific IDs through a local generator or deployment configuration outside source.  
**Evidence**: repository secret scan and package-template validation.

## C-017 — Optional UI supply-chain risk

**Risk**: A UI component loads scripts, styles, images, or APIs from undeclared domains.  
**Control**: UI remains deferred. Any future component needs exact CSP domains, no inline secret transfer, accessibility checks, and text fallback.  
**Evidence**: CSP review and browser security tests.

## C-018 — Public review readiness gap

**Risk**: A technically working endpoint is submitted without verified publisher identity, privacy disclosures, test access, accurate prompts, or production availability.  
**Control**: Release checklist blocks submission and publishing independently.  
**Evidence**: completed submission dossier and reviewer test pack.

## C-019 — Legacy consumer breakage

**Risk**: Existing integrations rely on the split routes or query-token behavior.  
**Control**: Consumer inventory, explicit route versioning, usage telemetry, deprecation window, and rollback. No silent redirect.  
**Evidence**: zero-use window and compatibility smoke tests.

## C-020 — Governance bypass through adapter code

**Risk**: The MCP adapter reimplements tenant, capability, connector, or mutation logic and drifts from platform authorities.  
**Control**: Adapter performs protocol translation only. It invokes canonical Context Kernel, capability, operation, execution, evidence, and readback services. Architecture tests reject direct provider credentials, unrestricted database access, or bypass paths.  
**Evidence**: dependency graph, architecture gate, and handler-to-authority traceability.

## Blocking concern disposition

Implementation remains blocked until C-001, C-003, C-004, C-005, C-008, C-009, C-011, C-015, and C-020 have approved design evidence. Public submission remains blocked until all concerns have accepted production evidence or an owned, expiring exception.
