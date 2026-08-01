# Multi-Client Connector Extension

## Purpose

This artifact extends Spec 016 from a ChatGPT-specific distribution target to one shared remote MCP server that supports multiple AI clients without duplicating platform authority or business logic.

The canonical resource remains:

```text
https://mcp.mad4b.com/mcp
```

The URL is proposed until DNS, TLS, routing, deployment ownership, and runtime health are verified.

## External authority reviewed on 2026-08-01

### Anthropic Claude custom connectors

Official Anthropic guidance confirms:

- Claude and Claude Desktop can connect to custom remote MCP servers.
- Custom connectors are configured by adding the remote MCP URL in Settings > Connectors.
- Claude supports Streamable HTTP and SSE remote servers, with Streamable HTTP preferred for the new implementation.
- Claude supports authless and OAuth-based remote servers.
- Claude supports the 2025-03-26 and 2025-06-18 MCP authorization contracts.
- Claude supports Dynamic Client Registration.
- Claude can also accept a custom client ID and secret when the server does not support DCR.
- Claude OAuth callback URL is `https://claude.ai/api/mcp/auth_callback` and the OAuth client name is `Claude`.
- Token expiry and refresh should be supported.
- Claude supports tools, prompts, and resources, but the first platform phase exposes tools only.

Sources:

- `https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp`
- `https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers`
- `https://docs.anthropic.com/en/docs/mcp`

### Model Context Protocol

The MCP authorization contract requires or recommends:

- one HTTP resource server acting on behalf of the user;
- OAuth 2.1-compatible authorization for protected HTTP transports;
- Protected Resource Metadata;
- Authorization Server Metadata or supported discovery;
- resource indicators binding access tokens to the exact MCP resource;
- PKCE for authorization code protection;
- explicit `WWW-Authenticate` challenges;
- correct 401, 403, and scope handling;
- Origin validation for Streamable HTTP;
- a single POST/GET MCP endpoint path.

Sources:

- `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`
- `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`

## Architectural rule

```text
AI clients
  ├─ ChatGPT / Codex
  ├─ Claude / Claude Desktop
  ├─ MCP Inspector
  └─ other approved MCP clients
          │
          ▼
One remote MCP protocol adapter
          │
          ▼
One client eligibility and OAuth boundary
          │
          ▼
Context Kernel + capability + policy authority
          │
          ▼
Tenant-safe reads / governed operations / evidence
```

A client profile may configure transport compatibility, OAuth registration, callback URIs, package metadata, directory metadata, known origins, rate limits, and acceptance tests.

A client profile may not configure or override tenant, workspace, Brand, resource, connection, capability, confirmation, operation, or provider authority.

## Client profile contract

Each supported client profile records:

| Field | Meaning |
|---|---|
| `client_profile_key` | Stable non-secret profile name |
| `provider` | OpenAI, Anthropic, internal, or other approved provider |
| `client_names` | Expected MCP client product names |
| `transport_versions` | Supported MCP protocol and transport versions |
| `registration_modes` | DCR, CIMD, predefined, or custom confidential client |
| `redirect_uris` | Exact approved callback URIs |
| `known_origins` | Explicit browser Origin allowlist where applicable |
| `allowed_scopes` | Maximum policy-approved scopes |
| `tool_catalog_policy` | Shared catalog plus any narrower policy filter |
| `rate_limit_policy` | Client-level quotas and abuse controls |
| `status` | draft, test, enabled, disabled, or retired |
| `evidence_version` | Exact compatibility and review snapshot |

Client profile recognition from Origin, User-Agent, package metadata, or client ID is an operational classification. Protected access still requires a valid token, eligible client registration, current user membership, and object-level authorization.

## Required neutral runtime configuration

New runtime work should prefer:

```text
REMOTE_MCP_ENABLED
REMOTE_MCP_LEGACY_USER_JWT_ENABLED
REMOTE_MCP_RESOURCE_URL
REMOTE_MCP_AUTHORIZATION_SERVER_URL
REMOTE_MCP_RESOURCE_DOCUMENTATION_URL
REMOTE_MCP_ALLOWED_ORIGINS
```

