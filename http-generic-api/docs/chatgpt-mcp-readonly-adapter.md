# ChatGPT MCP Read-Only Adapter

## Purpose

This runtime wave adds a standards-oriented MCP endpoint for ChatGPT and Codex without changing the existing split MCP routes.

The new surface is disabled by default and exposes only focused read-only tools.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/.well-known/oauth-protected-resource` | GET | OAuth protected-resource metadata |
| `/mcp` | POST | MCP initialize, notifications, ping, tool listing, and tool calls |
| `/mcp` | GET | Returns `405`; server-initiated SSE is not enabled in this stateless wave |

Legacy compatibility routes remain unchanged:

- `POST /mcp/initialize`
- `GET /mcp/tools/list`
- `POST /mcp/tools/call`

## Feature flags

### `CHATGPT_MCP_ENABLED`

Default: `false`.

When not exactly `true`, the new metadata and `/mcp` surfaces return `404` and expose no catalog.

### `CHATGPT_MCP_LEGACY_USER_JWT_ENABLED`

Default: `false`.

Temporary development bridge for protected read-only tool calls using the existing platform user JWT verifier. It does not represent completed OAuth 2.1 conformance and must not be treated as the public production authentication contract.

Keep this disabled until a controlled development connection needs read-only end-to-end testing.

## Endpoint and metadata configuration

| Variable | Default | Purpose |
|---|---|---|
| `CHATGPT_MCP_RESOURCE_URL` | `https://mcp.mad4b.com` | Canonical OAuth resource-server origin |
| `CHATGPT_MCP_AUTHORIZATION_SERVER_URL` | `https://auth.mad4b.com` | Authorization-server issuer/discovery origin |
| `CHATGPT_MCP_RESOURCE_DOCUMENTATION_URL` | `<resource>/docs` | Public resource documentation URL |
| `CHATGPT_MCP_ALLOWED_ORIGINS` | `https://chatgpt.com,https://www.chatgpt.com` | Comma-separated browser Origin allowlist |

The resource URL must not contain access tokens, backend keys, client secrets, or user-specific identifiers.

## Transport boundary

The first wave is stateless and JSON-RPC based:

- supported protocol versions: `2025-06-18` and `2025-03-26`;
- POST requires `Content-Type: application/json`;
- POST `Accept` must contain both `application/json` and `text/event-stream`;
- initialization returns server capabilities and read-only instructions;
- client notifications return `202` without a body;
- unsupported methods return JSON-RPC method-not-found;
- browser `Origin` is validated before request processing;
- request and result evidence contains no secrets.

The endpoint does not yet implement resumable SSE sessions or server-initiated notifications.

## Read-only tools

### `list_accessible_workspaces`

Returns active workspaces derived from the authenticated user’s active memberships joined to active tenants.

It never accepts a user or tenant authority override.

### `list_accessible_brands`

Requires a `workspace_id` returned by the workspace tool.

The server first verifies active membership in that workspace. It then reads effective Brand grants and bounded Brand metadata. A supplied workspace ID is only a selector and cannot grant access.

## Authentication behavior

Tool metadata declares OAuth scopes:

- `workspaces.read`
- `brands.read`

Without a supported authenticated principal, tool calls return an MCP tool error containing `_meta["mcp/www_authenticate"]` and the protected-resource metadata location.

The temporary legacy JWT bridge uses the existing `verifyUserJwtAuthorization` function only when its separate flag is enabled. Full OAuth delivery still requires:

- authorization-server discovery;
- authorization code with PKCE `S256`;
- resource propagation;
- resource/audience validation;
- scope validation;
- revocation behavior;
- approved ChatGPT client registration.

## Security boundaries

- No write tool is exposed.
- Existing broad tools such as generic registry execution and arbitrary app connection calls are not exported by the new catalog.
- Tool annotations are read-only, non-destructive, and closed-world.
- Query-string credentials are not accepted by the new route.
- Authorization headers, tokens, provider credentials, and raw grants are excluded from results and evidence.
- Cross-workspace requests fail with a neutral context-denied result.
- Existing legacy routes are isolated until consumer inventory and deprecation approval are complete.

## Local test

From `http-generic-api`:

```bash
node test-chatgpt-mcp-readonly-runtime.mjs
```

Or through the canonical manifest:

```bash
node scripts/run-test-manifest.mjs --grep chatgpt-mcp-readonly
```

## Current delivery boundary

This wave does not:

- add a database migration;
- implement an OAuth authorization server;
- register an OAuth client;
- deploy or change DNS/TLS;
- create a ChatGPT connection;
- add write tools;
- package or publish the plugin;
- enable the feature in Production.
