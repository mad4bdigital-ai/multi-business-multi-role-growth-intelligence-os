# Feature Specification: Remote MCP Host Isolation and OAuth Live Readiness

**Branch**: `gpt/spec-017-remote-mcp-host-isolation-oauth-readiness-20260810`  
**Created**: 2026-08-10  
**Status**: Draft  
**Delivery**: multi_pr  
**Spec owner**: platform-team

## Problem and verified repository baseline

Pinned source baseline: `main@a722609b45ab3ac4617096963380ab4e1434f17d`.

The existing Remote MCP implementation already contains a shared Streamable HTTP runtime, OAuth 2.1 profile, DCR support, durable OAuth client/code/grant persistence, refresh rotation, grant revocation, and a documented deployment sequence. The remaining problem is not absence of OAuth code; it is the absence of a sufficiently strict resource-host boundary plus incomplete live-readiness evidence.

The verified failure shape is:

1. `/mcp` is reachable by path without first proving the request is on the configured MCP resource host;
2. protected-resource metadata is host-sensitive;
3. a wrong-host MCP URL can therefore enter the MCP runtime but discover another resource family's OAuth contract;
4. DCR is implemented but intentionally omitted from authorization-server metadata unless DCR and redirect-origin policy are both usable;
5. OAuth persistence, signing-key provisioning, DNS/TLS/reverse-proxy routing, and real-client acceptance remain operational gates.

This creates a misleading surface where transport reachability can be mistaken for canonical resource correctness.

## Objective

Deliver a fail-closed Remote MCP resource boundary and a governed live-readiness contract so that:

- `https://mcp.mad4b.com/mcp` is the only canonical MCP endpoint for the MAD4B Remote MCP resource;
- wrong-host `/mcp` requests do not execute the MCP runtime;
- protected-resource discovery cannot silently fall into Tenant GPT/Activation metadata for unrelated hosts;
- effective host resolution is centralized and constrained to a defined trusted-proxy model;
- Remote MCP readiness can be read without returning secrets or raw OAuth records;
- every `REMOTE_MCP_*` operational dependency is documented;
- DCR, migration apply, secret provisioning, DNS/TLS, reverse-proxy changes, feature activation, and client registration remain separately governed actions;
- source readiness never implies production readiness.

## Scope

### Included

- Canonical resource-host validation for `/mcp`.
- Explicit host routing for protected-resource metadata.
- Trusted effective-host resolver for direct and approved proxy deployments.
- Regression coverage for wrong-host MCP requests and metadata cross-resource leakage.
- No-secret Remote MCP operational readiness/readback surface.
- `.env.example` coverage for Remote MCP/OAuth flags and non-secret configuration keys.
- Readiness checks for OAuth tables, configured resource/issuer, signing-key presence status, redirect policy, DCR advertisement state, and feature flags without revealing sensitive values.
- Governed rollout sequence for migration, DNS/TLS, proxy, OAuth, DCR, MCP canary, and real-client acceptance.
- Rollback and disable ordering.
- Compatibility preservation for the existing Tenant GPT/Activation OAuth contract.

### Excluded

- Applying the OAuth migration from this specification branch.
- Creating or rotating production secrets.
- Editing DNS, TLS, Hostinger, Cloudflare, reverse proxy, or another provider from this branch.
- Enabling Remote MCP, OAuth, or DCR flags from this branch.
- Registering a real OAuth client.
- Creating a ChatGPT, Claude, Inspector, or generic-client connection.
- Expanding the phase-one Remote MCP tool catalog.
- Adding write tools.
- Replacing the existing Remote MCP OAuth design.
- Reusing `JWT_SECRET` for Remote MCP OAuth signing.
- Making client-provided host/origin values an authorization authority.
- Production promotion or force push.

## Canonical resource contract

```text
MCP resource:       https://mcp.mad4b.com
MCP endpoint:       https://mcp.mad4b.com/mcp
OAuth issuer:       https://auth.mad4b.com/auth/mcp
Authorization:      https://auth.mad4b.com/auth/mcp/oauth/authorize
Token:              https://auth.mad4b.com/auth/mcp/oauth/token
Registration:       https://auth.mad4b.com/auth/mcp/oauth/register
Revocation:         https://auth.mad4b.com/auth/mcp/oauth/revoke
AS metadata:        https://auth.mad4b.com/.well-known/oauth-authorization-server/auth/mcp
Resource metadata:  https://mcp.mad4b.com/.well-known/oauth-protected-resource
```

