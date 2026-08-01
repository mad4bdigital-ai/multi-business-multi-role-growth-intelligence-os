# Research — ChatGPT Plugin and MCP Integration

## Research date and evidence boundary

- Research date: 2026-08-01.
- Repository baseline: `main` at `464c11803d8cb84ba39863c5e55e05f30dbca8da`.
- External authority: current OpenAI Plugins documentation reached from the former Apps SDK URL.
- This document records verified contracts and design implications. It does not claim the proposed public endpoint or OAuth flow is deployed.

## OpenAI plugin architecture

A plugin is an installable package for ChatGPT and Codex. It may contain:

- skills with repeatable workflow instructions;
- an MCP server that exposes tools and external data or actions;
- both skills and MCP;
- optional UI resources returned by MCP.

The smallest viable shape is preferred. The initial platform integration therefore uses MCP without custom UI. Skills and UI can be added after the tool and authorization contracts are stable.

## Connection and test flow

The supported developer flow is:

1. enable Developer mode in ChatGPT;
2. create a plugin connection using the deployed MCP server URL;
3. review discovered tools and metadata;
4. install or select the personal plugin;
5. invoke it from a ChatGPT Work conversation;
6. evaluate direct, indirect, follow-up, invalid, and unsupported requests.

A private MCP server may be tested through Secure MCP Tunnel or another development tunnel, but public submission requires a stable publicly reachable HTTPS endpoint.

## MCP transport and server contract

The current OpenAI guidance expects:

- Streamable HTTP transport;
- a stable endpoint, normally ending in `/mcp`;
- initialization, tool listing, and tool calls through the MCP transport rather than custom split REST routes;
- useful initialization instructions, with the most important shared guidance early and without personality manipulation;
- structured, bounded tool results;
- logs and metrics for initialization and tool failures.

Official TypeScript and Python MCP SDKs are supported. The repository is Node/Express based, so the TypeScript/JavaScript SDK path is the natural implementation candidate, subject to compatibility review with the existing runtime.

## Tool design findings

OpenAI guidance favors one focused tool per recognizable user action. Tool metadata must include:

- action-oriented name;
- human-readable title;
- description explaining when to use it;
- explicit input schema;
- output schema for structured output when applicable;
- accurate safety annotations;
- an authorized handler.

The model uses metadata to choose whether and how to invoke a tool. Broad tools such as `execute_action` and `app_connection_call` may remain internal dispatch primitives, but they should not be the primary public plugin experience. A public tool should map a user goal to a bounded internal operation.

Tool annotation rules:

- `readOnlyHint=true` only when no state can change;
- `destructiveHint=true` when an action is irreversible or difficult to reverse;
- `openWorldHint=true` when the tool can affect public or external systems.

Annotations influence host safety and confirmation behavior but do not replace platform authorization, validation, confirmation, or evidence.

## Result-shape findings

A tool result can use:

- `structuredContent` for concise data the model can reuse;
- `content` for model-readable text or other MCP content;
- `_meta` for client-specific data hidden from the model.

Stable identifiers should be returned for safe follow-up requests. `_meta` is not a secret store; all result channels remain subject to data minimization and redaction.

## Authentication findings

Private user data and write actions should authenticate users. The expected MCP authorization posture is OAuth 2.1 compatible and includes:

- protected-resource metadata on the MCP resource server;
- OAuth or OpenID discovery metadata on the authorization server;
- propagation and validation of the `resource` parameter;
- authorization code flow with PKCE `S256`;
- client identification through CIMD, dynamic client registration, or a predefined client;
- bearer access tokens on subsequent MCP requests;
- resource, issuer, audience, expiry, scope, subject, and revocation validation.

A typical protected-resource metadata endpoint is `/.well-known/oauth-protected-resource`. An unauthenticated protected request can return a `WWW-Authenticate` challenge pointing to that metadata.

OpenAI recommends using an established identity provider rather than implementing authentication from scratch. The existing platform identity service is therefore the first reuse candidate, but it must be assessed against every required discovery and token contract.

## Plugin packaging findings

Every packaged plugin has `.codex-plugin/plugin.json`. Depending on its architecture, the plugin root may also contain:

- `skills/`;
- `.app.json` for a registered MCP connection mapping;
- `.mcp.json` for bundled MCP server configuration;
- `hooks/`;
- `assets/`.

Only `plugin.json` belongs inside `.codex-plugin/`. Package paths are relative to the plugin root and normally start with `./`.

When a developer-mode MCP connection is created, ChatGPT exposes a technical ID beginning with `plugin_asdk_app`. That ID is environment/account specific. It must not be hard-coded into a reusable public source template. The implementation should provide an example or generator that binds the correct ID after connection creation.

A richer published manifest commonly includes display name, descriptions, developer identity, category, capabilities, website, privacy policy, terms, starter prompts, brand color, icons, logo, and screenshots where UI exists.

## Review and publication findings

Public submission requires more than a working endpoint. Relevant requirements include:

- organization or individual verification for the intended publisher name;
- appropriate Apps Management / app submission write permission;
- a public production MCP endpoint, not a local or testing URL;
- accurate scanned tool metadata and annotations;
- company and privacy policy URLs;
- test prompts, expected responses, and test access where needed;
- optional screenshots only when the plugin has UI;
- policy attestations and release notes;
- review approval before the developer publishes the approved version.

Reviewed MCP metadata is versioned. Changing tool metadata or linked UI metadata after publication requires a new scan, submission, approval, and publication cycle.

## Security and privacy findings

Required design posture:

- least privilege for scopes, storage, and network access;
- explicit consent for account linking and write access;
- defense in depth against prompt injection and malicious input;
- server-side authorization on every call;
- minimal task-specific inputs;
- no request for full conversation history or broad context without a necessary declared purpose;
- clear privacy policy covering data categories, purposes, recipients, retention, and user controls;
- exact CSP domains for any optional UI.

## Repository baseline findings

### Existing route shape

`http-generic-api/routes/mcpRoutes.js` currently mounts:

- `POST /mcp/initialize`;
- `GET /mcp/tools/list`;
- `POST /mcp/tools/call`.

This is a custom split route contract, not the desired single Streamable HTTP endpoint.

### Existing authentication shape

`http-generic-api/mcpRuntime.js` currently:

- rejects `Authorization` headers;
- optionally validates `BACKEND_API_KEY` from the `token` query parameter;
- returns custom JSON errors for invalid auth.

This must not be reused as the public ChatGPT authentication contract because resource-bound bearer tokens and OAuth discovery are required for private user data and writes.

### Existing tool shape

The runtime includes tools for developer-agent proposals, session summaries, app connections, a generic registry action, and generic connected-app calls. Several tools accept `tenant_id` directly. The new public adapter must resolve tenant authority from the authenticated principal, then treat any identifier only as a bounded selector.

### Reuse opportunities

- Existing MCP handler concepts can inform the adapter but should not define the external transport contract.
- Context Kernel and tenant-safe projections can resolve principal and resource context.
- Capability and policy registries can decide tool eligibility and authorization.
- Operation and evidence surfaces can provide idempotency, durable status, unknown-outcome handling, and readback.
- Connector/provider authorities can perform external actions without exposing credentials to MCP.
- Existing registry-driven architecture can generate a reviewed tool catalog rather than maintain an unrelated static list.

## Decision summary

| Decision | Result | Reason |
|---|---|---|
| Plugin shape | MCP first, skills optional, UI deferred | Smallest useful and reviewable integration |
| Transport | New Streamable HTTP `/mcp` adapter | Align with current ChatGPT connection contract |
| Authentication | OAuth 2.1 resource server | Required for private data and writes |
| Existing query token | Legacy compatibility only | Secret-in-URL and no user/resource authorization |
| Initial tool catalog | Read-only, focused tools | Lower review and operational risk |
| Generic internal dispatch | Reuse behind focused tools | Preserve platform authority without exposing a super-tool |
| Tenant selection | Resolve from token and Context Kernel | Prevent model-controlled authority |
| UI | No phase-1 UI | Tool workflows must work without UI first |
| Packaging | Source template plus environment binding | Avoid committing account-specific connection IDs |
| Delivery | Multi-PR | Transport, auth, tools, packaging, rollout, and review need separate evidence |
