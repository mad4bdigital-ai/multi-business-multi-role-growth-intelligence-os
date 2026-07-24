# Spec 006 Read-Only Canary Pilot Plan — 2026-07-24

## Objective

Run one bounded Dynamic Container canary through the governed promotion, probe, monitoring, and closeout lifecycle. The pilot validates runtime authority resolution under a read-only canary wrapper without changing global rollout mode or mutation enforcement.

## Plan binding

```text
plan_key: spec006_dynamic_container_read_only_canary_20260724
targetCanaryKey: container_authority_rollout_readiness_v1
policy_key: dynamic_container_authority_v1
requested_by: platform_admin
approval_source: explicit user instruction to execute the full sequence
```

No approval or capability envelope from another action may be reused.

## Preconditions

All must pass in the same execution sequence:

1. `release_readiness.overall = pass`.
2. Production parity is `verified` with `blocking_gap_count = 0`.
3. `dynamic_container_rollout_readiness.readiness_code = ready_for_review`.
4. Comparison samples are at least `100`.
5. Mismatch and critical mismatch counts are `0`.
6. Audit coverage is `100%`.
7. p95 is no more than `150 ms`; p99 is no more than `400 ms`.
8. Projection held and high-risk issue counts are `0`.
9. Rollback and closeout tools are callable.

## Execution sequence

1. Run `dynamic_container_canary_promotion` in `dry_run` mode.
2. Create a new plan-bound capability envelope for canary promotion.
3. Approve and apply-authorize that envelope.
4. Apply promotion for exactly `container_authority_rollout_readiness_v1` using the dry-run confirmation.
5. Generate `100` probes with `dynamic_container_canary_probe_sampler`.
6. Read `dynamic_container_canary_monitoring`.
7. If every success condition passes, dry-run and apply `dynamic_container_canary_closeout`.
8. Closeout preserves accepted evidence and returns the canary to shadow.
9. If any condition fails, dry-run and apply `dynamic_container_canary_rollback` instead.
10. Re-read projection, rollout readiness, release readiness, and production parity.

## Success conditions

- Probe count: `100`.
- Failure count: `0`.
- Audit coverage: `100%`.
- p95 and p99 remain within rollout policy budgets.
- Monitoring readiness allows closeout.
- Global rollout mode remains `shadow`.
- Global enforcement remains disabled.
- No provider call, credential payload read, external write, or secret.

## Automatic stop and rollback conditions

Rollback is required for any of:

- Any canary failure.
- Any critical mismatch.
- Audit coverage below `100%`.
- p95 above `150 ms` or p99 above `400 ms`.
- Production parity becomes degraded.
- High-risk projection issue count becomes nonzero.
- Readback contract or capability-envelope consumption fails.

## Promotion boundary

The canary is read-only. It does not authorize global enforcement, mutation enforcement, provider activity, or tenant authority expansion. Any future global enforcement requires a separate plan, separate typed approval, separate capability envelope, and separate rollout review.

## Execution results

Status at plan creation: `planned_pending_production_parity`.

The final PR must replace this section with promotion, probe, monitoring, closeout or rollback evidence before merge.
