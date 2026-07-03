# Release Readiness Checklist

## Scope statement

This checklist distinguishes **Phase 0 merge readiness** from **full tenant execution release readiness**. PR #1879 may merge only as a containment increment. Unchecked items remain release blockers for staging enforcement, unrestricted tenant execution, deployment, or production promotion.

Evidence sources:

- `../containment-validation.md`
- `../tenant-reverification-unified-report-2026-06-23.md`
- `../traceability.md`
- `../rollout.md`
- `../tasks.md`
- `../phase12-verification-release-readiness.md`

## Scope and governance

- [ ] Constitution approval remains separate; `spec.md` is still marked draft for approval.
- [x] Spec, plan, tasks, contracts, acceptance matrix, containment evidence, and tenant reverification report are synchronized for the Phase 0 scope.
- [x] Named owners are recorded for platform approval, runtime rollback, and governance evidence.
- [x] Phase 0 containment T001–T009 is implemented and locally verified.

## Implementation

- [x] Canonical capability resolver, strict selector contract, and security decision engine are implemented for the reviewed increment through T045.
- [x] Strict selector validation is active on the reviewed Platform Plugin path.
- [x] Tenant/admin surface isolation is active on the reviewed paths.
- [x] Credential requirement, resolution, and usability decisions are separated on reviewed paths.
- [x] Secure tenant intake is isolated from raw admin intake.
- [ ] Device trust and Tenant GPT local-consent routing are not end-to-end verified; see tenant report sections 6.7 and 9.2.
- [ ] Mutation approval policy is not complete across the full action/tool inventory; remaining action-path parity is documented in report section 5.2.
- [ ] Activation/readiness projection is not yet globally truthful; report section 7.3 remains open.
- [ ] Structured decision traces are not yet complete platform-wide; T092–T096 remain open.

## Contracts and data

- [x] Reviewed OpenAPI 3.1 specifications validate and remain synchronized with the Phase 0 behavior.
- [x] The error catalog contains the stable denial and containment codes used by the reviewed implementation.
- [x] Existing Phase 0 migrations are additive; the current P1 review fix adds no schema migration.
- [x] Rollback controls and the no-production-promotion boundary are documented.
- [x] Registry alias discovery and current increment integrity checks are complete through T026; full release parity remains gated by Phase 12.
- [ ] Client migration guidance for strict one-selector requests remains open under T099/T102.

## Tests

- [x] Focused unit/regression tests pass for mutation policy, runtime policy, and connect routes.
- [ ] Full current-head integration manifest must pass again after final `main` reconciliation.
- [ ] The complete acceptance matrix has not run in staging; T104 remains open.
- [x] Reviewed cross-tenant/non-enumeration cases pass.
- [x] Reviewed replay and stale-authority cases pass for credential intake and approval records.
- [x] Reviewed secret-redaction tests pass.
- [ ] Performance budget is not ratified; T017/T106 remain open.
- [ ] Complete dependency-outage testing remains open under T107.
- [ ] Bounded staging mutation tests with readback and cleanup remain open under T108.

## Operations

- [x] Five independent server-side kill switches are documented and regression-tested.
- [ ] Shadow comparison is not complete; T105 remains open.
- [x] Temporary high-severity containment alerts are implemented and tested.
- [ ] Decision/gate dashboards are not complete; T090–T096 remain open.
- [x] Containment incident and rollback instructions are documented in `../rollout.md` and `../containment-validation.md`.
- [ ] Rollback has not been exercised in staging; T110 remains open.
- [x] Named operational owners are recorded.

## Review feedback

- [x] P1 review: GPT-tool mutations no longer bypass explicit mutation-policy requirements when a broad generic policy matches.
- [x] P1 review: app-action mutations now require an action-specific policy even when broad advisory app policies match.
- [x] Credential lookup/refresh in `executeAppAction` now occurs only after authorization preflight.
- [x] Regression tests cover both broad-policy bypass cases and credential-access ordering.

## Approval

- [ ] Security approval is not inferred from automated review; final human/governed approval remains required.
- [ ] API/architecture approval remains required for later canonical-domain phases.
- [x] Database approval is not applicable to the current P1 review fix because it contains no schema change.
- [ ] Device/local connector approval remains required.
- [ ] Full release-readiness approval remains blocked by the unchecked controls above.
- [ ] Explicit production-promotion approval has not been granted.

## Phase 12 release gates

- [ ] T103 full unit/integration/security suites have current-head CI evidence.
- [ ] T104 acceptance matrix A01-J08 has run in staging preview mode.
- [ ] T105 shadow mismatches have been triaged with zero unreviewed P0/P1 mismatch.
- [ ] T106 latency and resource budgets have been ratified against the Phase 1 baseline.
- [ ] T107 dependency-outage drills prove fail-closed behavior.
- [ ] T108 bounded staging mutations have approval, readback, cleanup, and rollback metadata.
- [ ] T109 security and architecture reviews are complete.
- [ ] T110 rollback exercise preserves P0 containment.
- [ ] T111 this checklist is complete with evidence links.
- [ ] T112 explicit production-promotion approval is recorded.
- [ ] T113 enforcement-group rollout has monitoring evidence.
- [ ] T114 legacy branches are retired only after stability and parity criteria pass.

## Current decision

**Eligible only for Phase 0 containment merge after:**

1. reconciliation with current `main`,
2. full final-head test/CI success,
3. confirmation that the two P1 review findings are resolved on the final head,
4. clean mergeability and exact changed-file readback.

**Not eligible for unrestricted tenant execution, deployment, or production promotion.**
