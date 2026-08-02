# Spec 016 — Multi-Client AI Connector and MCP Integration

This Spec Kit defines how the Multi-Business Multi-Role Growth Intelligence OS exposes one governed remote MCP server that can be connected from ChatGPT, Codex, Claude, Claude Desktop, and other approved standards-compliant AI clients.

The folder name and branch retain the original ChatGPT wording for continuity. The canonical scope is now multi-client.

## Target outcome

A user can add the platform from a supported AI client, authenticate through the platform, discover only authorized tools, and safely read or mutate tenant, workspace, Brand, and operational resources through existing governed execution authorities.

The AI host is a client and presentation surface. It never becomes tenant, capability, resource, connection, or operation authority.

## Delivery posture

- Specification only.
- Multi-PR delivery.
- No runtime code, database migration, provider request, OAuth client registration, external publication, or Production activation is authorized by this branch.
- The first implementation phase is read-only and client-acceptance focused.
- Write tools remain blocked until OAuth 2.1, user confirmation, semantic capability authorization, idempotency, and readback are proven end to end.

## Core design choices

1. Add one stable Streamable HTTP MCP endpoint, normally `/mcp`.
2. Use one shared tool catalog and platform authority path for all supported clients.
3. Preserve existing split MCP routes only behind a temporary compatibility boundary; do not expose them as the public remote MCP contract.
4. Replace query-string secret authentication for the new surface with OAuth 2.1 resource-server behavior and bearer access tokens.
5. Resolve tenant, workspace, Brand, subject, resource, and connection authority from the authenticated principal and platform registries. Model-provided identifiers and client-profile metadata are selectors or evidence, never authority.
6. Expose focused user-goal tools with explicit schemas, structured results, accurate MCP annotations, bounded output, and no secrets.
7. Treat ChatGPT/Codex packaging, Claude custom connector configuration, MCP registry metadata, and future platform packages as optional distribution layers around the same MCP resource.
8. Keep custom UI optional. Phase 1 must work without UI.

## Planned client profiles

| Client profile | Distribution path | Transport | Authentication | Mutation |
|---|---|---|---|---|
| OpenAI ChatGPT / Codex | Developer connection, optional plugin package, later public review | Streamable HTTP | OAuth 2.1 | Read-only first |
| Anthropic Claude / Claude Desktop | Custom remote connector, later directory consideration | Streamable HTTP | OAuth 2.1 | Read-only first |
| Generic approved MCP client | Direct remote MCP connection after compatibility and policy approval | Streamable HTTP | OAuth 2.1 unless explicitly public | Read-only first |

## Planned rollout modes

| Mode | Purpose | Authentication | Mutation |
|---|---|---|---|
| Personal development connection | Validate transport, metadata, tool selection, and tenant-safe reads from one client | OAuth 2.1 | No |
| Cross-client acceptance | Prove ChatGPT, Claude, and MCP Inspector receive the same catalog and authority behavior | OAuth 2.1 | No |
| Private/workspace rollout | Controlled internal use with reviewed scopes, clients, and admin policy | OAuth 2.1 | Selected governed writes |
| Public directory or marketplace submission | Publish target-specific metadata after production and review readiness | OAuth 2.1 | Only reviewed, confirmed, auditable writes |

## Spec artifacts

- `spec.md` — shared multi-client requirements.
- `multi-client-connector-extension.md` — Claude and generic-client compatibility and distribution contract.
- `research.md` — verified OpenAI, Anthropic, MCP, and repository baseline.
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
- MCP tool metadata and client-profile metadata are discovery and invocation contracts; they do not grant permission.
- Host-side confirmation behavior complements but never replaces server-side authorization and typed confirmation.
