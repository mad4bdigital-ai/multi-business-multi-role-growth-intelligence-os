# Implementation Plan

## Delivery strategy

The integration is delivered as a sequence of small governed PRs. The specification PR creates no runtime authority. Each implementation PR must be fresh with `main`, pass required checks, and preserve an independent rollback boundary.

## Architecture summary

```text
ChatGPT / Codex
  │
  │ MCP Streamable HTTP + OAuth bearer token
  ▼
Public MCP Edge `/mcp`
  │
  ├─ protocol validation and bounded transport
  ├─ token verification and protected-resource challenge
  ├─ client and tool-catalog eligibility
  ▼
ChatGPT MCP Adapter
  │
  ├─ Context Kernel resolution
  ├─ semantic capability and policy authorization
  ├─ focused tool handler registry
  ├─ idempotency and operation ownership
  ▼
Existing platform authorities
  ├─ tenant-safe projections
  ├─ workflow and execution engine
  ├─ connector/provider dispatch
  ├─ operation/readback/reconciliation
  └─ evidence and observability
```

The adapter translates MCP protocol requests into canonical platform requests. It does not own business rules, credentials, tenant selection, or provider execution.

## Phase A — Baseline and compatibility inventory

### Deliverables

- Inventory every consumer of `/mcp/initialize`, `/mcp/tools/list`, `/mcp/tools/call`, and the query-token contract.
- Map current `mcpRuntime.js` tools to canonical capabilities, resources, authorities, and data sensitivity.
- Confirm whether `mcp.mad4b.com` DNS, TLS, routing, and deployment ownership are available.
- Assess `auth.mad4b.com` against protected-resource metadata, OAuth discovery, PKCE, client registration, resource propagation, token validation, and revocation requirements.
- Produce a field-level reuse matrix for Context Kernel, capability, operation, evidence, connector, and rollout registries.

### Exit gate

No implementation starts until current consumers, auth gaps, endpoint ownership, and the minimum read-only tool catalog are approved.

## Phase B — Protocol adapter and read-only endpoint

### Deliverables

- Add the official MCP SDK compatible with the Node runtime.
- Add a dedicated MCP adapter module and Streamable HTTP route at `/mcp`.
- Keep legacy split routes separate and feature flagged.
- Add initialization instructions, protocol-version handling, request-size limits, timeout limits, and structured errors.
- Implement deterministic anonymous/read-only tool catalog generation.
- Add health and metadata fingerprint readback.

### Initial candidate tools

Final names require product review, but each tool remains focused:

1. `list_accessible_workspaces`
2. `list_accessible_brands`
3. `get_brand_operating_context`
4. `search_platform_capabilities`
5. `get_capability_status`
6. `list_user_operations`
7. `get_operation_status`

No tool accepts tenant authority directly. Optional tenant/workspace/Brand IDs are matched against the authorized context set.

### Exit gate

MCP Inspector initializes the endpoint and validates schemas and annotations. No tool changes state.

## Phase C — OAuth 2.1 integration

### Deliverables

- Publish protected-resource metadata at the correct well-known path.
- Publish or integrate authorization-server discovery metadata.
- Support the approved client identification/registration method.
- Support authorization code plus PKCE `S256`.
- Issue and validate resource-bound access tokens.
- Enforce issuer, signature, resource/audience, subject, expiry, scope, and revocation.
- Return standards-compatible bearer challenges.
- Add grant revocation and client disable controls.

### Exit gate

Positive and negative OAuth conformance tests pass. No protected tool can execute anonymously or with a token for another resource.

## Phase D — Context and tool eligibility

### Deliverables

- Resolve principal, subject, tenant, workspace, Brand, resource, and connection context through Context Kernel.
- Filter tools by client, rollout, scope, tenant policy, capability readiness, and user authority.
- Bind every tool to canonical capability and operation metadata.
- Validate metadata annotations against actual handler behavior.
- Add bounded structured results and stable IDs.

### Exit gate

