# Remote MCP Multi-Client Connector

## Objective

Expose one governed remote MCP resource that can be connected from ChatGPT, Codex, Claude, Claude Desktop, and other standards-compliant MCP clients without creating a separate business-logic runtime for each AI platform.

The public contract is the MCP server and OAuth resource. Client-specific packaging, directory submission, UI, or workspace configuration remains an optional distribution layer around the same server.

## Supported client profiles

| Profile | Current use | Transport | Authentication |
|---|---|---|---|
| `openai_chatgpt` | ChatGPT and Codex developer/plugin connections | Streamable HTTP | OAuth 2.1 target |
| `anthropic_claude` | Claude and Claude Desktop custom connectors | Streamable HTTP | OAuth 2.1 target |
| `generic_remote_mcp_client` | Any separately approved MCP client | Streamable HTTP | OAuth 2.1, or authless only when policy explicitly allows public data |

Client-profile detection is operational metadata only. It never grants tenant, workspace, Brand, resource, connection, capability, or write authority.

## Configuration

New neutral environment variables are preferred:

```text
REMOTE_MCP_ENABLED
REMOTE_MCP_LEGACY_USER_JWT_ENABLED
REMOTE_MCP_RESOURCE_URL
REMOTE_MCP_AUTHORIZATION_SERVER_URL
REMOTE_MCP_RESOURCE_DOCUMENTATION_URL
REMOTE_MCP_ALLOWED_ORIGINS
```

The existing `CHATGPT_MCP_*` variables remain temporary compatibility aliases during migration. New deployments should use the neutral names.

`REMOTE_MCP_ALLOWED_ORIGINS` is an explicit comma-separated allowlist. Wildcards are not supported. The default browser origins currently include ChatGPT and Claude. Non-browser MCP clients may omit `Origin`; OAuth, client registration, token resource binding, scopes, Context Kernel, and object authorization remain mandatory for protected tools.

## Claude custom connector compatibility

Claude custom connectors accept a remote MCP server URL. The same proposed endpoint is used:

```text
https://mcp.mad4b.com/mcp
```

Claude supports remote Streamable HTTP and OAuth-based MCP servers. The production implementation must still complete:

- OAuth protected-resource metadata;
- authorization-server discovery;
- approved client identification or Dynamic Client Registration;
- authorization code plus PKCE;
- resource-bound access tokens;
- expiry, refresh, revocation, scope, issuer, and audience validation;
- live connection tests from Claude settings and MCP Inspector.

Claude-specific callback/client registration values belong to identity configuration, not tool handlers or tenant data tables.

## Generic client compatibility

A new AI client can connect without new business logic when it satisfies the approved compatibility contract:

1. supports the configured MCP protocol version;
2. uses Streamable HTTP at the canonical endpoint;
3. follows protected-resource and authorization-server discovery;
4. obtains a token issued for the exact MCP resource;
5. presents required scopes;
6. respects MCP tool schemas and result contracts;
7. is allowed by client-registration and tenant rollout policy.

A new client profile may add:

- known browser origins;
- client registration metadata;
- callback URIs;
- compatibility tests;
- package or directory metadata.

It may not add alternate tenant authority, bypass OAuth, widen tools, or reinterpret write confirmation.

## Runtime layering

```text
Remote MCP clients
  ├─ ChatGPT / Codex
  ├─ Claude / Claude Desktop
  └─ other approved MCP clients
          │
          ▼
remoteMcpConnectorRuntime.js
  ├─ neutral environment aliases
  ├─ client profile classification
  ├─ explicit Origin allowlist
  └─ shared response metadata
          │
          ▼
chatgptMcpRuntime.js
  └─ temporary phase-1 protocol/tool implementation
          │
          ▼
Context Kernel, capability, policy, projections, operations, evidence
```

The existing ChatGPT-named runtime remains an internal compatibility implementation in this draft PR. A later cleanup PR may rename or split it after the generic contract is proven, without changing the public `/mcp` endpoint or tool semantics.

## Current safety boundary

- disabled by default;
- read-only tools only;
- no generic execution or arbitrary connected-app tool;
- no query-string credential on the new route;
- no migration;
- no OAuth client registration;
- no DNS, deployment, Production, directory, plugin, or connector publication;
- legacy user JWT bridge separately disabled by default;
- profile detection does not authorize access.

## Required acceptance matrix

| Test | ChatGPT | Claude | Generic client |
|---|---:|---:|---:|
| Initialize and protocol negotiation | required | required | required |
| Tool discovery parity | required | required | required |
| OAuth discovery and PKCE | required | required | required |
| Resource/audience binding | required | required | required |
| Token expiry, refresh, revocation | required | required | required |
| Tenant/workspace/Brand isolation | required | required | required |
| Read-only annotation parity | required | required | required |
| Metadata fingerprint parity | required | required | required |
| Disable and revoke drill | required | required | required |

No client is considered supported in Production until its live acceptance row is complete.

## Generated evidence refresh

The repository automation regenerated the deterministic frontend operation-governance and surface-dispatch evidence after the neutral route, metadata router, and canonical test-manifest changed. This evidence refresh records source parity only. It does not enable the MCP route, register an OAuth client, create a ChatGPT or Claude connection, authorize deployment, or grant Production authority.
