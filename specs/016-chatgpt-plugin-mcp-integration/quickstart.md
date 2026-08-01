# Quickstart Contract

This is the target validation sequence after implementation exists. It is not executable from the specification branch.

## 1. Prepare a development endpoint

The candidate endpoint must:

- use HTTPS or an approved development tunnel;
- expose MCP Streamable HTTP on `/mcp`;
- support initialization, `tools/list`, and `tools/call` through the MCP transport;
- expose no production credentials in the URL;
- publish protected-resource metadata when protected tools are enabled;
- return only the phase-1 read-only catalog.

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
8. record the catalog fingerprint.

Expected phase-1 properties:

- all tools are read-only;
- no tool accepts a free authority override;
- no secret appears in results;
- inaccessible resources return neutral structured denial;
- list tools is bounded and filtered.

## 3. Enable ChatGPT Developer mode

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

## 4. Capture the connection technical ID

After ChatGPT creates the connection, capture the technical ID from the connection page. It begins with:

```text
plugin_asdk_app...
```

Rules:

- do not commit the live ID to a reusable source template;
- do not place credentials in `.app.json`;
- use a local generator, ignored environment file, or deployment configuration to bind the ID;
- record only a non-secret fingerprint in release evidence when needed.

## 5. Validate a local plugin package

Target package layout:

```text
plugins/mad4b-growth-os/
  .codex-plugin/
    plugin.json
  .app.json
  skills/                 # optional, later phase
  assets/                 # published package only
```

The manifest should point `apps` to `./.app.json`. The app mapping should reference the developer connection technical ID generated in the prior step.

## 6. Run the phase-1 prompt suite

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
- Ask the read-only plugin to change state.
- Ask for credentials, backend keys, raw grants, or provider payloads.
- Ask for an unsupported arbitrary database or HTTP action.

Expected negative behavior:

- no unauthorized tool or data is returned;
- no generic mutation tool is selected;
- structured errors describe the safe next action;
- no existence detail leaks across authority boundaries.

## 7. Validate OAuth

Run positive and negative tests for:

- protected-resource discovery;
- authorization-server discovery;
- PKCE `S256`;
- correct resource propagation;
- correct and insufficient scopes;
- expired token;
- revoked token;
- wrong issuer;
- wrong audience/resource;
- altered signature;
- relink after revocation.

Do not continue to write-tool implementation until every negative test fails closed.

## 8. Compare metadata fingerprints

The following must match:

- source tool registry;
- deployed endpoint;
- MCP Inspector;
- ChatGPT developer connection;
- packaged plugin version.

Any mismatch blocks promotion.

## 9. Disable and revoke

Verify independently:

- unlinking one user;
- revoking one grant;
- disabling one client;
- disabling one tool;
- disabling write mode;
- disabling the entire MCP endpoint.

After each action, attempt a protected tool and confirm denial within the operational SLA.

## 10. Public submission preparation

Public submission is a later stage. Before it begins, confirm:

- verified publisher identity;
- required app submission permissions;
- public production endpoint;
- final privacy policy and terms;
- test account or controlled test data;
- support contact;
- accurate listing metadata and assets;
- reviewed test prompts and expected responses;
- production/source/package fingerprint parity;
- no custom UI screenshots unless custom UI exists.