The original `CHATGPT_MCP_*` names may remain temporary compatibility aliases. They must not remain the permanent public architecture vocabulary.

## OpenAI distribution profile

The OpenAI profile may include:

- ChatGPT Developer mode connection;
- Codex plugin package;
- `.codex-plugin/plugin.json`;
- environment-specific `.app.json` binding;
- a technical connection ID beginning with `plugin_asdk_app...`;
- OpenAI review, approval, and publication evidence.

The live technical connection ID and OAuth secrets must not be committed into reusable source.

## Anthropic distribution profile

The Anthropic profile may include:

- Claude or Claude Desktop custom connector configuration;
- exact remote MCP URL;
- DCR or approved custom client credentials;
- exact callback URI registration;
- token expiry and refresh support;
- Claude custom connector acceptance evidence;
- optional Anthropic Connectors Directory submission after production readiness.

Directory or connector configuration does not create additional tool authority.

## Generic MCP client profile

A generic client can be added when it proves:

1. compatible Streamable HTTP initialization;
2. supported protocol version negotiation;
3. protected-resource and authorization-server discovery;
4. PKCE and resource-bound token handling;
5. correct scope and revocation behavior;
6. correct tool schema and result handling;
7. no cross-tenant data leakage;
8. explicit client-policy approval;
9. independent disable and revoke controls;
10. metadata fingerprint parity.

Generic support does not mean unrestricted support. Unknown browser origins fail closed. Non-browser clients that omit Origin remain subject to OAuth and client registration.

## Shared tool catalog rules

- Tool names, schemas, annotations, result structures, and authority bindings are canonical and shared.
- A client policy may hide a tool but may not silently widen it.
- Client-specific descriptions may clarify UI behavior but may not alter side effects.
- Every client receives stable resource and operation IDs for follow-up.
- Write tools remain blocked until the shared write contract is accepted.

## Compatibility strategy

### Current draft implementation

The first runtime PR uses a neutral wrapper over the initial ChatGPT-named implementation. This creates immediate multi-client routing while preserving the already-tested implementation.

### Required cleanup

After the shared contract is accepted:

1. rename internal ChatGPT-specific modules to neutral remote MCP names;
2. retain temporary re-export aliases for existing imports;
3. move client profiles into a canonical registry;
4. bind client profile eligibility to OAuth client registration and rollout policy;
5. remove old aliases only after repository and runtime consumer inventory proves zero use.

## Cross-client acceptance

The same exact source SHA and deployment must be tested with:

- MCP Inspector;
- ChatGPT Developer mode;
- Claude Custom Connector;
- one neutral programmatic MCP client.

Required parity:

- server identity;
- protocol version;
- tool catalog fingerprint;
- tool annotations;
- OAuth resource identifier;
- scopes;
- error taxonomy;
- result schemas;
- tenant isolation;
- no-secret evidence.

Differences must be limited to client registration, callback, packaging, UI, and distribution metadata.

## Rollout and rollback

Rollout is independent by client profile:

1. disabled globally;
2. enabled for MCP Inspector in development;
3. enabled for one OpenAI test client;
4. enabled for one Anthropic test client;
5. enabled for approved internal generic clients;
6. enabled for selected workspaces;
7. enabled for governed writes only after separate approval;
8. submitted to directories or marketplaces only after production parity.

Rollback may disable one client profile without disabling the shared server for other approved clients.

## New blocking evidence

- Anthropic callback and registration strategy approved.
- DCR/CIMD/predefined-client policy approved.
- Claude token refresh and revocation acceptance completed.
- Cross-client metadata fingerprint parity completed.
- Client-specific rate limits and abuse controls approved.
- Client profile registry and lifecycle authority identified.
- Live Claude Custom Connector test completed against a non-production endpoint.
