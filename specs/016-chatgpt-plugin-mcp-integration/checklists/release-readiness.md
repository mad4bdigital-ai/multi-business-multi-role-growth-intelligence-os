# Release Readiness Checklist

## Specification and implementation authority

- [x] Specification is marked `in_progress` and does not claim runtime delivery.
- [x] Runtime, migration, OAuth registration, submission, publication, and Production activation remain separate governed stages.
- [ ] Specification PR is reviewed and merged.
- [ ] Work Map integration is regenerated from the implementation candidate and marked `ready_for_implementation`.
- [ ] Every implementation PR is fresh with `main` and passes required exact-head checks.

## Endpoint and transport

- [ ] Stable development, staging, and production MCP endpoints are assigned.
- [ ] Production endpoint uses HTTPS with valid DNS, TLS, routing, health, and certificate-renewal evidence.
- [ ] `/mcp` passes Streamable HTTP initialization, tool-list, and tool-call acceptance.
- [ ] Request limits, deadlines, rate limits, and structured protocol errors are active.
- [ ] Existing split-route consumers are inventoried and protected by an approved compatibility plan.
- [ ] No query-string credential is accepted by the new endpoint.

## OAuth and identity

- [ ] Protected-resource metadata is public and valid.
- [ ] Authorization-server discovery is valid and points to the approved identity authority.
- [ ] Authorization code plus PKCE `S256` passes positive and negative tests.
- [ ] Resource/audience, issuer, subject, expiry, scope, signature, and revocation validation pass.
- [ ] Client registration mode is approved for development, review, and production.
- [ ] Consent copy, scope taxonomy, redirect behavior, unlink, revoke, and emergency-disable controls are approved.
- [ ] No OAuth secret, access token, refresh token, backend key, or private key is committed or emitted.

## Tool catalog

- [ ] Phase-1 tool names, titles, descriptions, schemas, and result contracts are approved.
- [ ] Every phase-1 tool is proven read-only.
- [ ] Annotation parity is verified against handler and downstream behavior.
- [ ] Generic internal dispatch tools are not exposed as public user tools.
- [ ] Tool discovery is filtered by client, user, scope, tenant policy, rollout, and capability readiness.
- [ ] Stable identifiers, pagination, field allowlists, maximum rows, maximum bytes, and maximum depth are enforced.
- [ ] Source and runtime catalog fingerprints match.

## Context, authorization, and isolation

- [ ] Context Kernel resolves principal, subject, tenant, workspace, Brand, resource, and connection context.
- [ ] Model-provided IDs are checked only as selectors within the resolved authorized set.
- [ ] Capability and policy decisions are enforced on every tool call.
- [ ] Multi-tenant, workspace, Brand, role, connection, and operation isolation matrix passes.
- [ ] Revoked memberships and grants stop new access within the operational SLA.
- [ ] Denials reveal no unauthorized rows, provider identities, hidden tools, or cross-tenant existence details.

## Results, privacy, and observability

- [ ] `content`, `structuredContent`, `_meta`, errors, logs, traces, metrics, and CI artifacts pass no-secret scanning.
- [ ] Tool schemas collect only task-specific data and do not require full conversation history.
- [ ] Every invocation has request, invocation, catalog, authorization, context, result, and evidence identifiers.
- [ ] Logs use allowlisted fields and redact protected request bodies and headers.
- [ ] Privacy data flow, retention, deletion, unlink, evidence retention, and user controls are approved.
- [ ] Privacy policy and terms match deployed behavior.

## Developer-mode acceptance

- [ ] MCP Inspector passes all phase-1 tools and negative cases.
- [ ] ChatGPT Developer mode connection is created against the candidate endpoint.
- [ ] ChatGPT and Inspector discover the same metadata fingerprint.
- [ ] Supported prompt tool-selection accuracy meets the target.
- [ ] Unsupported prompt no-call or safe-refusal accuracy meets the target.
- [ ] Write attempts during read-only phase cause no mutation.
- [ ] The plugin works without custom UI.

## Package readiness

- [ ] `.codex-plugin/plugin.json` validates against the package contract.
- [ ] `.app.json` is generated or bound outside reusable source using the environment-specific connection technical ID.
- [ ] No live `plugin_asdk_app...` ID is committed in a reusable template.
- [ ] Display name, descriptions, website, privacy policy, terms, developer identity, categories, prompts, icons, and assets are final.
- [ ] Any optional UI has exact CSP, accessibility evidence, and text fallback.
- [ ] Package, source, and deployed endpoint fingerprints match.

## Governed writes — required only before write activation

- [ ] Each write tool has a bounded operation family, capability, policy, scope, and confirmation contract.
- [ ] Confirmation is bound to principal, tool, target, intent hash, policy version, and expiry.
- [ ] Durable idempotency and operation ownership are implemented.
- [ ] Unknown outcomes trigger readback and reconciliation before retry.
- [ ] Successful, failed, cancelled, compensated, and unknown statuses are testable.
- [ ] Duplicate, concurrent, timeout, replay, revocation, compensation, and rollback tests pass.
- [ ] Each write tool and write mode can be disabled independently.

## Public review readiness

- [ ] Publisher organization or individual verification is complete.
- [ ] The submitter has the required app-management submission permission.
- [ ] The production MCP endpoint is public, stable, and not a development tunnel.
- [ ] Listing metadata, category, localization, legal URLs, support path, release notes, and policy attestations are complete.
- [ ] Controlled reviewer account or test data is available without unrelated customer data.
- [ ] Test prompts, expected tool calls, expected responses, and failure behavior are documented.
- [ ] Imported tool metadata is compared with the release fingerprint before submission.
- [ ] Submission is explicitly authorized.

## Approval, publication, and maintenance

- [ ] Review findings are resolved in a new candidate and rescanned where required.
- [ ] Approved metadata snapshot matches source, runtime, and package.
- [ ] Publication is separately authorized after approval.
- [ ] Production monitoring, alert routing, support runbook, and incident ownership are active.
- [ ] Revoke, client-disable, tool-disable, write-disable, route-disable, and deployment rollback drills pass.
- [ ] Future metadata changes follow a new scan, review, approval, and publication cycle.
- [ ] Production/main/package/review parity and post-merge audit are complete.

## Final release decision

- [ ] **Ready for developer-mode read-only use**
- [ ] **Ready for internal/workspace rollout**
- [ ] **Ready for governed write activation**
- [ ] **Ready for public submission**
- [ ] **Approved and explicitly authorized for publication**
