# Operational Model

## Operating states

### Compiler

```text
disabled
shadow_ready
running
complete
partial
failed
stale
```

A partial compilation never silently omits sources. It marks manifest completeness and blocks affected projection/apply decisions.

### Capability

```text
registered
classified
manifest_ready
projection_ready
shadow_ready
canary_ready
active
blocked
stale
revoked
disabled
```

### Execution

```text
previewed
ready_requires_approval
ready_for_dispatch
reserved
dispatched
acknowledged_pending_readback
verified_success
verified_mismatch
unknown_provider_effect
compensation_pending
manual_intervention_required
```

## SLO candidates

Final values require production baseline and approval.

- Tenant/Admin preview availability: 99.9%.
- Preview p95: <= 500 ms for cached current manifest; p99 <= 1.5 s.
- Incremental manifest freshness: <= 5 minutes after governed registry change.
- Unsafe active projection detection: <= 5 minutes.
- Certification expiry/staleness detection: <= 5 minutes.
- External write readback attempt begins within capability contract timeout.
- Critical assurance gap notification within one reconciliation cycle.

## Metrics

- surfaces discovered/classified/unresolved;
- manifests current/stale/invalid;
- gaps by type/severity/source/cohort;
- Admin/Tenant projection candidates and drift;
- legacy/adaptive decision mismatch classes;
- denied requests by reason code;
- envelope creation/approval/replay/expiry;
- adapter candidate ambiguity and certification state;
- acknowledgement/readback success/mismatch/unknown effect;
- debt opened/assigned/resolved/aged;
- compiler and preview latency.

## Operational alerts

Critical alerts include:

- cross-tenant allow or foreign-resource pass;
- adaptive allow where legacy denies without approved exception;
- unsafe active Tenant projection;
- state-changing dispatch without manifest/policy/certification/readback contract;
- credential scope mismatch;
- envelope replay or duplicate dispatch;
- secret-bearing evidence;
- external mutation with missing readback;
- rollback unable to restore safe enforcement.

## Reconciliation cadence

- Event-driven after governed registry change.
- Scheduled incremental compilation.
- Daily deep full-source reconciliation.
- Pre-release full compilation and projection audit.
- Same-cycle reconciliation after mutation/certification/readback changes.

## Runbooks

### Compiler partial

1. Identify missing/truncated source.
2. Keep affected manifests stale/blocked.
3. Repair source or pagination.
4. Recompile with same compiler version.
5. Verify manifest counts/hashes and debt transitions.

### Unsafe Tenant projection

1. Disable/revoke the projection without deleting evidence.
2. Preserve capability and Admin diagnostics.
3. identify missing exposure/authority/schema gate.
4. recompile and compare.
5. re-enable only after reviewed reconciliation and readback.

### Unknown provider effect

1. Do not retry blindly.
2. Run capability readback using provider reference/idempotency identity.
3. classify verified success, mismatch, or manual intervention.
4. create compensation request only with separate authority.

### Certification drift

1. Mark certification stale.
2. remove adapter from eligible selection.
3. queue bounded recertification.
4. verify contract/code/provider revisions.
5. restore only after pass evidence.

## Rollback

Roll back per capability and cohort. Disable dynamic enforcement while preserving P0 denials and evidence. Return to legacy execution only when legacy is still safe and current. Never delete decisions, approvals, execution attempts, readback, or debt history.

## Capability debt ownership

Debt includes severity, owner class, source evidence, target capability, due/expiry policy, and closure proof. Unowned critical debt is release-blocking. `completed_with_backlog` requires tracked references and owners.