Cross-tenant, cross-Brand, and hidden-tool tests pass with no existence or metadata leakage.

## Phase E — Developer-mode packaging and evaluation

### Deliverables

- Add a plugin source template with `.codex-plugin/plugin.json`.
- Add a safe `.app.example.json` or generator contract; never commit a live connection technical ID.
- Create the MCP connection in ChatGPT developer mode.
- Run direct, indirect, follow-up, invalid, unsupported, and authorization prompt suites.
- Compare source, runtime, MCP Inspector, and ChatGPT metadata fingerprints.
- Tune tool descriptions and schemas without expanding authority.

### Exit gate

Tool-selection and no-call thresholds in `spec.md` pass. The installed plugin completes supported read journeys without custom UI.

## Phase F — Governed write tools

### Deliverables

- Select a small set of reversible or bounded write journeys.
- Define tool-specific capability, policy, confirmation, idempotency, operation, readback, compensation, and support contracts.
- Advertise accurate `openWorldHint` and `destructiveHint` values.
- Reauthorize immediately before dispatch.
- Return durable operation IDs and avoid transport-level success claims.
- Add unknown-outcome reconciliation.

### Exit gate

At-most-once side-effect tests, confirmation binding, concurrent update, revocation, and compensation tests pass. Each tool has independent enable/disable control.

## Phase G — Optional UI

This phase is deferred unless a tested user journey clearly benefits from visual interaction.

### Required deliverables when activated

- MCP UI resource contract.
- Exact CSP domain allowlist.
- Accessible keyboard and responsive behavior.
- No secrets or broad customer payloads in component initialization.
- Text-only result fallback.
- UI-specific review screenshots and evidence.

## Phase H — Public review candidate

### Deliverables

- Verified publisher identity and required submission role.
- Production endpoint and availability evidence.
- Privacy policy, terms, company URL, support route, retention description, and user controls.
- Final package metadata, assets, localization, starter prompts, and category.
- Reviewer test account or controlled test data.
- Submission test prompts with expected tool calls and responses.
- Release notes and policy attestations.
- Exact runtime/source/review fingerprint comparison.

### Exit gate

An authorized publisher may submit for review. Submission does not authorize publication.

## Phase I — Publish, monitor, and close out

### Deliverables

- Publish only an approved version after explicit release authorization.
- Monitor initialization, auth, tool selection, denial, latency, errors, and operations.
- Run revocation and disable drills.
- Verify production/main/package/review parity.
- Maintain metadata through new scans and reviewed versions.
- Close legacy routes only after approved deprecation evidence.

## Migration posture

No database migration is assumed by the specification. The reuse matrix determines whether existing registries can represent:

- MCP client identity and rollout;
- OAuth grants or external identity links;
- tool catalog versions;
- consent and confirmation receipts;
- invocation evidence;
- review and package versions.

Any new persistence requires an additive migration, lifecycle registry entry, backup/restore plan, rollback, production apply evidence, and post-apply readback.

## Deployment posture

- Development and staging endpoints precede production.
- Production deploys only from the repository’s governed release path.
- Secrets are configured through the existing secret authority, not source or plugin package files.
- Endpoint routing, TLS, OAuth redirect behavior, and public reachability are verified independently.
- Public submission uses the production endpoint and reviewed metadata fingerprint.

## Rollback strategy

Rollback units, from narrowest to broadest:

1. disable one public tool;
2. revert to the prior tool-catalog version;
3. revoke one user grant;
4. disable one ChatGPT client registration;
5. disable write mode while retaining read-only mode;
6. disable the `/mcp` route;
7. revert the deployment;
8. preserve legacy routes if still required by verified consumers.

Rollback never deletes operation evidence or customer-owned records.

## Constitution check

- Canonical registries remain runtime authority.
- Specifications and MCP metadata do not authorize mutations.
- Principal and context are resolved, not trusted from model input.
- Secrets remain outside source and evidence.
- Every write has capability, policy, confirmation, idempotency, readback, and rollback.
- Production, publication, and migration remain separate governed stages.
