# Security Checklist

- [x] Authenticated principal is the only Tenant/user identity authority.
- [x] Cross-Tenant/Workspace/Brand/Site/account/Connection/device isolation is explicit.
- [x] Questionnaire options cannot grant authority.
- [x] Exact resource/Connection matching precedes provider access.
- [x] Stale, invalid, metadata-only, revoked, or inaccessible Connections cannot execute.
- [x] Customer-safe projection excludes secrets and internal graph/registry detail.
- [x] Mutations require scoped approval, request binding, idempotency, and readback.
- [x] Ambiguous provider outcome forbids blind retry.
- [x] Brand access cannot silently widen to Workspace access.
- [x] Device actions require ownership, health, capability support, consent, and readback.
- [x] Support records use bounded references rather than raw secrets.
- [x] Threat model and incident rollback are included.
- [ ] Security review validates schema rendering/prompt-injection controls.
- [ ] Isolation contract tests pass in staging.
- [ ] No-secret scans pass on responses, logs, evidence, and fixtures.
