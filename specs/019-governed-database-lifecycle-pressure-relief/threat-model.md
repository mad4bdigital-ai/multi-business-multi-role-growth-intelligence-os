# Threat Model — Spec 019 Governed Database Lifecycle and Pressure Relief

| Threat | Control | Failure behavior |
|---|---|---|
| Arbitrary SQL injection | Registered operation and parameterized adapter only | Reject request |
| Wildcard database authority | Exact resource URI and recipe binding | Reject authority |
| GPT-generated predicate | Planner/adapter owns eligibility | Reject free-form predicate |
| Stale plan | Fingerprint, cutoff, resource-version, policy checks | `DATABASE_PLAN_STALE` |
| Approval replay | Approval binds plan ID and fingerprint | Reject replay |
| Unbounded batch | Recipe max and plan max-batches | `DATABASE_BATCH_LIMIT_EXCEEDED` |
| Newer row appears after planning | Immutable cutoff and preservation recheck | Preserve row / fail closed |
| Partial failure | Durable receipt and batch evidence | Reconcile, do not silently continue |
| DB disconnect after dispatch | Unknown-outcome state | Reconcile before retry |
| Missing retention policy | Explicit policy resolution | `DATABASE_LIFECYCLE_POLICY_MISSING` |
| Latest audit observation deletion | Domain adapter invariant | `DATABASE_PRESERVATION_INVARIANT_FAILED` |
| Accidental engine-run deletion | Plan-only adapter until archive contract | `execution_allowed=false` |
| Physical reclaim damage | Separate high-risk recipe and preflight | `DATABASE_PHYSICAL_RECLAIM_UNSAFE` |
| Secret leakage | Bounded structured evidence and redaction | Reject/ redact output |
| Concurrent writer race | Snapshot/version and same-cycle readback | `DATABASE_CONCURRENT_WRITER_DETECTED` |
