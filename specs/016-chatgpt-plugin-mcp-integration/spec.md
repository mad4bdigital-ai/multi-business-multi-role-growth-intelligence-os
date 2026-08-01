# Feature Specification: Multi-Client AI Connector and Standards-Compliant MCP Integration

**Branch**: `gpt/spec-016-chatgpt-plugin-mcp-integration-20260801`  
**Created**: 2026-08-01  
**Status**: Draft  
**Delivery**: multi_pr  
**Spec owner**: platform-team

## Problem and verified baseline

The platform has an MCP-labelled HTTP surface, but it is not yet the interoperable remote MCP resource required by current AI platforms such as ChatGPT, Codex, Claude, Claude Desktop, and other standards-compliant clients.

Verified repository baseline at `main` SHA `464c11803d8cb84ba39863c5e55e05f30dbca8da`:

- `http-generic-api/routes/mcpRoutes.js` mounts three split routes: `/mcp/initialize`, `/mcp/tools/list`, and `/mcp/tools/call`.
- `http-generic-api/mcpRuntime.js` requires a query-string token when the backend key is enabled and rejects the `Authorization` header.
- The runtime exposes a mixture of developer-agent, connection, and generic execution tools, including broad tool shapes that are not optimized for a clear user goal.
- Existing handlers return useful JSON, but the surface is not a single Streamable HTTP MCP endpoint and does not implement the OAuth resource-server discovery contract expected for private data and write actions.

Verified OpenAI plugin baseline on 2026-08-01:

- A plugin may contain skills, an MCP server, or both; UI is optional.
- MCP-backed plugins should expose a stable publicly reachable HTTPS endpoint using Streamable HTTP, normally ending in `/mcp`.
- Authenticated MCP servers are expected to use OAuth 2.1-compatible authorization, protected-resource metadata, and authorization code with PKCE.
- Tool names, descriptions, schemas, structured results, and safety annotations are part of the user-facing contract.
- Developer-mode connection is the first test surface; public submission adds organization verification, policy, metadata, and review requirements.

Verified Anthropic connector baseline on 2026-08-01:

- Claude and Claude Desktop can connect to remote custom connectors backed by MCP.
- Claude supports remote Streamable HTTP and OAuth-based MCP servers, with SSE retained only as a compatibility transport.
- Claude supports the 2025-03-26 and 2025-06-18 authorization contracts, Dynamic Client Registration, custom client credentials where supported, token expiry, and refresh.
- Claude custom connectors are configured by adding the remote MCP server URL and authenticating the individual user.
- Claude support is a client distribution profile around the shared MCP resource; it must not create a separate tenant or execution authority.

## Objective

Deliver one tenant-safe remote MCP connector integration that:

1. connects ChatGPT, Codex, Claude, Claude Desktop, and other approved clients to one standards-compliant MCP endpoint;
2. authenticates the end user through the platform;
3. exposes focused tools derived from existing governed capabilities;
4. enforces tenant, workspace, Brand, resource, and connection authority server-side;
5. supports read-only use first and governed writes later;
6. supports client-specific packaging or directory metadata without embedding account-specific IDs or secrets in source;
7. reaches client-specific review and production readiness without weakening existing platform governance.

## Scope

### Included

- Streamable HTTP MCP adapter on a stable `/mcp` endpoint.
- OAuth 2.1 resource-server discovery and bearer-token validation.
- Client profiles for OpenAI, Anthropic, and separately approved generic MCP clients.
- Focused initial read-only tool catalog shared by every client profile.
- Governed write-tool framework with explicit confirmation and readback gates.
- Context Kernel, capability, policy, operation, evidence, and connector integration.
- Optional ChatGPT/Codex plugin packaging using `.codex-plugin/plugin.json` and `.app.json` binding.
- Claude custom connector registration and acceptance requirements.
- Generic client compatibility, registration, rollout, and revocation requirements.
- Developer-mode, private rollout, directory/review, and version-maintenance flows.
- Metadata, privacy, security, observability, testing, rollback, and support requirements.

### Excluded

