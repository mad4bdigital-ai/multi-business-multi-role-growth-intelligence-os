# Spec 016 — ChatGPT Plugin and MCP Integration

This Spec Kit defines how the Multi-Business Multi-Role Growth Intelligence OS becomes an installable ChatGPT and Codex plugin backed by a standards-compliant MCP server.

## Target outcome

A user can add the platform from ChatGPT developer mode, authenticate through the platform, discover only authorized tools, and safely read or mutate tenant, workspace, Brand, and operational resources through existing governed execution authorities.

## Delivery posture

- Specification only.
- Multi-PR delivery.
- No runtime code, database migration, provider request, OAuth client registration, external publication, or Production activation is authorized by this branch.
- The first implementation phase is read-only and developer-mode focused.
- Write tools remain blocked until OAuth 2.1, user confirmation, semantic capability authorization, idempotency, and readback are proven end to end.

## Core design choices

1. Add one stable Streamable HTTP MCP endpoint, normally `/mcp`.
2. Preserve existing split MCP routes only behind a temporary compatibility boundary; do not expose them as the public ChatGPT contract.
3. Replace query-string secret authentication for the ChatGPT surface with OAuth 2.1 resource-server behavior and bearer access tokens.
4. Resolve tenant, workspace, Brand, subject, resource, and connection authority from the authenticated principal and platform registries. Model-provided identifiers are selectors, never authority.
5. Expose focused user-goal tools with explicit schemas, structured results, accurate MCP annotations, bounded output, and no secrets.
6. Package the integration with `.codex-plugin/plugin.json`; bind a developer-mode MCP connection through `.app.json` only after ChatGPT creates the connection-specific technical ID.
7. Keep custom UI optional. Phase 1 must work without UI.

## Planned plugin modes

| Mode | Purpose | Authentication | Mutation |
|---|---|---|---|
| Personal developer connection | Validate transport, metadata, tool selection, and read-only tenant-safe queries | OAuth 2.1 | No |
| Private/workspace rollout | Controlled internal use with reviewed scopes and admin policy | OAuth 2.1 | Selected governed writes |
| Public directory submission | Published plugin after organization verification and review readiness | OAuth 2.1 | Only reviewed, confirmed, auditable writes |

## Spec artifacts

- `spec.md` — user and platform requirements.
- `research.md` — verified OpenAI and repository baseline.
- `operation-paths.md` — end-to-end flows, denial, retry, readback, and recovery.
- `concerns.md` — security, privacy, isolation, availability, compatibility, and review risks.
- `plan.md` — staged delivery design.
- `data-model.md` — logical state and reuse decisions.
- `contracts/` — draft MCP, OAuth metadata, package, and HTTP contracts.
- `tasks.md` — dependency-ordered implementation work.
- `testing-strategy.md` and `e2e-phases.json` — verification contract.
- `work-map-integration.json` — current Work Map decisions.
- `completion.json` — truthful incomplete delivery state.

## Canonical authorities retained

- Context Kernel remains principal, tenant, workspace, Brand, resource, and connection context authority.
- Capability and policy registries remain authorization authority.
- Existing execution, operation, evidence, and readback surfaces remain mutation authority.
- MCP tool metadata is a discovery and invocation contract; it does not grant permission.
- ChatGPT confirmation behavior complements but never replaces server-side authorization and typed confirmation.
