# Remote MCP OAuth 2.1 operational runbook

## Purpose

This runbook covers the shared OAuth 2.1 authorization boundary used by the remote MCP resource for ChatGPT, Codex, Claude, Claude Desktop, MCP Inspector, and separately approved standards-compliant clients.

The implementation is disabled by default. Merging source does not apply the migration, register a client, create DNS, activate a route, or prove a live third-party connection.

Generated dispatch evidence is accepted only when it is committed on the current candidate and every exact-head check passes against that same source and evidence snapshot. Evidence generated for an earlier candidate is not authoritative.

The `generated-artifact-refresh` pull-request label authorizes only the registered exact-head dispatcher to delegate the bounded generated-artifact refresh; it does not authorize deployment, migration, protected-branch mutation, or force push.

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

## Feature flags and required configuration

```text
REMOTE_MCP_ENABLED=false
REMOTE_MCP_OAUTH_ENABLED=false
REMOTE_MCP_OAUTH_DCR_ENABLED=false
REMOTE_MCP_LEGACY_USER_JWT_ENABLED=false
REMOTE_MCP_OAUTH_ALLOW_LOOPBACK=false
```

Required before OAuth activation:

```text
REMOTE_MCP_OAUTH_SIGNING_SECRET=<dedicated secret, distinct from JWT_SECRET>
REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS=https://chatgpt.com,https://claude.ai
```

`REMOTE_MCP_OAUTH_SIGNING_SECRET` must be supplied through the approved secret authority. `JWT_SECRET` remains the platform-user session verifier and is not accepted for Remote MCP authorization-request or access-token signing.

Dynamic registration fails closed when `REMOTE_MCP_OAUTH_ALLOWED_REDIRECT_ORIGINS` is empty. Every non-loopback redirect URI must have an exact Origin match in that allowlist. Host suffixes, lookalike domains, user-info URLs, fragments, and unapproved Origins are rejected. Development loopback redirects require the separate `REMOTE_MCP_OAUTH_ALLOW_LOOPBACK=true` flag.

Optional overrides:

```text
REMOTE_MCP_RESOURCE_URL=https://mcp.mad4b.com
REMOTE_MCP_AUTHORIZATION_SERVER_URL=https://auth.mad4b.com/auth/mcp
REMOTE_MCP_RESOURCE_DOCUMENTATION_URL=https://mcp.mad4b.com/docs
REMOTE_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://www.chatgpt.com,https://claude.ai,https://www.claude.ai
```

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
- Dynamic client registration is separately feature-flagged and redirect-Origin allowlisted.
- Exact redirect URI matching is mandatory after registration.
- HTTPS redirect URIs are mandatory, except explicitly enabled development loopback URIs.
- Requested resource must equal the exact configured MCP resource.
- Available phase-one scopes are `workspaces.read` and `brands.read`.
- The validated authorization request is signed server-side, expires after five minutes, and binds client, redirect URI, state, resource, scopes, and PKCE challenge before login and consent.
- `/auth/mcp/oauth/code` accepts only the signed authorization request plus an explicit `consent=true`; raw client, redirect, scope, resource, or PKCE replacement values are not accepted.
- Access tokens expire after one hour and use the dedicated Remote MCP OAuth signing secret.
- Access-token verification requires exact `azp`, `client_id`, subject, user, tenant, resource, scope, JTI, and active-grant parity.
- Refresh tokens expire after thirty days and rotate on every use.
- Authorization codes expire after five minutes and become single-use only after successful PKCE verification.
- Every protected tool call checks the active durable grant for revocation.

## Client registration posture

### Claude

The expected callback for the Anthropic custom connector profile is:

```text
https://claude.ai/api/mcp/auth_callback
```

Add `https://claude.ai` to the redirect-Origin allowlist before opening a bounded DCR window. Use dynamic registration only after the public non-production endpoint and database migration are verified. Otherwise register the exact callback through an approved confidential or public client process.

### ChatGPT and Codex

Use the callback URI emitted by the exact ChatGPT Developer mode or plugin connection. Add only its exact HTTPS Origin to the DCR allowlist. Never guess or source-control an account-specific callback, technical connection ID, access token, refresh token, or client secret.

### Generic clients