- Implementing an authorization server from scratch when the existing identity service can satisfy the required contract.
- Publishing or submitting any plugin or connector from this specification branch.
- Committing real OAuth client credentials, access tokens, backend keys, connection IDs, `plugin_asdk_app...` IDs, Claude client secrets, or callback-specific secrets.
- Returning custom UI in phase 1.
- Replacing platform authorization with any host-side confirmation prompt.
- Exposing unrestricted SQL, arbitrary HTTP, arbitrary repository mutation, or a generic super-tool.
- Creating separate business-logic runtimes, tool catalogs, or tenant authority paths for each AI platform.
- Immediate deletion of the existing split MCP routes.

## Work Map integration and dimension discovery

`work-map-integration.json` records current decisions for all generated Work Maps and all 16 schema domains. It remains `draft` until the canonical scaffold/gate is run against the implementation candidate and every implementation dimension is resolved.

## Actors and authority

| Actor | Principal/auth mode | Allowed responsibilities | Forbidden overrides |
|---|---|---|---|
| Remote AI host | MCP client plus registered OAuth client identity | Discover server metadata, start user authorization, invoke advertised tools | Cannot grant tenant, Brand, resource, capability, or operation authority |
| OpenAI client profile | ChatGPT or Codex connection | Use the shared MCP endpoint through OpenAI packaging and developer-mode contracts | Cannot receive broader tools or authority than other clients with the same user scopes |
| Anthropic client profile | Claude or Claude Desktop custom connector | Use the shared MCP endpoint through Claude connector and OAuth contracts | Cannot receive broader tools or authority than other clients with the same user scopes |
| Generic approved client profile | Standards-compliant MCP client | Connect after client-policy, OAuth, transport, and compatibility approval | Cannot bypass explicit registration, rollout, origin, token, or scope policy |
| End user | Platform user authenticated through OAuth 2.1 | Consent to scopes and request authorized operations | Cannot select inaccessible tenants, workspaces, Brands, resources, or connections |
| Workspace admin | Authenticated user with governed admin capabilities | Approve workspace rollout, scopes, clients, and selected tools | Cannot bypass platform or organization policy |
| Platform MCP resource server | Service identity plus verified user token | Validate tokens, resolve context, dispatch authorized tools, produce readback | Cannot trust model arguments or client identity as tenant authority or expose credentials |
| Authorization server | Existing platform identity authority | Authenticate users and issue resource-bound access tokens | Cannot issue broader scope than approved policy |
| Platform operator | Admin/service identity | Configure rollout, monitor health, revoke access, and manage client profiles | Cannot read user secrets from logs or bypass approval requirements |
| Distribution reviewer | OpenAI, Anthropic, MCP registry, or other approved review environment | Test declared metadata and workflows for its distribution target | Receives no production secrets or unrelated customer data |

## User journeys

### US1 — Connect the platform from a supported AI client (P1)

**Given** a deployed HTTPS MCP endpoint and an approved client profile  
**When** the user adds the `/mcp` URL through ChatGPT, Claude, MCP Inspector, or another approved client  
**Then** the client initializes the same server, discovers the same bounded tools, and presents authentication only when a protected capability is invoked.

### US2 — Link an authorized platform account (P1)

**Given** the user invokes a protected tool  
**When** the client follows protected-resource and authorization-server metadata and completes authorization code plus PKCE  
**Then** the server receives a resource-bound bearer token and resolves only the user’s authorized platform context.

### US3 — Read Brand operating context (P1)

**Given** the user has access to multiple Brands  
**When** the user asks for the status of one Brand from any supported client  
**Then** the client calls focused read tools, uses stable identifiers, and returns a bounded no-secret summary with authoritative readback evidence.

### US4 — Deny cross-tenant or cross-Brand access (P1)

**Given** a prompt or tool argument references an inaccessible tenant or Brand  
**When** the tool executes from any client  
**Then** the server ignores the argument and client profile as authority, rejects the request with a structured non-retryable error, and records redacted denial evidence.

### US5 — Request a governed write operation (P2)

**Given** the write tool is enabled for the client, the principal has authority, and required confirmation is present  
**When** the user requests a state change  
**Then** the server creates or reuses an idempotent operation, dispatches through existing execution authority, and returns operation status plus readback instead of claiming success from transport alone.

### US6 — Recover from expiry or unknown outcome (P2)

**Given** a token expires or a downstream call times out  
**When** the user retries from the same or another approved client  
**Then** authentication is renewed or operation readback is performed before any replay, preventing duplicate side effects.

### US7 — Publish and maintain client distribution profiles (P3)

