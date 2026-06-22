# Growth Intelligence Platform Security Constitution

## Preamble

This constitution governs capability resolution, authorization, credential handling, device execution, approval, and dispatch across every action, tool, tenant, admin, device, and provider surface.

## I. Canonical Capability Identity

Every executable or previewable operation MUST resolve to exactly one immutable `canonical_capability_id` before any security decision.

- Action, tool, intent, route, and UI keys are aliases, not security identities.
- All aliases of one capability inherit one policy.
- Surface policy may only make the effective policy stricter.
- Missing, conflicting, unknown, or multiple selectors fail closed.

## II. Explicit Subject and Tenant Authority

Authorization MUST derive from authenticated principal context and registry authority. Every decision binds principal, tenant, workspace where applicable, target resource, canonical capability, operation, and policy version. Tenant callers MUST NOT access platform-admin-only surfaces even when they know a valid tool key.

## III. Separation of Security Concerns

The platform independently evaluates principal authorization, tenant membership, surface exposure, resource ownership, skill grant, credential requirement, credential resolution, credential usability, device trust, smoke/preflight, approval, local consent, and dispatch readiness.

`no_credentials_required` MUST NOT imply authorization or execution permission.

## IV. Fail-Closed Execution

Missing policy, ambiguity, unsupported surface binding, incomplete identity, stale device state, invalid credential state, or missing approval MUST deny execution.

- A denied or unevaluated required gate cannot produce `dispatch_ready`.
- State-changing capabilities require an explicit mutation policy.
- Preview and policy-explain modes perform no side effects.
- Direct execution bypasses are forbidden.

## V. Device Trust and Local Consent

Device-scoped capability decisions validate in the same cycle: required device ID, existence, tenant ownership, caller authority, connector identity, lifecycle state, heartbeat freshness, capability support, and local consent or operating-system elevation where required. Registration alone MUST NOT be described as health or readiness.

## VI. Credential Safety and Intake Isolation

Credentials resolve only after authorization and ownership gates pass.

- Secrets never appear in API responses or logs.
- Pending, revoked, expired, or wrong-scope credentials are unusable for execution.
- Tenant intake uses a dedicated tenant-safe capability, not a raw admin tool.
- Intake sessions are subject-bound, tenant-bound, purpose-bound, single-use, short-lived, replay-resistant, audited, and restricted to allowlisted redirects.

## VII. Approval and Mutation Safety

Every state-changing capability declares one mutation mode: denied, preview-only, bounded automatic, explicit user approval, tenant-admin approval, or platform-admin approval. Approval tokens bind capability, subject, target, request, and expiry. High-risk mutation requires preflight, same-cycle readback, and rollback metadata when supported.

## VIII. Observable Decisions

Every preview and execution produces a structured no-secret decision trace identifying request, principal, tenant, canonical capability, selector, surface, policy/registry versions, each gate result, final reason, execution occurrence, and readback status. `pass`, `deny`, `not_applicable`, and `not_evaluated` are distinct states.

## IX. Stable API Contracts

Security APIs use OpenAPI 3.1, strict schemas, stable error envelopes, and backward-compatible evolution by default. Ambiguous or unsupported input is rejected, and public responses do not leak cross-tenant or internal administrative detail.

## X. Layered Architecture

Implementation preserves:

```text
interfaces/api -> application/orchestration -> domain/policy
infrastructure adapters support application/domain through abstractions
```

Controllers do not implement complex authorization policy or call repositories directly. Provider calls remain behind governed adapters.

## XI. Testing and Release Gates

Every behavior change includes deterministic allowed, denied, invalid-input, cross-tenant, selector-parity, replay, stale-state, and regression tests. P0 security changes require staging verification, security and contract review, rollback readiness, and release approval before production promotion.

## XII. Minimal, Reviewable Change

Changes are small, explicit, and reversible where practical. Containment is separate from refactoring. Dependencies require justification. Database, API, security, rollout, generated schemas, and canonicals remain synchronized.

## Governance

Exceptions require written rationale, named owner, bounded duration, compensating controls, explicit security approval, and a tracked removal task.

**Version:** 1.0.0  
**Ratified:** 2026-06-19  
**Last amended:** 2026-06-19