The OAuth issuer host and the MCP resource host are intentionally different. This must not permit the issuer host to become an alternate MCP resource host.

## Actors and authority

| Actor | Allowed responsibility | Forbidden authority |
|---|---|---|
| Remote MCP client | Connect to the canonical MCP resource and follow advertised OAuth metadata | Cannot choose an alternate resource host or broaden server policy |
| End user | Authenticate and consent to allowed scopes | Cannot replace tenant/workspace/Brand authority with model arguments |
| MCP resource server | Validate canonical host, bearer identity, scopes, tenant context, grants, and tool authority | Cannot trust arbitrary forwarded-host values or client profile as authority |
| OAuth authorization server | Authenticate, issue resource-bound tokens, register approved clients, revoke grants | Cannot turn the issuer host into the MCP resource host |
| Trusted reverse proxy | Forward requests and approved host metadata according to deployment contract | Cannot allow arbitrary clients to forge trusted forwarding headers |
| Platform operator | Configure rollout, migration, DNS/TLS, feature flags, DCR windows, monitoring, and rollback | Cannot expose signing secrets, tokens, raw grants, or bypass governed approvals |

## User scenarios

### US1 — Canonical MCP connection succeeds (P1)

**Given** Remote MCP is enabled and routing is correctly deployed  
**When** a standards-compliant client connects to `https://mcp.mad4b.com/mcp`  
**Then** the request reaches the Remote MCP runtime and OAuth discovery points only to `https://auth.mad4b.com/auth/mcp`.

### US2 — Wrong-host MCP URL fails closed (P1)

**Given** the same runtime is reachable through another virtual host  
**When** a client calls `/mcp` on `auth.mad4b.com`, an Activation host, or an unknown host  
**Then** the request is rejected as not found before MCP execution and no alternative OAuth resource contract is exposed.

### US3 — Resource discovery cannot cross OAuth families (P1)

**Given** a request for protected-resource metadata  
**When** the effective host does not match an explicitly supported resource host  
**Then** the server returns a fail-closed not-found response instead of silently falling through to Tenant GPT/Activation metadata.

### US4 — DCR is advertised only when usable (P1)

**Given** OAuth is enabled  
**When** DCR is disabled or its exact redirect-origin policy is not ready  
**Then** authorization-server metadata does not advertise a registration endpoint; once both controls are ready, the endpoint is advertised and can persist a registered client only if the governed OAuth schema exists.

### US5 — Operator reads readiness without secrets (P1)

**Given** an authorized operator  
**When** Remote MCP readiness is queried  
**Then** the response reports bounded configuration/schema/routing readiness booleans and canonical identifiers without returning secrets, tokens, hashes, raw grant rows, or credentials.

### US6 — Live rollout remains independently governed (P1)

**Given** source implementation and tests are green  
**When** production-facing rollout is requested  
**Then** migration apply, secret provisioning, DNS/TLS/proxy changes, feature activation, DCR registration, real-client acceptance, and Production promotion require their own exact governed steps and evidence.

## Functional requirements

