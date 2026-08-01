# Implementation Handoff

Implementation started in a separate branch as required by the Spec Kit delivery boundary.

- Specification PR: #4460
- Implementation PR: #4462
- Implementation wave: read-only Streamable HTTP MCP adapter
- Runtime branch: `gpt/016-chatgpt-mcp-readonly-adapter-20260801`
- Base: `main` at `464c11803d8cb84ba39863c5e55e05f30dbca8da`

## Implemented in the draft wave

- Feature-flagged `POST /mcp` JSON-RPC transport.
- OAuth protected-resource metadata route.
- Protocol, Origin, media-type, and version checks.
- Focused read-only workspace and Brand tools.
- Active-membership and effective Brand-grant enforcement.
- OAuth tool metadata and MCP authentication challenge metadata.
- Targeted tests registered in the canonical test manifest.

## Still blocked

- Full OAuth 2.1 authorization-server conformance and PKCE.
- Resource-bound access-token audience, scope, and revocation validation.
- Public MCP endpoint, DNS, TLS, and deployment verification.
- ChatGPT Developer mode connection and MCP Inspector acceptance.
- Tool-catalog product approval and complete Context Kernel binding.
- Database migrations, write tools, plugin packaging, submission, and publication.

All new runtime feature flags remain disabled by default. No deployment or external activation has occurred.
