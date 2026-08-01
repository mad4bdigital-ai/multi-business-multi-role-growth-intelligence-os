# Research — Multi-Client AI Connector and MCP Integration

## Research date and evidence boundary

- Research date: 2026-08-01.
- Repository baseline: `main` at `464c11803d8cb84ba39863c5e55e05f30dbca8da`.
- External authorities: current OpenAI Plugins, Anthropic Claude custom connector, and Model Context Protocol documentation.
- This document records verified contracts and design implications. It does not claim the proposed public endpoint, OAuth flow, ChatGPT connection, Claude connector, or generic-client support is deployed.

## Shared architectural finding

ChatGPT, Codex, Claude, Claude Desktop, MCP Inspector, and other approved MCP clients can be treated as distribution and invocation clients around one standards-compliant remote MCP resource.

The correct reusable unit is therefore:

- one public `/mcp` transport;
- one OAuth resource identifier;
- one canonical tool catalog;
- one Context Kernel and capability/policy authority path;
- client-specific registration, callback, package, directory, and acceptance metadata.

A client profile can narrow visibility or add compatibility metadata. It cannot grant tenant, workspace, Brand, resource, connection, capability, or operation authority.

## OpenAI plugin architecture

A plugin is an installable package for ChatGPT and Codex. It may contain:

- skills with repeatable workflow instructions;
- an MCP server that exposes tools and external data or actions;
- both skills and MCP;
- optional UI resources returned by MCP.

The smallest viable shape is preferred. The initial OpenAI distribution profile therefore uses the shared MCP server without custom UI. Skills and UI can be added after the tool and authorization contracts are stable.

## OpenAI connection and test flow

The supported developer flow is:

1. enable Developer mode in ChatGPT;
2. create a plugin connection using the deployed MCP server URL;
3. review discovered tools and metadata;
4. install or select the personal plugin;
5. invoke it from a ChatGPT Work conversation;
6. evaluate direct, indirect, follow-up, invalid, and unsupported requests.

A private MCP server may be tested through Secure MCP Tunnel or another development tunnel, but public submission requires a stable publicly reachable HTTPS endpoint.

## Anthropic Claude custom connector findings

Official Anthropic guidance confirms:

- Claude and Claude Desktop can connect to remote custom connectors backed by MCP.
- A user adds the remote MCP server URL through Settings > Connectors and authenticates the connection when required.
- Remote Streamable HTTP is supported and is the preferred target for the new platform integration; SSE is retained as a compatibility transport in Claude guidance.
- Claude custom connectors can use authless or OAuth-based servers, but the platform requires OAuth for private data and writes.
- Claude supports the 2025-03-26 and 2025-06-18 MCP authorization contracts.
- Dynamic Client Registration is supported.
- A custom client ID and secret may be supplied when the server does not support DCR and the deployment policy permits that model.
- The documented Claude callback URL is `https://claude.ai/api/mcp/auth_callback`, with OAuth client name `Claude`.
- Access-token expiry and refresh should be supported.
- Claude supports MCP tools, prompts, and resources; phase 1 of this platform exposes tools only.

Design implication: Claude is not a separate backend implementation. It is an Anthropic client profile around the same MCP endpoint, OAuth resource, tools, context resolution, and platform governance used by OpenAI and neutral clients.

## MCP transport and server contract

Current OpenAI, Anthropic, and MCP guidance converges on:

- Streamable HTTP transport;
- a stable endpoint, normally ending in `/mcp`;
- initialization, tool listing, and tool calls through the MCP transport rather than custom split REST routes;
- useful initialization instructions, with the most important shared guidance early and without personality manipulation;
- structured, bounded tool results;
- Origin validation for browser-based Streamable HTTP clients;
- logs and metrics for initialization and tool failures.

The current MCP transport contract uses one server endpoint for POST and supported GET behavior. The repository is Node/Express based, so the TypeScript/JavaScript MCP SDK path is the natural long-term implementation candidate, subject to compatibility review with the existing runtime.

A generic non-browser MCP client may omit `Origin`. That does not authorize access: OAuth client eligibility, resource-bound tokens, scopes, Context Kernel, capability policy, and object-level authorization remain mandatory for protected tools.