Unknown clients are not automatically trusted. Their redirect Origin must be approved before DCR. Registration records transport identity and maximum scopes only. Platform tenant, workspace, Brand, resource, capability, and operation authorization remains server-owned.

## Deployment sequence

1. Merge the exact green source candidate to `main`.
2. Promote the exact `main` SHA to the controlled non-production runtime.
3. Configure DNS and TLS for `mcp.mad4b.com` without enabling the feature flags.
4. Apply the OAuth persistence migration through governed migration tooling.
5. Confirm the three tables and indexes through readback.
6. Configure the dedicated OAuth signing secret, canonical resource, issuer, allowed CORS Origins, and the bounded DCR redirect-Origin allowlist.
7. Enable `REMOTE_MCP_OAUTH_ENABLED=true` while keeping `REMOTE_MCP_ENABLED=false`.
8. Verify authorization-server metadata, protected-resource metadata behavior, registration disable state, signed authorization-request behavior, and route fail-closed behavior.
9. Enable DCR only for the bounded test window when a test client requires it.
10. Register one non-production client and retain credentials only in approved secret storage.
11. Disable DCR after registration unless an approved ongoing registration policy exists.
12. Enable `REMOTE_MCP_ENABLED=true` for the canary environment.
13. Run MCP Inspector, ChatGPT Developer mode, Claude Custom Connector, and neutral-client acceptance against the same deployment SHA.
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
- exact redirect URI and approved Origin fingerprint;
- metadata response fingerprints;
- MCP protocol version;
- tool catalog and annotation fingerprint;
- successful signed authorization request, explicit consent, authorization code, and PKCE flow;
- missing-consent and tampered-authorization-request denial;
- insufficient-scope denial;
- wrong-resource denial;
- subject, tenant, client, and active-grant mismatch denial;
- expired-token denial;
- refresh rotation and replay denial;
- access-token and refresh-token revocation;
- cross-tenant, cross-workspace, and cross-Brand denial;
- endpoint, client, and global disable readback.

## Monitoring

Alert on bounded aggregates only:

- registration attempts and failures;
- rejected redirect Origins;
- authorization failures by safe error class;
- invalid or expired signed authorization requests;
- token exchanges and refresh rotations;
- revoked or inactive grant use;
- invalid issuer, audience, resource, subject, tenant, client, scope, and signature counts;
- protected tool latency and dependency failure counts.

Never log signed authorization requests, authorization codes, access tokens, refresh tokens, client secrets, passwords, raw authorization headers, or raw grant rows.

## Rollback

Rollback is ordered from least disruptive to broadest:

1. Disable DCR.
2. Remove an approved DCR redirect Origin.
3. Disable or revoke one OAuth client row.
4. Revoke one user grant or all grants for one client.
5. Disable one tool in the governed catalog.
6. Set `REMOTE_MCP_ENABLED=false`.
7. Set `REMOTE_MCP_OAUTH_ENABLED=false`.
8. Roll the runtime back to the previously verified SHA.

Do not drop OAuth tables during an incident. Retain them for revocation, audit, reconciliation, and safe recovery.

## Current delivery boundary

Source implementation and synthetic tests do not establish production readiness. Until live evidence exists, the following remain incomplete:

- migration application;
- dedicated signing-secret provisioning and rotation drill;
- redirect-Origin allowlist approval;
- DNS and TLS verification;
- non-production deployment;
- real client registration;
- MCP Inspector acceptance;
- ChatGPT Developer mode acceptance;
- Claude Custom Connector acceptance;
- neutral-client acceptance;
- Production promotion and rollback rehearsal.

## Repository generated-evidence checkpoint

The final reviewed source before generation was `9c345b5bd71a95de7225f32176adda89eee83c62`. The repository-owned frontend generator produced result head `ebe9cc1c2e1dc3a996a57100b1aaf38718be7f00`.

The generated write-set was limited to:

- `http-generic-api/frontend-operation-governance.generated.json`;
- `http-generic-api/frontend-surface-dispatch.generated.json`;
- `http-generic-api/openapi/frontend-runtime-routes.generated.yaml`.

The generated result adds the Remote MCP OAuth OpenAPI contract and current route/source fingerprints to bounded frontend evidence. It changes no OAuth runtime handler, migration, workflow, credential, provider, deployment, DNS, protected branch, feature flag, or Production state. Exact-head verification must run on a subsequent human-reviewed head containing this result.
