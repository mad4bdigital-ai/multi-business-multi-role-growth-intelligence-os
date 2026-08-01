# Remote MCP OAuth 2.1 operational runbook

## Purpose

This runbook covers the shared OAuth 2.1 authorization boundary used by the remote MCP resource for ChatGPT, Codex, Claude, Claude Desktop, MCP Inspector, and separately approved standards-compliant clients.

The implementation is disabled by default. Merging source does not apply the migration, register a client, create DNS, activate a route, or prove a live third-party connection.

Generated dispatch evidence is accepted only when it is committed on the current candidate and every exact-head check passes against that same source and evidence snapshot. Evidence generated for an earlier candidate is not authoritative.

## Canonical resources

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

The existing Tenant GPT and Activation OAuth contract remains independent and unchanged.

## Feature flags

```text
REMOTE_MCP_ENABLED=false
REMOTE_MCP_OAUTH_ENABLED=false
REMOTE_MCP_OAUTH_DCR_ENABLED=false
REMOTE_MCP_LEGACY_USER_JWT_ENABLED=false
REMOTE_MCP_OAUTH_ALLOW_LOOPBACK=false
```

Optional overrides:

```text
REMOTE_MCP_RESOURCE_URL=https://mcp.mad4b.com
REMOTE_MCP_AUTHORIZATION_SERVER_URL=https://auth.mad4b.com/auth/mcp
REMOTE_MCP_RESOURCE_DOCUMENTATION_URL=https://mcp.mad4b.com/docs
REMOTE_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://www.chatgpt.com,https://claude.ai,https://www.claude.ai
```

`JWT_SECRET` must be set through the approved secret authority. No fallback signing secret is accepted by the OAuth verifier.

## Persistence

Apply only through the governed migration process:

```text
http-generic-api/migrations/20260801_remote_mcp_oauth21_operational.sql
```

It creates additive tables for:

- registered OAuth clients;
- short-lived, single-use authorization codes;
- access-token JTI and refresh-token grant state;
- refresh rotation and revocation evidence.

The migration does not enable any route and contains no client credentials.

## Supported authorization contract

- OAuth authorization code grant.
- PKCE `S256` is mandatory.
- Public clients use `token_endpoint_auth_method=none`.
- Confidential clients may use `client_secret_basic` or `client_secret_post`.
- Dynamic client registration is separately feature-flagged.
- Exact redirect URI matching is mandatory.
- HTTPS redirect URIs are mandatory, except explicitly enabled development loopback URIs.
- Requested resource must equal the exact configured MCP resource.
- Available phase-one scopes are `workspaces.read` and `brands.read`.
- Access tokens expire after one hour.
- Refresh tokens expire after thirty days and rotate on every use.
- Authorization codes expire after five minutes and become single-use only after successful PKCE verification.
- Every protected tool call checks the active durable grant for revocation.

## Client registration posture

### Claude

The expected callback for the Anthropic custom connector profile is:

```text
https://claude.ai/api/mcp/auth_callback
```

Use dynamic registration only after the public non-production endpoint and database migration are verified. Otherwise register the exact callback through an approved confidential or public client process.

### ChatGPT and Codex

Use the callback URI emitted by the exact ChatGPT Developer mode or plugin connection. Never guess or source-control an account-specific callback, technical connection ID, access token, refresh token, or client secret.

### Generic clients

Unknown clients are not automatically trusted. Registration records transport identity and maximum scopes only. Platform tenant, workspace, Brand, resource, capability, and operation authorization remains server-owned.

## Deployment sequence

1. Merge the exact green source candidate to `main`.
2. Promote the exact `main` SHA to the controlled non-production runtime.
3. Configure DNS and TLS for `mcp.mad4b.com` without enabling the feature flags.
4. Apply the OAuth persistence migration through governed migration tooling.
5. Confirm the three tables and indexes through readback.
6. Set canonical resource, issuer, and Origin values.
7. Enable `REMOTE_MCP_OAUTH_ENABLED=true` while keeping `REMOTE_MCP_ENABLED=false`.
8. Verify authorization-server metadata, protected-resource metadata behavior, registration disable state, and route fail-closed behavior.
9. Enable DCR only for the bounded test window when a test client requires it.
10. Register one non-production client and retain credentials only in approved secret storage.
11. Enable `REMOTE_MCP_ENABLED=true` for the canary environment.
12. Run MCP Inspector, ChatGPT Developer mode, Claude Custom Connector, and neutral-client acceptance against the same deployment SHA.
13. Disable DCR after registration unless an approved ongoing registration policy exists.
14. Promote only after metadata, tool catalog, tenant isolation, expiry, refresh, revocation, and rollback parity are recorded.

## Required synthetic tests

```bash
node test-remote-mcp-oauth21-profile.mjs
node test-remote-mcp-access-token-verifier.mjs
node test-remote-mcp-oauth21-routes.mjs
node test-remote-mcp-multi-client-profiles.mjs
node test-chatgpt-mcp-readonly-runtime.mjs
node test-chatgpt-mcp-metadata-routing.mjs
```

## Live acceptance matrix

For each client profile, record:

- exact deployed SHA;
- registered client ID fingerprint, never the secret;
- exact redirect URI fingerprint;
- metadata response fingerprints;
- MCP protocol version;
- tool catalog and annotation fingerprint;
- successful authorization code plus PKCE flow;
- insufficient-scope denial;
- wrong-resource denial;
- expired-token denial;
- refresh rotation and replay denial;
- access-token and refresh-token revocation;
- cross-tenant, cross-workspace, and cross-Brand denial;
- endpoint, client, and global disable readback.

## Monitoring

Alert on bounded aggregates only:

- registration attempts and failures;
- authorization failures by safe error class;
- token exchanges and refresh rotations;
- revoked or inactive grant use;
- invalid issuer, audience, resource, scope, and signature counts;
- protected tool latency and dependency failure counts.

Never log authorization codes, access tokens, refresh tokens, client secrets, passwords, raw authorization headers, or raw grant rows.

## Rollback

Rollback is ordered from least disruptive to broadest:

1. Disable DCR.
2. Disable or revoke one OAuth client row.
3. Revoke one user grant or all grants for one client.
4. Disable one tool in the governed catalog.
5. Set `REMOTE_MCP_ENABLED=false`.
6. Set `REMOTE_MCP_OAUTH_ENABLED=false`.
7. Roll the runtime back to the previously verified SHA.

Do not drop OAuth tables during an incident. Retain them for revocation, audit, reconciliation, and safe recovery.

## Current delivery boundary

Source implementation and synthetic tests do not establish production readiness. Until live evidence exists, the following remain incomplete:

- migration application;
- DNS and TLS verification;
- non-production deployment;
- real client registration;
- MCP Inspector acceptance;
- ChatGPT Developer mode acceptance;
- Claude Custom Connector acceptance;
- neutral-client acceptance;
- key rotation drill;
- Production promotion and rollback rehearsal.