**Given** protocol acceptance, policy readiness, verified publisher identity where required, and production parity  
**When** an authorized publisher submits an OpenAI plugin, Anthropic directory entry, MCP registry record, or other client package  
**Then** the reviewed metadata snapshot can be approved and published while later metadata changes require the applicable rescan and reviewed version.

## Operation paths

See `operation-paths.md` for OP-001 through OP-010 and `multi-client-connector-extension.md` for client-profile additions.

## Cross-cutting concerns

See `concerns.md`. Security, tenant isolation, privacy, prompt injection, replay, idempotency, availability, performance, observability, compatibility, review readiness, client drift, and rollback are blocking concerns.

## Functional requirements

- **FR-001**: The platform shall expose one stable HTTPS MCP Streamable HTTP endpoint, normally `/mcp`.
- **FR-002**: The endpoint shall support MCP initialization, tool discovery, and tool invocation through the supported transport contract.
- **FR-003**: The endpoint shall be implemented as an adapter over existing platform authorities rather than a parallel business-logic system or client-specific runtime.
- **FR-004**: Existing split MCP routes shall remain isolated behind an explicit compatibility boundary until deprecation evidence is complete.
- **FR-005**: The resource server shall publish protected-resource metadata for authenticated tools.
- **FR-006**: The authorization flow shall use OAuth 2.1-compatible authorization code with PKCE `S256`.
- **FR-007**: Access tokens shall be validated for issuer, audience/resource, expiry, scope, subject, client eligibility, and revocation state on every protected request.
- **FR-008**: The server shall return a standards-compatible bearer challenge when authentication is required.
- **FR-009**: Tenant, workspace, Brand, subject, resource, and connection context shall be resolved from authenticated platform authority.
- **FR-010**: Model-provided identifiers and client-profile metadata shall be treated as selectors or operational evidence and rejected when they exceed resolved authority.
- **FR-011**: Phase 1 shall expose read-only tools only.
- **FR-012**: Each tool shall represent one recognizable user goal and avoid unrelated operational modes.
- **FR-013**: Each tool shall define an action-oriented name, title, use-oriented description, explicit input schema, output schema where structured output exists, and accurate annotations.
- **FR-014**: Read-only tools shall set `readOnlyHint=true`, `destructiveHint=false`, and `openWorldHint` according to actual external effects.
- **FR-015**: Write tools shall remain undiscoverable until capability, policy, confirmation, idempotency, evidence, and rollback requirements are implemented.
- **FR-016**: Every write tool shall declare whether it can affect external systems and whether outcomes are destructive or difficult to reverse.
- **FR-017**: Host-side confirmation behavior shall never replace server-side authorization, validation, or typed confirmation.
- **FR-018**: Tool results shall include stable resource or operation identifiers needed for safe follow-up calls across clients.
- **FR-019**: Tool results shall separate concise model-readable text from structured content and bounded client metadata.
- **FR-020**: Tool output and metadata shall exclude access tokens, refresh tokens, credentials, authorization headers, provider payload secrets, raw grants, client secrets, and database connection material.
- **FR-021**: Tool list generation shall filter tools by rollout state, user scope, tenant policy, capability readiness, and client eligibility.
- **FR-022**: The server shall bound list sizes, pagination, field selection, payload depth, and client request rates.
- **FR-023**: A write request shall create or reuse a canonical idempotency key and durable operation record independent of the invoking client.
- **FR-024**: Unknown downstream outcomes shall trigger operation readback before any retry from any client.
- **FR-025**: Every invocation shall emit redacted request, client profile, tool, principal class, context, latency, result, and evidence identifiers.
- **FR-026**: Operators shall be able to revoke a user grant, disable a tool, disable one client profile, or disable the entire integration without deleting platform data.
- **FR-027**: Each distribution target shall use a validated package, connector, or registry metadata contract without changing the shared MCP tool authority.
- **FR-028**: ChatGPT `.app.json`, Claude client registration, and any other client binding shall reference only environment-specific technical identities and shall never contain credentials in reusable source.
- **FR-029**: The repository shall provide environment-specific packaging and registration templates without committing live account-specific connection or client IDs.
- **FR-030**: Phase 1 shall function without custom UI; any later client-specific UI shall define exact CSP/network permissions and have a text-only fallback.
- **FR-031**: Acceptance shall cover MCP Inspector plus every advertised client profile, including direct, indirect, follow-up, invalid, unauthorized, write, and out-of-scope prompts.
- **FR-032**: Public submission or directory listing shall be blocked until target-specific verification, permissions, privacy policy, terms, test account, metadata, availability, and review evidence are complete.

