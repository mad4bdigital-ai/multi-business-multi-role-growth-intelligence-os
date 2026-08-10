# Requirements Checklist

## Specification boundaries
- [x] The specification defines `main` as staging/integration authority.
- [x] The specification defines `Production` as production source authority.
- [x] The specification defines Hostinger as immutable application runtime by default.
- [x] Routine local Hostinger application-code mutation is explicitly out of the normal operating path.
- [x] Break-glass is defined as a bounded temporary exception rather than an alternate development workflow.
- [x] Break-glass closure requires reconciliation through `main`, staging verification, `Production`, redeployment, and clean runtime readback.
- [x] Runtime health and runtime integrity are modeled as separate states.
- [x] Canonical resources are defined as SQL-authoritative and registry-driven rather than a fixed activation file list.
- [x] Runtime-critical, routing-index, and on-demand-searchable resource classes are distinguished.
- [x] Activation integrity verification is separated from loading full resource content.
- [x] Deployment attestation is generated from approved source/build evidence rather than manually maintained as primary truth.
- [x] The specification PR explicitly performs no protected-branch write, merge, deployment, Hostinger mutation, migration execution, or secret access.

## Implementation obligations
- [ ] Current production deployment contracts that hard-code or expose `main` are inventoried.
- [ ] Environment authority is represented in governed registry/configuration authority.
- [ ] Production deployment resolves only an exact approved `Production` SHA.
- [ ] Direct routine Hostinger application-code writes are denied by enforcement.
- [ ] Break-glass persistence, authorization, expiry, rollback, and reconciliation state transitions are implemented.
- [ ] Dirty or unreconciled runtime state is detected and reported independently from service health.
- [ ] Canonical resource registry migration and seed data are implemented additively.
- [ ] Activation resolves critical resources through the dynamic registry.
- [ ] On-demand searchable resources can be added or disabled without activation-code edits.
- [ ] Generated deployment attestation is available in shadow/readback mode before enforcement.
- [ ] Explicit mismatch/degraded reason codes are implemented and tested.
- [ ] OpenAPI and affected canonical documentation are updated when public/admin contracts change.

## Release and closeout evidence
- [ ] CI evidence is recorded for each implementation PR.
- [ ] Staging verification on `main` is recorded before production promotion.
- [ ] Release-readiness evidence is recorded before `Production` promotion.
- [ ] Production exact-SHA verification is recorded after deployment.
- [ ] Break-glass negative-path and rollback verification evidence is recorded.
- [ ] Final post-merge audit and runtime-integrity readback are recorded before Spec 018 is marked complete.
