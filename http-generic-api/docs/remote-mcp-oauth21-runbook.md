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

## HTTP challenge contract

Remote MCP uses the HTTP authorization challenge defined by the MCP Authorization specification and RFC 6750 in addition to the JSON-RPC error envelope. A protected `tools/call` request without a valid Bearer token returns **HTTP 401** and includes a `WWW-Authenticate` header in the form:

```text
Bearer resource_metadata="<protected-resource-metadata-url>", scope="<least-privilege-required-scope>"
```

The response also retains the structured `MCP_AUTH_REQUIRED` error and the `mcp/www_authenticate` metadata for clients that inspect the JSON-RPC body. A token that is valid but lacks the required scope returns **HTTP 403** with a `WWW-Authenticate` challenge; the server never silently widens scopes or downgrades the request to HTTP 200. Clients must use the advertised protected-resource metadata URL to discover the authorization server and then complete the registered OAuth/PKCE flow.

Discovery is not authorization. Fetching protected-resource metadata, authorization-server metadata, or the tool catalog does not grant workspace, tenant, or Brand data access. A remote HTTP account-linking flow is accepted only after the client is represented in the dedicated `remote_mcp_oauth_clients` persistence boundary and the user has completed consent, token issuance, and active-grant checks. Tenant GPT OAuth client identities and tables are never valid substitutes for Remote MCP clients.

The same contract applies to the Staging and Production deployments, with environment-specific resource and issuer endpoints. The canonical scope authority remains `https://auth.mad4b.com/scopes/*` in both environments; Staging may use `dev.mad4b.com` for its resource and OAuth endpoint hosts, but must not publish `https://dev.mad4b.com/scopes/*` as scope authority.

## Governed per-environment client provisioning

Remote MCP client credentials are provisioned independently for each environment by the operator CLI. The flow reuses the existing `remote_mcp_oauth_clients`, `platform_runtime_config`, and `platform_secrets` boundaries; it does not create a new database or a second OAuth client table.

New client IDs are environment-prefixed so that identity mistakes fail closed at the runtime boundary:

| Environment | Resource and issuer hosts | Client ID prefix | Secret storage key |
|---|---|---|---|
| Staging | `mcp_dev.mad4b.com` and `dev.mad4b.com` | `mcp_stg_` | `REMOTE_MCP_STAGING_OAUTH_CLIENT_SECRET` |
| Production | `mcp.mad4b.com` and `auth.mad4b.com` | `mcp_prd_` | `REMOTE_MCP_PRODUCTION_OAUTH_CLIENT_SECRET` |

The generated client secret is at least 32 characters and is never committed to Git, placed in an `.env.example` file, or returned by readiness/status endpoints. Durable storage keeps only encrypted ciphertext and a SHA-256 evidence digest in `platform_secrets`, while the OAuth client row keeps the verification hash in `remote_mcp_oauth_clients`. The provisioning command returns a newly generated secret once so the operator can place it in the approved external client configuration; a later run without `--rotate` preserves the existing secret and returns no secret payload.

Provisioning requires an explicit environment and confirmation token. It also requires at least one exact approved HTTPS callback URI; the callback must be approved in the selected environment before execution:

```bash
# Staging: run only against the approved Staging runtime DB.
npm run remote-mcp:client:provision -- \
  --environment=staging \
  --confirm=PROVISION_REMOTE_MCP_STAGING \
  --redirect-uri=<approved-exact-https-callback>

# Production: this is a separate governed operation and is not executed by this PR.
npm run remote-mcp:client:provision -- \
  --environment=production \
  --confirm=PROVISION_REMOTE_MCP_PRODUCTION \
  --redirect-uri=<approved-exact-https-callback>

# Non-secret readback only.
npm run remote-mcp:client:status -- --environment=staging
npm run remote-mcp:client:status -- --environment=production
```

Before a Production command is run, independently verify the target database, canonical Production resource/issuer, approved callback, secret-storage authority, and owner authorization. This source change defines and tests the provisioning boundary but does not execute Production provisioning, migration, grant, activation, deployment, or client linking. Existing unprefixed DCR identities remain temporarily accepted for compatibility; all newly provisioned identities use the environment-specific prefixes and a Staging runtime rejects `mcp_prd_*` identities while Production rejects `mcp_stg_*` identities.

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