- **FR-001**: The Remote MCP runtime shall define one canonical resource URL and derive its canonical host from `REMOTE_MCP_RESOURCE_URL`.
- **FR-002**: Every `/mcp` request shall validate the effective request host before executing MCP initialization, tool discovery, or tool invocation.
- **FR-003**: A `/mcp` request whose effective host does not equal the configured canonical MCP resource host shall fail closed with a not-found response.
- **FR-004**: The OAuth issuer host shall not be treated as an alternate MCP resource host merely because it serves Remote MCP OAuth endpoints.
- **FR-005**: Protected-resource metadata routing shall use explicit supported-host matching rather than an unconditional fallback to another OAuth resource family.
- **FR-006**: Unknown protected-resource metadata hosts shall fail closed without returning Tenant GPT, Activation, or Remote MCP scopes.
- **FR-007**: Effective request-host resolution shall be implemented in one reusable helper rather than duplicated across MCP and metadata routes.
- **FR-008**: The effective-host helper shall define precedence and normalization for direct `Host` and approved forwarded-host headers.
- **FR-009**: Forwarded host values shall be trusted only under the platform's approved trusted-proxy deployment model; client-controlled forwarding headers shall not become authority by default.
- **FR-010**: Host normalization shall reject malformed host values, user-info forms, invalid schemes, ambiguous multi-host values, and values that cannot be normalized deterministically.
- **FR-011**: Existing Tenant GPT/Activation resource metadata shall remain available only on explicitly assigned hosts/routes.
- **FR-012**: Remote MCP authorization-server metadata shall advertise `registration_endpoint` only when DCR is enabled and a usable redirect-origin policy exists.
- **FR-013**: DCR shall continue to require exact approved redirect origins and exact registered redirect URI matching.
- **FR-014**: Remote MCP OAuth client registration shall remain dependent on the governed OAuth persistence schema and shall fail closed if persistence is unavailable.
- **FR-015**: The implementation shall expose an admin-only, no-secret Remote MCP readiness/readback surface.
- **FR-016**: Readiness shall report at minimum: configured resource, configured issuer, MCP enabled state, OAuth enabled state, DCR enabled/advertised state, redirect-policy readiness, signing-key readiness boolean, and existence/readiness of the three OAuth persistence tables.
- **FR-017**: Readiness shall never return signing secrets, client secrets, registration access tokens, authorization codes, access tokens, refresh tokens, raw authorization headers, raw hashes, or raw grant/client rows.
- **FR-018**: `.env.example` shall document all Remote MCP feature flags and non-secret configuration keys and shall include only an empty placeholder for the signing secret.
- **FR-019**: The existing migration `20260801_remote_mcp_oauth21_operational.sql` shall remain the canonical persistence migration unless implementation proves a corrective additive migration is required.
- **FR-020**: Source changes shall not automatically apply migrations, mutate providers, enable flags, register clients, or deploy the runtime.
- **FR-021**: Live acceptance shall prove canonical host routing, OAuth metadata, DCR registration when temporarily enabled, authorization-code PKCE, refresh rotation, revocation, tenant isolation, and client reconnection behavior.
- **FR-022**: Rollback shall be possible by disabling DCR, MCP, and OAuth in bounded order without dropping OAuth persistence tables.

## Non-functional requirements

- **NFR-001 Security**: Host routing must fail closed and must not create cross-resource OAuth metadata leakage.
- **NFR-002 Security**: Proxy headers must not become an unbounded client-controlled authority source.
- **NFR-003 Privacy**: Readiness and logs must exclude credentials, tokens, raw grants, and user-sensitive authorization payloads.
- **NFR-004 Availability**: A malformed or wrong host must be rejected cheaply before database-backed MCP execution.
- **NFR-005 Compatibility**: Tenant GPT/Activation OAuth behavior must remain unchanged on its explicit canonical surfaces.
- **NFR-006 Operability**: Operators must be able to distinguish source readiness, schema readiness, configuration readiness, routing readiness, and client acceptance readiness.
- **NFR-007 Observability**: Safe counters should distinguish wrong-host denials, DCR denials, invalid redirect origins, token failures, and revoked-grant use without logging secrets.
- **NFR-008 Testability**: Host routing behavior must be deterministic in unit/integration tests without public DNS dependencies.
- **NFR-009 Rollback**: Runtime disable and DCR disable must not require schema destruction.
- **NFR-010 Governance**: Provider mutation, migration apply, secret provisioning, and Production promotion must remain outside ordinary source-code execution.

## Success criteria

1. `mcp.mad4b.com/mcp` is the only accepted Remote MCP resource-host combination.
2. `auth.mad4b.com/mcp` returns not found and never initializes MCP.
3. Activation and unknown hosts cannot execute the Remote MCP route.
4. Unknown protected-resource metadata hosts return not found rather than another resource family's metadata.
5. Explicit Tenant GPT/Activation canonical discovery still passes its existing regression suite.
6. DCR metadata remains absent when either DCR or redirect policy is not ready.
7. DCR metadata appears when both controls are ready in synthetic tests.
8. The readiness surface exposes bounded booleans and canonical URLs but no secrets.
9. `.env.example` documents the complete Remote MCP configuration contract.
10. Full CI and targeted Remote MCP/OAuth regression suites pass on the exact implementation head.
11. Live rollout evidence proves DNS/TLS/proxy, schema, secret readiness, OAuth/DCR, canonical MCP routing, and real-client acceptance on one deployed SHA.
12. No deployment, migration apply, secret mutation, provider change, or Production mutation occurs merely by merging the specification or source implementation.

## Delivery boundary

This Spec Kit authorizes specification creation only. It does not authorize implementation, deployment, migration apply, provider mutation, secret access, OAuth client registration, feature activation, or Production promotion.
