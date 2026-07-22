# Security Checklist: Tenant GPT Activation Lifecycle

**Status**: Clarification required before implementation  
**Scope**: OAuth, JWT, gateway, tenant identity, sessions, tools, evidence, recovery, and deployment diagnostics

## Authentication

- [x] Registered OAuth client is required.
- [x] Canonical callback validation is required.
- [x] Identity proof is separate from platform access token issuance.
- [x] Authorization codes are short-lived, one-time, and hashed at rest.
- [x] Token signature, issuer, expiry, purpose, and JTI expectations are defined.
- [x] Missing/invalid auth returns `401` rather than generic connection failure.

## Protected-resource binding

- [x] Resource derives from trusted host/client profile.
- [x] Optional explicit resource must match the registered profile.
- [x] New access tokens use one Activation audience.
- [x] Multi-audience tokens are rejected.
- [x] Resource claim mismatch is rejected.
- [x] Legacy generic-token cutoff, emergency extension policy, unified OAuth client, and resource-bound external access-token architecture are approved by ADR-002 and ADR-003.

## Authorization and tenant isolation

- [x] Tenant/user identity derives from signed principal and active membership.
- [x] Caller body/path/header overrides are forbidden.
- [x] Membership is refreshed at protected operation entry.
- [x] Tool visibility requires tenant/user/workspace/app/capability/resource scope.
- [x] Provider write and sensitive execution remain independently approval-gated.
- [ ] Full Tenant Resolution route/scope/resource inventory is approved. Blocked by Q-003.

## Replay and idempotency

- [x] Authorization-code replay and concurrent exchange are covered.
- [x] Token expiry/revocation/replay are covered.
- [x] Unsafe retryable mutations require idempotency/operation identity.
- [x] Unknown outcomes reconcile before replay.
- [x] Delivery retry does not replay execution.

## Secrets and privacy

- [x] Raw OAuth codes and access tokens are forbidden in storage evidence/logs.
- [x] Client/provider secrets remain credential references.
- [x] Authorization headers are never logged.
- [x] Diagnostic raw dumps are disabled by default and bounded under elevated authority.
- [x] User/session history is tenant/user scoped and summary-first.
- [x] Contracts and fixtures require `secrets_included: false` where applicable.
- [ ] Retention durations are approved. Blocked by T009.

## Input and protocol security

- [x] Host normalization and exact allowlist are required.
- [x] Resource identifiers reject userinfo, path, query, fragment, and unregistered origins.
- [x] Callback normalization/manipulation is tested.
- [x] Log injection and oversized input are tested.
- [x] Structured errors do not expose stack traces or sensitive details.
- [x] Status polling and operation IDs enforce object-level tenant/user authority.

## Operator and recovery authority

- [x] Admin recovery requires capability, approval, resource authority, readback, and audit.
- [x] Stale/wrong approval is rejected.
- [x] Default access is deny.
- [x] Recovery does not widen tenant scope.
- [x] Same-cycle evidence is required for recovered success.

## Required security tests

- [ ] Invalid client.
- [ ] Callback mismatch variants.
- [ ] Unregistered/spoofed host.
- [ ] Wrong resource and SSRF-like resource strings.
- [ ] Code expiry, replay, and concurrent exchange.
- [ ] Wrong issuer/audience/resource/purpose.
- [ ] Multi-audience token.
- [ ] Legacy token before and after cutoff.
- [ ] Cross-tenant subject/body/path injection.
- [ ] Membership revocation between OAuth and Activate.
- [ ] Unauthorized tool/capability visibility.
- [ ] Secret scanner over logs, fixtures, evidence, and responses.
- [ ] Unknown outcome duplicate prevention.
- [ ] Operator recovery with missing/stale/wrong approval.

## Security approval gate

ADR-001 has finalized durable operation ownership. Implementation cannot begin until the legacy cutoff, Tenant Resolution scope/resource policy, retention, and public deployment-evidence decision are approved or explicitly deferred with compensating controls; physical table mapping must also pass T001-T003/T014 before migration.
