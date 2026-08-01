# Implementation Handoff

Implementation started in a separate branch as required by the Spec Kit delivery boundary.

- Specification PR: #4460
- Implementation wave: read-only Streamable HTTP MCP adapter
- Runtime branch: `gpt/016-chatgpt-mcp-readonly-adapter-20260801`
- Base: `main` at `464c11803d8cb84ba39863c5e55e05f30dbca8da`

The implementation wave is limited to a feature-flagged, read-only protocol adapter, protected-resource metadata, focused workspace and Brand tools, and regression tests. OAuth 2.1 authorization-server implementation, database migrations, write tools, deployment, and plugin publication remain out of scope.
