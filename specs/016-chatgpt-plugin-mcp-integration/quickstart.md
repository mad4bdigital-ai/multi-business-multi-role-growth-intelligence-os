# Multi-Client Quickstart Contract

This is the target validation sequence after implementation exists. It is not executable from the specification branch.

## 1. Prepare one development endpoint

The candidate endpoint must:

- use HTTPS or an approved development tunnel;
- expose MCP Streamable HTTP on `/mcp`;
- support initialization, `tools/list`, and `tools/call` through the MCP transport;
- expose no production credentials in the URL;
- publish protected-resource metadata when protected tools are enabled;
- return only the phase-1 read-only catalog;
- use the same tool and authority contract for every client.

Proposed development URL shape:

```text
https://<development-host>/mcp
```

Proposed production URL, pending routing verification:

```text
https://mcp.mad4b.com/mcp
```

## 2. Inspect with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest
```

In the Inspector:

1. select Streamable HTTP;
2. enter the development `/mcp` URL;
3. initialize the server;
4. inspect server instructions;
5. list tools;
6. call every tool with representative, empty, invalid, inaccessible, and oversized inputs;
7. verify schemas, output shapes, annotations, and authentication challenges;
8. record the server and catalog fingerprints.

Expected phase-1 properties:

- all tools are read-only;
- no tool accepts a free authority override;
- client identity does not grant platform authority;
- no secret appears in results;
- inaccessible resources return neutral structured denial;
- the tool list is bounded and filtered.

## 3. Connect ChatGPT or Codex

In ChatGPT:

1. open Settings;
2. open Security and login;
3. enable Developer mode;
4. open the Plugins page;
5. select the plus button;
6. enter a user-facing name and description;
7. enter the development `/mcp` URL under Connection;
8. complete authentication when prompted;
9. review discovered tools before creating the connection.

Developer mode availability can depend on account and workspace policy.

After ChatGPT creates the connection, capture the technical ID from the connection page. It begins with:

```text
plugin_asdk_app...
```

Rules:

- do not commit the live ID to a reusable source template;
- do not place credentials in `.app.json`;
- use a local generator, ignored environment file, or deployment configuration to bind the ID;
- record only a non-secret fingerprint in release evidence when needed.

## 4. Connect Claude or Claude Desktop

In Claude:

1. open Settings;
2. open Connectors;
3. choose Add custom connector;
4. enter a connector name;
5. enter the same development `/mcp` URL;
6. start the OAuth flow when prompted;
7. verify the consented scopes and resource;
8. confirm the same read-only tools are discovered.

Identity configuration must register the exact approved Anthropic callback and client-registration mode. The current documented callback contract is:

```text
https://claude.ai/api/mcp/auth_callback
```

The repository must not contain the live Claude client secret. Dynamic Client Registration, a predefined client, or another approved registration method must be selected and tested before Production.

## 5. Connect a neutral programmatic client

Use one non-OpenAI, non-Anthropic MCP client to prove that the endpoint is standards-based rather than product-specific.

The client must:

1. initialize through Streamable HTTP;
2. negotiate a supported MCP protocol version;
3. follow OAuth protected-resource and authorization-server discovery;
4. request a token for the exact MCP resource;
5. list the same tool catalog;
6. invoke the same read-only tools;
7. preserve structured results and error semantics.

A browser-based client must use an explicitly approved Origin. A non-browser client may omit Origin, but it still requires client eligibility, OAuth, scopes, Context Kernel resolution, and object-level authorization for protected tools.

## 6. Validate an optional OpenAI package

Target package layout:

```text
plugins/mad4b-growth-os/
  .codex-plugin/
    plugin.json
  .app.json
  skills/                 # optional, later phase
  assets/                 # published package only
```

The manifest should point `apps` to `./.app.json`. The app mapping should reference the environment-specific connection technical ID generated after the ChatGPT connection exists.

Claude and generic clients do not use this OpenAI package as runtime authority. Their registration and distribution metadata remain separate from the shared MCP server.

## 7. Run the shared phase-1 prompt suite

Run the same suite in MCP Inspector, ChatGPT, Claude, and the neutral client where natural-language selection is available.

### Direct requests

- List the workspaces I can access.
- Show the Brands available in my current workspace.
- Give me the operating status of Brand `<authorized-brand>`.
- Find platform capabilities related to activation.
- Show the status of operation `<authorized-operation-id>`.

### Indirect requests

- Which business environments can I manage here?
- Is anything blocking this Brand from operating?
- What platform functions are available for this task?

### Follow-up requests

- Open the second Brand from the previous result.
- Show more detail for that capability.
- Check the latest status of the operation you just listed.

### Negative requests

- Access a known Brand from another tenant.
- Supply a fabricated tenant ID.
- Claim to be ChatGPT, Claude, or an admin to gain extra authority.
- Ask the read-only connector to change state.
- Ask for credentials, backend keys, raw grants, client secrets, or provider payloads.
- Ask for an unsupported arbitrary database or HTTP action.

Expected negative behavior:

- no unauthorized tool or data is returned;
- no generic mutation tool is selected;
- changing client identity does not change tenant authority;
- structured errors describe the safe next action;
- no existence detail leaks across authority boundaries.

## 8. Validate OAuth and client registration

Run positive and negative tests for each advertised client profile:

- protected-resource discovery;
- authorization-server discovery;
- approved client identification or registration;
- PKCE `S256`;
- exact redirect URI;
- correct resource propagation;
- correct and insufficient scopes;
- expired token;
- refresh flow;
- revoked token;
- disabled client profile;
- wrong issuer;
- wrong audience/resource;
- altered signature;
- relink after revocation.

Do not continue to write-tool implementation until every negative test fails closed.

## 9. Compare metadata fingerprints and revoke

The following must match:

- source tool registry;
- deployed endpoint;
- MCP Inspector;
- ChatGPT connection;
- Claude connector;
- neutral programmatic client;
- packaged or submitted distribution version where applicable.

Verify independently:

- unlinking one user;
- revoking one grant;
- disabling one client profile;
- disabling one tool;
- disabling write mode;
- disabling the entire MCP endpoint.

After each action, attempt a protected tool from every affected client and confirm denial within the operational SLA.

## 10. Public distribution preparation

Public submission or directory listing is a later stage and remains target-specific. Before any target begins, confirm:

- verified publisher identity where required;
- required submission permissions;
- public production endpoint;
- final privacy policy and terms;
- test account or controlled test data;
- support contact;
- accurate listing metadata and assets;
- reviewed test prompts and expected responses;
- production/source/package or connector fingerprint parity;
- no custom UI screenshots unless custom UI exists;
- approval for that specific distribution target.

Approval in one ecosystem does not authorize publication in another.
