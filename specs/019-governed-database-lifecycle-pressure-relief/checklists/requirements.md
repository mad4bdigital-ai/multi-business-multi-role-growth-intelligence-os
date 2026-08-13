# Requirements Checklist — Spec 019

- [ ] Pressure inspection is read-only and bounded.
- [ ] Resource semantics are domain-adapter driven.
- [ ] Missing policy blocks execution.
- [ ] Plans are immutable and fingerprinted.
- [ ] Authority is exact resource plus exact recipe.
- [ ] Typed approval is plan-bound and non-replayable.
- [ ] Mutation uses registered operations and durable receipts.
- [ ] Same-cycle readback is mandatory.
- [ ] Logical cleanup and physical reclaim are separate.
- [ ] Engine runs remain plan-only without archive policy.
- [ ] No arbitrary SQL, wildcard authority, unbounded batch, or silent default retention.
- [ ] Production rollout requires staging/canary/readback evidence.
