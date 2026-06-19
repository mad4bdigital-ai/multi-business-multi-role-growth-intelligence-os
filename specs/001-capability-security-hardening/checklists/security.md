# Security Review Checklist

## Authorization

- [ ] Principal identity comes only from authenticated context.
- [ ] Tenant membership and role are verified.
- [ ] Surface exposure is checked before credential lookup.
- [ ] Object-level authorization exists for every target resource.
- [ ] Missing policy fails closed.
- [ ] Platform-admin capabilities are denied to tenant principals.

## Selector and policy

- [ ] Exactly one selector is required.
- [ ] Every alias maps to one canonical capability.
- [ ] Surface restrictions cannot weaken canonical policy.
- [ ] Dual-surface parity tests pass.
- [ ] Explicit tool requests cannot become `no_action_requested`.

## Credentials and intake

- [ ] Requirement, resolution, and usability are separate.
- [ ] Pending/revoked/expired/wrong-scope credentials cannot execute.
- [ ] Platform-managed credentials still enforce target authorization.
- [ ] Raw admin intake is not tenant-callable.
- [ ] Tenant intake is subject/tenant/purpose bound.
- [ ] Intake is single-use, expiring, replay-resistant, and audited.
- [ ] No secret appears in logs, traces, errors, or responses.

## Devices and local execution

- [ ] Device ID is required where applicable.
- [ ] Device belongs to tenant and caller is authorized.
- [ ] Connector identity is verified.
- [ ] Heartbeat freshness is enforced.
- [ ] Capability support is verified.
- [ ] Local consent is enforced by risk.
- [ ] Arbitrary shell is unavailable.
- [ ] Command arguments are schema-validated.
- [ ] File paths cannot traverse or escape through symlinks.
- [ ] Write/delete permissions are separate from read.

## Mutations and approvals

- [ ] Every mutation has an explicit policy.
- [ ] Approval binds capability, subject, target, request, and expiry.
- [ ] Replay is prevented.
- [ ] Idempotency is implemented where retryable.
- [ ] High-risk mutations have preview/readback/rollback evidence.

## Audit and privacy

- [ ] Every attempt has a decision trace.
- [ ] Gate states are explicit.
- [ ] Allowed decisions contain no unevaluated required gate.
- [ ] Audit records are immutable or tamper-evident.
- [ ] Tenant responses do not leak internal/admin/cross-tenant detail.
- [ ] Retention and access controls are documented.
