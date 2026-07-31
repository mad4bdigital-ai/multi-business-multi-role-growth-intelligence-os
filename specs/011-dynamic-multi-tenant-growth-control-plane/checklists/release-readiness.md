# Release Readiness Checklist

## Specification PR

- [ ] All 26 planned files exist.
- [ ] Markdown references and inventory are consistent.
- [ ] JSON files parse.
- [ ] JSON Schema is Draft 2020-12 valid.
- [ ] OpenAPI is 3.1 valid with structured errors and security.
- [ ] Requirements map to design, tests, tasks and acceptance.
- [ ] Risks and threats have controls and owners/gates.
- [ ] Branch contains specification files only.
- [ ] CI passes and PR review is complete.

## Implementation PRs

- [ ] Scope is bounded and unrelated changes excluded.
- [ ] Existing authority mapping is documented.
- [ ] API/database/security impact is documented.
- [ ] Tests include invalid input and regression paths.
- [ ] Migrations are additive, checksum-bound and read back.
- [ ] No secret or credential is introduced.
- [ ] Rollback and readback are explicit.
- [ ] Required canonicals/OpenAPI/knowledge are updated.

## Environment gates

- [ ] Dev deployment commit verified.
- [ ] Shadow comparison sample and mismatch thresholds met.
- [ ] Internal pilot verified with no provider write.
- [ ] Staging provider/resource/credential readiness verified.
- [ ] Staging mutation and rollback readback verified.
- [ ] Production canary has typed plan-bound approval.
- [ ] Production parity and audit complete.

## Closeout

- [ ] `completion.json` contains migration, PR, deployment and verification evidence.
- [ ] Open issues have owner, severity and lifecycle.
- [ ] No temporary grant, flag or approval remains unintentionally active.
- [ ] Rollback/hard-disable remains available.
