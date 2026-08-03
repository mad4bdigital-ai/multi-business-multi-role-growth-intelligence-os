# Security and Privacy Checklist

## Identity and OAuth

- [x] Private data and write actions require authenticated users.
- [x] Protected-resource metadata and standards-compatible bearer challenges are required.
- [x] Authorization-server discovery is required.
- [x] Authorization code plus PKCE `S256` is required.
- [x] Resource propagation and validation are required.
- [x] Token signature, issuer, audience/resource, subject, expiry, scope, and revocation checks are required per request.
- [x] Query-string secrets are excluded from the new endpoint.
- [ ] Authorization server conformance evidence is complete.
- [ ] Development, review, and production client registration modes are approved.
- [ ] Key rotation, JWKS outage, clock skew, and revocation-cache behavior are tested.

## Tenant and object authority

- [x] Context Kernel resolves principal, tenant, workspace, Brand, resource, and connection context.
- [x] Tool inputs cannot create authority.
- [x] Tool discovery is filtered by principal, client, scope, policy, rollout, and capability readiness.
- [x] Object-level authorization is required immediately before data access or mutation.
- [x] Cross-tenant and cross-Brand denial must not leak existence details.
- [ ] Isolation matrix passes for all phase-1 tools.
- [ ] Role removal and grant revocation during active sessions are tested.

## Tool safety

- [x] Public tools are focused and bound to canonical operation families.
- [x] Broad generic dispatch remains internal-only.
- [x] Accurate `readOnlyHint`, `destructiveHint`, and `openWorldHint` values are required.
- [x] Annotations do not replace authorization, validation, or confirmation.
- [x] Phase-1 exposed tools are read-only.
- [ ] Handler behavior and annotations are validated automatically.
- [ ] Future write tools have independent enable/disable controls.

## Mutation controls

- [x] Capability and policy authority are required.
- [x] Confirmation is bound to principal, tool, target, intent hash, and expiry.
- [x] Authorization is rechecked immediately before dispatch.
- [x] Durable idempotency and operation status are required.
- [x] Unknown outcomes are reconciled before retry.
- [x] Compensation and support handoff are operation-specific.
- [ ] Duplicate, concurrent, timeout, replay, and compensation tests pass before write activation.

## Prompt injection and input safety

- [x] User, document, provider, and tool-returned content is treated as untrusted data.
- [x] Input schemas are explicit and task-specific.
- [x] Full conversation history is not requested by default.
- [x] Request size, nesting, list length, and execution deadlines are bounded.
- [x] Unsupported arbitrary SQL, HTTP, provider, repository, and secret requests are out of scope.
- [ ] Prompt-injection evaluation passes without authorization changes or secret disclosure.

## Secrets and data minimization

- [x] Access tokens, refresh tokens, OAuth secrets, backend keys, provider credentials, raw grants, database URLs, and private keys are forbidden in source and results.
- [x] Live account-specific plugin connection IDs are forbidden in reusable source templates.
- [x] Logs use allowlisted structured fields and bounded fingerprints.
- [x] No protected request body is logged by default.
- [x] `content`, `structuredContent`, `_meta`, errors, logs, traces, and CI artifacts are all included in secret scanning.
- [ ] Secret scan and representative log review pass.

## Privacy

- [x] Tool inputs and outputs are limited to the user’s current task.
- [x] Logical retention and unlink/revocation boundaries are documented.
- [x] Audit evidence is separated from token and raw prompt storage.
- [x] Public submission requires a privacy policy covering collected data, purpose, recipients, retention, and controls.
- [ ] Privacy data-flow inventory is approved.
- [ ] Privacy policy and terms match actual runtime behavior.
- [ ] Test data and reviewer accounts contain no unrelated customer data.

## Network and client security

- [x] HTTPS is required.
- [x] Public submission requires a stable public production domain.
- [x] Client/resource binding is required.
- [x] Rate limits apply by client, principal, tenant, and tool as appropriate.
- [x] Optional UI is blocked until exact CSP and text fallback exist.
- [ ] DNS, TLS, certificate renewal, routing, and edge protections are verified.
- [ ] Development tunnels are excluded from public submission.

## Incident response and revocation

- [x] User grant revocation is required.
- [x] Client, tool, write mode, and whole-integration disable controls are required.
- [x] Revocation preserves required audit and operation evidence.
- [x] Dependency failures fail closed when authority cannot be resolved.
- [ ] Revocation and emergency-disable drills meet the operational SLA.
- [ ] Alerts and support runbooks are active.

## Approval gate

Security approval remains blocked until OAuth conformance, isolation, annotation parity, no-secret evidence, prompt-injection tests, revocation drills, and architecture-boundary tests are complete.
