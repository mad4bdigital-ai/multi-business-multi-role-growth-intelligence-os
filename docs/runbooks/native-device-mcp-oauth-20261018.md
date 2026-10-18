# Native Device MCP — OAuth resource server (P0 source slice)

**Status:** Draft source only. Disabled by default; **not** certified against a live OAuth issuer, Staging, ChatGPT, Claude or Production.

## Endpoint boundary

- Public-facing route through `connector.mad4b.com`: `POST /mcp/device` after a separately authorized Cloudflare tunnel; Local Connector continues listening on `127.0.0.1`.
- Public metadata: `GET /.well-known/oauth-protected-resource/mcp/device` only when configured.
- Implements JSON-RPC `initialize`, `ping`, `notifications/initialized`, `tools/list`, `tools/call` (stateless Streamable HTTP JSON response; no server push or resumable SSE transport).
- **Separate OAuth resource** — bearer must be RS256 signed against provisioned, pinned public JWKS. Admin Recovery Connector secret, Production backend key or Staging token forwarded via another route are never accepted.
- `issuer` is fixed by `CONNECTOR_DEVICE_MCP_ENVIRONMENT` (Staging: `https://dev.mad4b.com`; Production: `https://auth.mad4b.com`). `resource` is fixed to `https://connector.mad4b.com/mcp/device`. Claims must match `aud`, `iss`, `device_id`, `tenant_id`, `environment`, `sub`, `azp/client_id`, `iat`, `exp`, with maximum JWT lifetime of one hour.
- Dynamic discovery only exposes tools allowed by both OAuth scopes and effective local opt-in. No client-controlled command strings, arbitrary device IDs, file writes or interactive shell.
- Terminal sessions are constrained to `oauth:<tenant>:<subject>:<client>`; local Connector sessions use a separate admin principal.
- Transcripts can be resumed while the same Connector process remains alive; after restart only their stored output can be recovered and they are marked `interrupted`.

## Required OS-private configuration

```env
CONNECTOR_DEVICE_MCP_ENABLED=false
CONNECTOR_DEVICE_MCP_ENVIRONMENT=staging
CONNECTOR_DEVICE_MCP_ISSUER=https://dev.mad4b.com
CONNECTOR_DEVICE_MCP_RESOURCE=https://connector.mad4b.com/mcp/device
CONNECTOR_TENANT_ID=<actual-tenant-id>
CONNECTOR_DEVICE_ID=<actual-bound-device-id>
CONNECTOR_DEVICE_MCP_JWKS_JSON={"keys":[{"kty":"RSA","kid":"...","alg":"RS256","use":"sig","n":"...","e":"AQAB"}]}
```

Never put private signing keys in Connector, repositories, logs or prompts. Public JWKS rotation, actual token issuance, OAuth consent, authorization-server metadata, and per-client onboarding **must be completed independently** before enabling this flag. Production is separate and remains off.

## MCP tool families implemented in source

| Family | Tools | Required scope |
| --- | --- | --- |
| Device | `devices_health` | `device:status:read` |
| Files | `files_list`, `files_read`, `files_info`, `files_search` | `device:files:read` |
| Sessions | `sessions_list`, `sessions_get`, `sessions_resume` | `device:terminal:read` |
| Terminal | `terminal_output`, `terminal_start_readonly` | Read or separate execute grant |
| Processes | `process_list`, `process_status` (owned only) | `device:terminal:read` |

Not yet exposed: arbitrary terminal STDIN, filesystem patches, process kills, PTY, ConPTY, file moves, document adapters, restart-time process reattachment. A separate local approval channel and live Windows security acceptance must precede their MCP exposure.

## Focused verification

```sh
node --test local-connector/test-device-mcp-resource.mjs
node --test local-connector/test-device-terminal-engine.mjs
node --test http-generic-api/test-connector-staging-mcp-distribution.mjs
node --check local-connector/server.mjs
```

**Release gates:** certificates for JWT signer/key rotation; real OAuth authorization-code/PKCE; MCP conformance for at least two clients; network-failure and unauthorized crossover tests; Desktop UI consent receipts; staging installation/rollback; current-head CI and owner attestation. None of these are waived by successful source-level checks.