## Non-functional requirements

- **NFR-001 Security**: All private data and writes require authenticated, resource-bound authorization and object-level checks.
- **NFR-002 Isolation**: No request may cross tenant, workspace, Brand, user, resource, connection, or client-policy boundaries.
- **NFR-003 Privacy**: Data collection and return fields shall be task-specific and minimized.
- **NFR-004 Availability**: Initialization and tool discovery shall fail closed with bounded errors when dependencies are unavailable.
- **NFR-005 Performance**: P95 initialization and tool-list latency shall be below 2 seconds under the agreed production load; read-tool P95 shall be below 5 seconds excluding declared long-running operations.
- **NFR-006 Boundedness**: Responses shall enforce configurable size, row, depth, execution-time, and rate limits.
- **NFR-007 Observability**: Every request shall have a correlation identifier, client-profile evidence, and no-secret lifecycle evidence.
- **NFR-008 Compatibility**: Existing consumers and supported client profiles shall not be silently redirected to incompatible transport, auth, or tool contracts.
- **NFR-009 Replay safety**: Mutations shall be idempotent and shall not replay after uncertain transport outcomes without readback.
- **NFR-010 Maintainability**: Tool definitions shall be generated or validated from canonical registries, not duplicated per client without drift checks.
- **NFR-011 Reviewability**: Published metadata shall be versioned and reproducible from the reviewed source and deployed endpoint for each distribution target.
- **NFR-012 Accessibility**: Any optional UI shall preserve keyboard, contrast, responsive layout, and text fallback requirements.

## State and data requirements

See `data-model.md`. The preferred posture is reuse-first. New persistence is allowed only when existing client registration, OAuth grant, operation, evidence, policy, and release registries cannot represent the required state without ambiguity. Client profiles never own tenant data.

## Contracts

- `contracts/chatgpt-plugin-mcp.openapi.yaml` — historical filename for the shared remote MCP HTTP discovery, health, and compatibility boundary.
- `contracts/mcp-tool.schema.json` — normalized tool metadata and result requirements shared by every client.
- `contracts/oauth-protected-resource.schema.json` — protected-resource metadata.
- `contracts/plugin-package.schema.json` — source-controlled OpenAI package template; other client bindings are defined by the extension artifact.
- `multi-client-connector-extension.md` — Claude and generic-client transport, auth, registration, testing, and distribution requirements.

## Error taxonomy

| Code | Status | Stage | Retryable | User action | Readback |
|---|---:|---|---|---|---|
| `MCP_AUTH_REQUIRED` | 401 | authentication | yes after link | Link or relink account | protected-resource metadata |
| `MCP_TOKEN_INVALID` | 401 | authentication | no until renewed | Reauthenticate | token validation evidence |
| `MCP_SCOPE_INSUFFICIENT` | 403 | authorization | no | Request approved scope | resolved grant snapshot |
| `MCP_CLIENT_NOT_ALLOWED` | 403 | client policy | no | Use an approved client or request approval | client-policy snapshot |
| `MCP_CONTEXT_DENIED` | 403 | context | no | Select an accessible resource | Context Kernel decision |
| `MCP_TOOL_NOT_AVAILABLE` | 404 | discovery | no | Use an enabled tool | tool-catalog version |
| `MCP_INPUT_INVALID` | 400 | validation | no | Correct the request | schema findings |
| `MCP_CONFIRMATION_REQUIRED` | 409 | confirmation | yes after confirmation | Confirm the bounded action | confirmation policy |
| `MCP_OPERATION_IN_PROGRESS` | 202 | execution | yes by status read | Wait or inspect status | operation record |
| `MCP_UNKNOWN_OUTCOME` | 202 | execution | no automatic replay | Read operation status | provider/readback evidence |
| `MCP_DEPENDENCY_UNAVAILABLE` | 503 | dependency | yes with backoff | Retry later | health and dependency evidence |
| `MCP_RATE_LIMITED` | 429 | protection | yes after delay | Retry after indicated delay | quota snapshot |
| `MCP_RESPONSE_TOO_LARGE` | 413 | result | yes with narrower query | Narrow filters | boundedness evidence |

