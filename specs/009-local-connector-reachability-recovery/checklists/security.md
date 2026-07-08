# Security Checklist

## Identity and authorization

- [x] Tenant/user/device object-level authorization is required for every tenant read/action.
- [x] Break-glass channel is admin-only.
- [x] Route channel participates in authorization.
- [x] Canonical device ID is authority; aliases are not authority.
- [x] Ambiguous target blocks state-changing actions.
- [ ] Implementation must verify cross-tenant denial tests.

## Fresh authorization and tokens

- [x] Privileged installer generation requires fresh authorization.
- [x] Saved device token alone is insufficient when stale.
- [x] Installer tokens are scoped to tenant/user/device/generation/channel/reason/TTL.
- [x] Replay after generation mismatch is blocked by design.
- [ ] Implementation must add replay and TTL tests.

## Secret and privacy controls

- [x] Diagnostics must not expose plaintext secrets.
- [x] Signed URLs are not returned unless short-lived and explicitly needed.
- [x] Machine identifiers are hashed or redacted.
- [x] Error envelopes do not include stack traces.
- [x] `secrets_included: false` is required in readback contracts.
- [ ] Implementation must add redaction regression tests.

## Route and heartbeat integrity

- [x] Heartbeat must be signed by scoped device credential.
- [x] Heartbeat cannot change canonical ownership.
- [x] Route registration validates generation.
- [x] Route conflicts block state-changing actions.
- [ ] Implementation must add route split-brain tests.

## Break-glass controls

- [x] Break-glass diagnostics are separated from tenant action routes.
- [x] Mutations require typed approval and expected IDs.
- [x] Dry-run and readback are mandatory for repair mutations.
- [x] Tenant route cannot fall back to break-glass.
- [ ] Implementation must add admin-only and tenant-denial tests.

## Profile security

- [x] DB profile overlays cannot weaken global security floors.
- [x] Applied profile provenance is exposed without secrets.
- [ ] Implementation must add strict profile-precedence tests.

## Fail-closed rules

- [x] Unknown route channel blocks execution.
- [x] Missing freshness evidence blocks privileged installer generation.
- [x] Ambiguous target blocks unsafe actions.
- [x] Recovered status cannot be inferred from acknowledgement alone.
- [ ] Implementation must prove all blocker risks in `risk-register.md` are covered before auto-install canary.
