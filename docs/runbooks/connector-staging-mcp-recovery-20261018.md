# MAD4B Connector Staging and MCP Recovery
18 October 2026 — source candidate, not an approved deployment.

## Purpose
This bridge is a read-only Admin Recovery alternative when Production is truly
unavailable. It does not rebind the Connector environment, policy URL, heartbeat,
OAuth issuer, or Cloudflare service ownership. It does not redirect tenants
to Staging or promote Staging data into Production.

Production: auth.mad4b.com and mcp.mad4b.com.
Staging diagnostics: dev.mad4b.com and mcp-dev.mad4b.com.
The host connector.mad4b.com remains an Admin-only transport, not a replacement
MCP OAuth resource server or a general tenant connector.

## Config (disabled by default)

| Variable | Default | Purpose |
| --- | --- | --- |
| CONNECTOR_RECOVERY_STAGING_READONLY_ENABLED | false | Fixed-host read-only Staging diagnostic after Production outage |
| CONNECTOR_RECOVERY_STAGING_MCP_ENABLED | false | Staging MCP metadata, initialization, catalog and narrowly approved reads |
| CONNECTOR_DEVELOPER_SESSIONS_ENABLED | false | Bounded local developer sessions |
| CONNECTOR_DEVELOPER_REPO_ROOT | unset | Absolute repo root exactly listed in CONNECTOR_FILE_PATHS |
| CONNECTOR_DEVELOPER_TESTS_ENABLED | false | Separate opt-in to execute repo code at exact Git HEAD |

Do not enable these flags on tenant devices. Recovery requires the device-scoped
Connector credential, not a Production backend key. Restrict developer checks
to a reviewed low-privilege checkout, not a general administrator workspace.

## Endpoints

GET https://connector.mad4b.com/recovery/capabilities
- Authenticated, read-only inventory of Staging and developer capabilities.
- Does not execute a staging request or reveal credentials.

POST https://connector.mad4b.com/recovery/staging
- Body action=status: check Production without Staging operations.
- Body action=health: fixed Staging /health diagnostic.
- Body action=mcp_metadata: fixed Staging MCP OAuth resource metadata.
- Body action=mcp_initialize: fixed Staging MCP JSON-RPC initialize.
- Body action=mcp_catalog: fixed Staging MCP tools/list.
- Body action=mcp_tool_read: allows only list_accessible_workspaces or
  list_accessible_brands, with a bounded JSON arguments object.
- Catalog and tool reads require a separately issued Staging MCP OAuth bearer
  in x-mad4b-staging-mcp-bearer, injected by a trusted client (never pasted
  into ChatGPT text or stored in a URL). The upstream Staging MCP server
  must validate issuer, audience, scopes, tenant and object authorization.
- Connector/Production credentials are never forwarded to Staging.
- No dynamic target/host/path/method/redirect is accepted. No write MCP tool.

A fallback starts only on Production transport error or HTTP 5xx at
https://auth.mad4b.com/health. For MCP operations, HTTP 5xx or transport error
at the fixed Production protected-resource metadata endpoint also qualifies.
HTTP 401/403/404 and 3xx never count as outage authority. The output is bounded,
with timeout, no redirects and no unreviewed provider actions.

POST https://connector.mad4b.com/developer/sessions
- capabilities: view enabled tools.
- start with task git_status, git_diff_stat or git_log for read-only Git.
- start with task node_check, node_test or npm_test requires separately
  enabled repo-code execution and exact expected_head_sha (40 hexadecimal).
- node_check and node_test require a relative checked-in .js/.mjs/.cjs path
  inside the exact realpath of the configured repository root.
- status with session_id and cursor returns bounded, resumable process-local
  output. cancel with session_id terminates a running job.
- Caller-supplied arbitrary commands, shell arguments, directories, redirects,
  Git writes and elevated PowerShell are unsupported.
- Child processes inherit only minimal OS/PATH information; no Connector,
  Production, Cloudflare or other provider credentials.
- Maximum 2 running, 20 retained, 180 seconds each; 96 KiB output,
  8 KiB paged output; session state expires after 30 minutes.
- Process restarts clear session state. Best-effort output redaction is NOT
  a guarantee that source/test output has no secrets.

## Acceptance and deployment
1. All exact-head CI and generated OpenAPI parity checks succeed.
2. Run locally: node --test local-connector/test-connector-staging-recovery.mjs
3. Run locally: node --test local-connector/test-connector-developer-sessions.mjs
4. Verify current device/config identity, signed local installer, tunnel owner,
   and separate Staging and Production resource identities.
5. Test against a simulated Production outage before using the Admin bridge,
   without causing a real Production outage or altering Production.
6. Verify Production 401/403 fail-closed, Staging OAuth audience isolation,
   URL/redirect denial, command allowlists, and no credential crossover.
7. Prove Git read-only session status, exact-head Node test, cancellation,
   cursor paging, timeouts and post-restart behavior on a test device.
8. Merge only after owner review. Installing, activating flags, and updating
   Production services require separate change approval.

## Current limits
This source change does not provide a public Streamable HTTP MCP resource on
connector.mad4b.com, generic MCP tool execution, durable reboot-safe terminal
sessions, unattended high-risk device mutation, or any Production deployment.
It makes an explicit, independently authenticated and read-only Admin transport
available for Staging diagnostics after a confirmed Production outage. The
Staging MCP OAuth client remains independent and must already exist.
