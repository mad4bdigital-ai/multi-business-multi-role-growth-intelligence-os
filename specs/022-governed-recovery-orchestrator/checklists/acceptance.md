# Feature 022 — Acceptance checklist

## Source and Control Plane
- [x] Document guarded discovery, planned execution and fail-closed behavior.
- [x] Add source-level negative tests for duplicate, stale and uncertain write outcomes.
- [ ] Re-run exact-HEAD source CI and Test Authority Closure after changes.

## Independent Staging and Host evidence
- [ ] Prove native MariaDB durable journal, atomic claims, unknown COMMIT ACK and fencing across processes.
- [ ] Prove signed/single-use consent, exact resource/actor binding and revocation.
- [ ] Prove actual Windows device identity, cold boot, Supervisor/Doctor and Docker on the authorized current device.
- [ ] Prove Hostinger grants, catalog/runtime identity, migration readback and safe compensating actions.
- [ ] Complete native E2E and independently verified rollback tests.

## Merge and release
- [ ] Re-attest final exact HEAD by repository owner.
- [ ] Verify applicable active GitHub Rulesets, trusted source status and latest merge candidate.
- [ ] Complete Staging acceptance before any runtime promotion.
- [ ] Obtain separate explicit Production authorization; not included in this PR.
