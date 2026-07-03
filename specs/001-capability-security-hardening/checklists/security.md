# Security Review Checklist

## Status convention

- `[x]` means verified for the Phase 0 containment surfaces in PR #1879.
- `[ ]` means the control remains open for the complete platform or could not be proved from the tenant surface.
- The full tenant evidence and residual-risk decision are in `../tenant-reverification-unified-report-2026-06-23.md`.

## Authorization

- [x] Principal identity comes only from authenticated context on the reviewed tenant routes.
- [x] Tenant membership and role are verified on the reviewed resolver and intake paths.
- [x] Surface exposure is checked before credential lookup.
- [x] Object-level authorization exists for the reviewed target and connection paths.
- [x] Missing mutation policy or mutation classification fails closed, including when broad generic policies already match.
- [x] Platform-admin capabilities are denied to tenant principals.

## Selector and policy

- [x] Exactly one selector is required by the reviewed Platform Plugin resolver path.
- [ ] Every alias maps to one canonical capability across the complete live inventory. T020–T026 remain open.
- [x] Reviewed surface restrictions cannot weaken canonical policy.
- [x] Reviewed dual-surface parity tests pass.
- [x] Explicit reviewed tool requests cannot become `no_action_requested`.
- [ ] Action/tool policy parity is not yet proven for the complete catalog; see report section 5.2 and T011–T014/T043.

## Credentials and intake

- [x] Credential requirement, resolution, and usability are separate.
- [x] Pending, revoked, expired, and wrong-scope credentials cannot execute on reviewed paths.
- [x] Platform-managed credentials still enforce target authorization on reviewed paths.
- [x] Raw admin intake is not tenant-callable.
- [x] Tenant intake is subject/tenant/purpose bound.
- [x] Intake is single-use, expiring, replay-resistant, and audited.
- [x] No secret appears in reviewed responses, traces, or regression fixtures.
- [ ] Complete credential-scope provenance and deterministic connection pinning remain open; see report sections 5.5 and 9.3.

## Devices and local execution

- [ ] Tenant-visible device ID, ownership, and caller authorization are not end-to-end proved because the current routes require admin/service credentials.
- [ ] Connector identity and tenant-visible attestation remain unproved.
- [ ] Heartbeat freshness and online-state enforcement remain unproved from the tenant surface.
- [ ] Capability-support evidence remains unproved from the tenant surface.
- [ ] Local consent is not end-to-end proved for Tenant GPT.
- [x] Arbitrary shell replacement with registered command capabilities is covered by `tenant_ssh_cli_allowlisted_execute`, DB-driven connector shell policy, and local connector policy pull evidence.
- [x] Command argument schemas, path traversal/symlink controls, separate file permissions, output bounds, and redaction are covered by the Phase 8 local shell/file tests.

## Mutations and approvals

- [ ] Every mutation across every action/tool/plugin surface has an explicit policy. PR #1879 closes the reviewed GPT-tool and app-action generic-policy bypasses, but the tenant report identifies remaining action-path parity work.
- [x] Existing approval records bind capability, subject, tenant, target, request digest, and expiry where implemented.
- [x] Existing approval replay protection and consumption state are implemented where reviewed.
- [ ] Idempotency coverage for every retryable mutation remains open.
- [ ] Complete high-risk preview/readback/rollback evidence remains open under T084–T089 and T108.

## Audit and privacy

- [ ] Every platform attempt has a persisted decision trace; T092 remains open.
- [x] Reviewed gate states are explicit.
- [ ] The global invariant that no allowed decision contains an unevaluated required gate remains open under T045.
- [ ] Audit immutability/tamper evidence remains open under T094.
- [x] Reviewed tenant responses do not expose secrets or foreign-object metadata.
- [ ] Retention and governed trace-access controls remain open under T093–T094.

## Security review result

The Phase 0 containment increment is fail-closed for the reviewed surfaces and now addresses both P1 review comments on broad generic policy matches. General tenant state-changing execution remains release-blocked until the unchecked P0 controls in the unified tenant report are closed and reverified.
