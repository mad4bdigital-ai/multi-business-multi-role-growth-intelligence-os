# Tasks

## T1 Father spec kit

- [x] Define alert families.
- [x] Define child PR order.
- [x] Define no-provider and no-secret boundaries.
- [x] Define closeout criteria.

## T2 Hostinger SSH probe deploy readback

- [ ] Verify DB-backed probe and deploy gates are short lived and target scoped.
- [ ] Ensure password auth uses file descriptor delivery only.
- [ ] Ensure probe timeouts return structured errors.
- [ ] Ensure deploy requires exact SHA and capability envelope.
- [ ] Add or update Hostinger tests.
- [ ] Document readback sequence.

## T3 Credential intake handoff

- [ ] Return credential-intake continuation for blocked missing secret paths.
- [ ] Preserve tenant vs platform scope boundaries.
- [ ] Add tests for no-secret continuation payloads.

## T4 OpenClaude bridge transport

- [ ] Verify bridge health and certification gates.
- [ ] Keep provider lane no-tool and no-repo-mutation.
- [ ] Add live-dispatch dry-run and readback tests where applicable.

## T5 Deployment reliability

- [ ] Add durable deployment job receipt where missing.
- [ ] Treat transient HTML 503 as indeterminate until health and commit readback.
- [ ] Add atomic SHA pin and revalidation guard.

## T6 GitHub CI recovery

- [ ] Diagnose missing or action_required checks.
- [ ] Prefer read-only diagnosis.
- [ ] Add bounded workflow dispatch recovery only with authority.

## T7 DB update serialization

- [ ] Fix single-statement DB update result serialization.
- [ ] Preserve bounded affected-row evidence.
- [ ] Add tests for UPDATE and UPDATE plus SELECT compatibility.

## T8 Deploy intent alignment

- [ ] Align active policy intent with envelope operation intent.
- [ ] Add compatibility alias only if explicitly governed.
- [ ] Add regression tests.

## T9 Capability envelope lifecycle

- [ ] Add consume lifecycle action.
- [ ] Add cancel lifecycle action.
- [ ] Add expire lifecycle action.
- [ ] Require audit and same-cycle readback.

## T10 Google Ads readiness

- [ ] Validate Google Ads connection readiness.
- [ ] Validate budget preflight without provider call.
- [ ] Keep spend changes blocked until authority exists.
