# Requirements Checklist — Spec 019

- [x] Pressure inspection is read-only and bounded.
- [x] Resource semantics are domain-adapter driven.
- [x] Missing policy blocks execution.
- [x] Plans are immutable and fingerprinted.
- [x] Authority is exact resource plus exact recipe.
- [x] Typed approval is plan-bound and non-replayable.
- [ ] Mutation uses registered operations and durable receipts.
- [ ] Same-cycle readback is mandatory.
- [x] Logical cleanup and physical reclaim are separate.
- [x] Engine runs remain plan-only without archive policy.
- [x] No arbitrary SQL, wildcard authority, unbounded batch, or silent default retention.
- [ ] Production rollout requires staging/canary/readback evidence.
