# Release Readiness Checklist

This checklist separates merge readiness from production rollout readiness.

## Merge evidence
- [x] Spec requirements and traceability are present.
- [x] All generated schemas pass the recursive Builder guard.
- [x] Local generation and committed-artifact parity pass.
- [x] Gateway unit, integration, and security tests pass.
- [x] Signed attestation tamper, registry-version mismatch, cache-failure, and stale-mutation tests pass.
- [x] Full repository test manifest passes: 536/536.
- [x] Architecture validation and canonical build checks pass.

## Remaining production rollout gates
- [ ] DB authority table ownership/lifecycle classified.
- [ ] Exact admin and tenant catalog inventories captured with their real authentication modes.
- [ ] Real tenant JWT negative and positive tests pass in staging.
- [ ] Operation budgets retain warning headroom; Tenant Core is currently 28/30 and above its warning threshold.
- [ ] Governed deployment-attestation publisher is implemented.
- [ ] Temporary-domain smoke passes.
- [ ] DNS/TLS readback passes.
- [ ] Dual-run parity has zero unexplained gaps.
- [ ] Production commit/schema/manifest hashes match readiness record.
- [ ] Rollback rehearsal passes.
- [ ] Legacy usage and sunset decision are recorded.