## Tool design findings

OpenAI guidance favors one focused tool per recognizable user action. The same design improves Claude and generic-client selection behavior. Tool metadata must include:

- action-oriented name;
- human-readable title;
- description explaining when to use it;
- explicit input schema;
- output schema for structured output when applicable;
- accurate safety annotations;
- an authorized handler.

The model uses metadata to choose whether and how to invoke a tool. Broad tools such as `execute_action` and `app_connection_call` may remain internal dispatch primitives, but they should not be the primary public experience for any client. A public tool should map a user goal to a bounded internal operation.

Tool annotation rules:

- `readOnlyHint=true` only when no state can change;
- `destructiveHint=true` when an action is irreversible or difficult to reverse;
- `openWorldHint=true` when the tool can affect public or external systems.

Annotations influence host safety and confirmation behavior but do not replace platform authorization, validation, confirmation, or evidence.

## Result-shape findings

A tool result can use:

- `structuredContent` for concise data the model can reuse;
- `content` for model-readable text or other MCP content;
- `_meta` for client-specific data hidden from the model where the host supports that contract.

Stable identifiers should be returned for safe follow-up requests and cross-client operation status. `_meta` is not a secret store; all result channels remain subject to data minimization and redaction.

## Authentication findings

Private user data and write actions should authenticate users. The expected MCP authorization posture is OAuth 2.1 compatible and includes:

- protected-resource metadata on the MCP resource server;
- OAuth or OpenID discovery metadata on the authorization server;
- propagation and validation of the `resource` parameter;
- authorization code flow with PKCE `S256`;
- client identification through CIMD, dynamic client registration, a predefined client, or another specifically approved mechanism;
- bearer access tokens on subsequent MCP requests;
- resource, issuer, audience, expiry, scope, subject, client eligibility, and revocation validation.

A typical protected-resource metadata endpoint is `/.well-known/oauth-protected-resource`. An unauthenticated protected request can return a `WWW-Authenticate` challenge pointing to that metadata.

The MCP authorization contract distinguishes the MCP server as a resource server from the authorization server. It also requires resource indicators to prevent a token issued for one service from being replayed against another.

OpenAI recommends using an established identity provider rather than implementing authentication from scratch. The existing platform identity service is therefore the first reuse candidate, but it must be assessed against every required discovery, client registration, PKCE, refresh, token, scope, resource, and revocation contract for each client profile.

## OpenAI package findings

Every packaged OpenAI plugin has `.codex-plugin/plugin.json`. Depending on its architecture, the plugin root may also contain:

- `skills/`;
- `.app.json` for a registered MCP connection mapping;
- `.mcp.json` for bundled MCP server configuration;
- `hooks/`;
- `assets/`.

Only `plugin.json` belongs inside `.codex-plugin/`. Package paths are relative to the plugin root and normally start with `./`.

When a developer-mode MCP connection is created, ChatGPT exposes a technical ID beginning with `plugin_asdk_app`. That ID is environment/account specific. It must not be hard-coded into a reusable public source template. The implementation should provide an example or generator that binds the correct ID after connection creation.

A richer published manifest commonly includes display name, descriptions, developer identity, category, capabilities, website, privacy policy, terms, starter prompts, brand color, icons, logo, and screenshots where UI exists.

## Anthropic and generic-client distribution findings

Claude custom connector configuration requires the remote MCP URL and the applicable OAuth/client-registration configuration. Any callback URI, client ID, client secret, or directory metadata is an environment-specific binding and must remain outside reusable tool contracts.

A generic client can reuse the endpoint when it proves:

- supported protocol negotiation;
- Streamable HTTP compatibility;
- protected-resource and authorization-server discovery;
- approved client registration;
- PKCE and resource-bound token handling;
- scope, expiry, refresh, and revocation behavior;
- correct tool and result-schema handling;
- isolation and no-secret behavior;
- independent disable control.

“Generic client” does not mean open access. Browser origins remain explicitly allowlisted, and every protected request remains subject to client and user authorization.

## Review and publication findings

OpenAI public submission requires more than a working endpoint. Relevant requirements include:

- organization or individual verification for the intended publisher name;
- appropriate Apps Management / app submission write permission;
- a public production MCP endpoint, not a local or testing URL;
- accurate scanned tool metadata and annotations;
- company and privacy policy URLs;
- test prompts, expected responses, and test access where needed;
- optional screenshots only when the plugin has UI;
- policy attestations and release notes;
- review approval before the developer publishes the approved version.

Reviewed OpenAI MCP metadata is versioned. Changing tool metadata or linked UI metadata after publication requires a new scan, submission, approval, and publication cycle.

Anthropic custom connector use and any later Connectors Directory distribution require their own environment, identity, testing, privacy, availability, and review evidence. Approval or listing in one ecosystem does not authorize another ecosystem or alter platform runtime authority.

## Security and privacy findings

Required design posture:

- least privilege for scopes, storage, client profiles, and network access;
- explicit consent for account linking and write access;
- defense in depth against prompt injection and malicious input;
- server-side authorization on every call;
- client identification as evidence, never tenant authority;
- minimal task-specific inputs;
- no request for full conversation history or broad context without a necessary declared purpose;
- clear privacy policy covering data categories, purposes, recipients, retention, and user controls;
- exact CSP and network domains for any optional UI;
- no live client IDs, client secrets, access tokens, refresh tokens, callback secrets, or account-specific connection IDs in reusable source.

## Repository baseline findings

### Existing route shape

`http-generic-api/routes/mcpRoutes.js` on the verified baseline mounts:

- `POST /mcp/initialize`;
- `GET /mcp/tools/list`;
- `POST /mcp/tools/call`.

This is a custom split route contract, not the desired single Streamable HTTP endpoint.

### Existing authentication shape

`http-generic-api/mcpRuntime.js` on the verified baseline:

- rejects `Authorization` headers;
- optionally validates `BACKEND_API_KEY` from the `token` query parameter;
- returns custom JSON errors for invalid auth.

This must not be reused as the public remote MCP authentication contract because resource-bound bearer tokens and OAuth discovery are required for private user data and writes.

### Existing tool shape

The runtime includes tools for developer-agent proposals, session summaries, app connections, a generic registry action, and generic connected-app calls. Several tools accept `tenant_id` directly. The new public adapter must resolve tenant authority from the authenticated principal, then treat any identifier only as a bounded selector.

### Reuse opportunities

- Existing MCP handler concepts can inform the adapter but should not define the external transport contract.
- Context Kernel and tenant-safe projections can resolve principal and resource context.
- Capability and policy registries can decide tool and client eligibility and authorization.
- Operation and evidence surfaces can provide idempotency, durable status, unknown-outcome handling, and readback.
- Connector/provider authorities can perform external actions without exposing credentials to MCP.
- Existing registry-driven architecture can generate one reviewed tool catalog rather than maintain unrelated per-client lists.

## Decision summary

| Decision | Result | Reason |
|---|---|---|
| Canonical integration | One shared remote MCP resource | Avoid duplicate business logic and authority drift |
| Client profiles | OpenAI, Anthropic, generic approved client | Separate compatibility/distribution from platform authority |
| Transport | New Streamable HTTP `/mcp` adapter | Align with current OpenAI, Anthropic, and MCP contracts |
| Authentication | OAuth 2.1 resource server | Required for private data and writes |
| Client registration | DCR, CIMD, predefined, or explicitly approved mode per environment | Different clients support different registration paths |
| Existing query token | Legacy compatibility only | Secret-in-URL and no user/resource authorization |
| Initial tool catalog | Shared read-only, focused tools | Lower review and operational risk with parity across clients |
| Generic internal dispatch | Reuse behind focused tools | Preserve platform authority without exposing a super-tool |
| Tenant selection | Resolve from token and Context Kernel | Prevent model- or client-controlled authority |
| Origin | Explicit browser allowlist, optional for non-browser clients | DNS-rebinding defense without treating Origin as authentication |
| UI | No phase-1 UI | Tool workflows must work consistently across clients first |
| Packaging | Target-specific templates plus environment binding | Avoid committing account-specific connection and client IDs |
| Delivery | Multi-PR | Transport, auth, clients, tools, packaging, rollout, and review need separate evidence |