## Security and privacy

The server shall enforce OAuth, audience/resource binding, client eligibility, Context Kernel resolution, semantic capability authorization, tenant-safe query construction, prompt-injection-resistant input handling, output redaction, least privilege, explicit consent, and auditable revocation. No broad conversation transcript field is accepted by default. Browser Origin and client-profile detection are defense and observability signals, never authorization substitutes.

## Observability and evidence

Each lifecycle record shall include request ID, invocation ID, client profile, client registration reference when available, tool catalog version, tool name, principal class, resolved context fingerprint, authorization decision ID, operation ID when relevant, timestamps, latency, bounded result classification, retry classification, and redaction status. Evidence must not contain secrets or raw customer payloads.

## Rollout, rollback, and compatibility

1. Shadow metadata validation with no network exposure.
2. Private development endpoint and MCP Inspector.
3. ChatGPT developer-mode read-only connection.
4. Claude custom connector read-only connection.
5. Generic approved-client compatibility test.
6. Internal workspace pilot.
7. Selected governed writes behind tool-level and client-level flags.
8. Target-specific public review or directory candidates.
9. Publish only after approval and production parity.

Rollback can disable one client profile, endpoint route, tool catalog version, OAuth scope set, or individual tool independently. Legacy split routes are removed only after consumer inventory, deprecation notice, zero-use evidence, and rollback readiness.

## Success criteria

- **SC-001**: MCP Inspector initializes the deployed `/mcp` endpoint and lists the expected phase-1 tools without schema findings.
- **SC-002**: ChatGPT and Claude create connections and discover the same tool metadata fingerprint as MCP Inspector.
- **SC-003**: 100% of phase-1 tools are read-only and have verified annotations matching behavior across every client.
- **SC-004**: Cross-tenant and cross-Brand test attempts are denied in 100% of cases with no data leakage from any client.
- **SC-005**: OAuth discovery, PKCE authorization, token validation, expiry, refresh, revocation, insufficient-scope, and client-policy tests pass.
- **SC-006**: No secret appears in tool output, logs, traces, structured content, client metadata, package, connector, or review artifacts.
- **SC-007**: Tool-selection evaluation reaches at least 95% correct selection on supported prompts and at least 99% no-call behavior on unsupported prompts per advertised client.
- **SC-008**: Write-tool replay tests produce at most one side effect per idempotency key even when requests move between clients, and use readback after unknown outcomes.
- **SC-009**: Production endpoint, reviewed source, and each published client profile produce the same tool metadata fingerprint.
- **SC-010**: Disable and revocation drills stop new access for one user, one client, one tool, or the whole integration within the defined operational SLA without deleting tenant data.

## Open questions

- **Q-001**: Can the current `auth.mad4b.com` identity surface satisfy MCP OAuth discovery, resource binding, PKCE, client registration, refresh, and revocation without a new identity provider? Owner: identity team; gate: implementation planning.
- **Q-002**: Is `https://mcp.mad4b.com/mcp` currently routed and deployable as a stable public endpoint? Owner: platform operations; gate: phase 1 deployment.
- **Q-003**: Which read-only user goals form the minimum reviewable phase-1 tool catalog? Owner: product and platform; gate: tool contract review.
- **Q-004**: Which existing consumers depend on the split MCP routes and query-token contract? Owner: platform operations; gate: compatibility plan.
- **Q-005**: Which distribution targets are required first: private ChatGPT, Claude custom connector, internal generic clients, OpenAI public listing, Anthropic directory, or MCP registry? Owner: product; gate: release planning.
- **Q-006**: Which client-identification mechanisms are supported per environment: Dynamic Client Registration, Client ID Metadata Documents, predefined clients, or custom client credentials? Owner: identity and security teams; gate: OAuth implementation.

## Delivery state

This branch specifies the shared remote MCP integration and its client profiles only. It does not authorize runtime changes, migrations, OAuth registrations, credentials, tool activation, external calls, plugin or connector submission, directory listing, publishing, or Production deployment. Implementation may not progress beyond separately governed draft PRs until `work-map-integration.json` is regenerated and marked ready with all blocking questions assigned or resolved.
