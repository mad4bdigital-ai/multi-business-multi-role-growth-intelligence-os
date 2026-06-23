# Tasks

## Design

- [x] Capture tenant-editable platform-base requirement.
- [x] Capture workspace, brand, business-activity-type, and role scopes.
- [x] Define user-selected union/intersection composition.
- [x] Define overlay and fork ownership modes.
- [x] Separate credentials/installations from asset definitions.
- [x] Document current connector and approval-sensitive grant findings.
- [ ] Approve the specification and terminology.

## Canonical alignment

- [ ] Resolve overlap with PR #1894.
- [ ] Add canonical source pages.
- [ ] Update `AI_Agent_Knowledge_Guide.md`.
- [ ] Update memory and execution schemas.
- [ ] Run `node build-canonicals.mjs`.

## Schema

- [ ] Design governed migration and authorization metadata.
- [ ] Add tables, indexes, constraints, and effective views.
- [ ] Add no-secret parity and readiness views.
- [ ] Run migration preflight and readback in development.

## Runtime

- [ ] Implement domain model and resolver.
- [ ] Implement union/intersection tests.
- [ ] Implement overlay/fork versioning.
- [ ] Implement generic grant and scope binding services.
- [ ] Integrate tenant connections, installations, and certifications.
- [ ] Implement specialized-authority bridge adapters.
- [ ] Add Tenant GPT/dashboard APIs.

## Verification

- [ ] Cross-tenant isolation tests pass.
- [ ] Mandatory safety floor cannot be weakened.
- [ ] Credential non-disclosure tests pass.
- [ ] Specialized resolver parity passes per asset family.
- [ ] OpenAPI, CI, architecture, and runtime policy gates pass.
- [ ] Development deployment and release readiness pass.
- [ ] Governed production merge and behavioral readback pass.
