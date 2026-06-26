# Resource Surface Policy Governance Review Checklist

## Architecture and policy

- [x] Every surface has an explicit exposure class.
- [x] Descriptor and operation requirements are separate.
- [x] Archive and version requirements are policy-driven.
- [x] Internal surfaces use explicit `not_applicable` states.
- [x] Broad pattern exemptions are not used for ordinary internal surfaces.
- [x] Logical resources remain independent from physical persistence layout.

## Safety

- [x] Migration is additive and metadata-only.
- [x] No DROP, TRUNCATE, hard DELETE, archive execution, provider call, external send, credential read, or secret return is introduced.
- [x] Tenant identity and authorization behavior are unchanged.
- [x] Existing HTTP and OpenAPI contracts remain backward compatible.

## Tests and delivery

- [x] Pure policy evaluator covers positive and negative paths.
- [x] Changed-scope gate requires descriptor or explicit policy.
- [x] Migration and manifest consistency are tested.
- [ ] CI passes.
- [ ] Release readiness passes.
- [ ] Implementation PR is merged.
- [ ] Migration 1025 is applied with governed ledger evidence.
- [ ] Production parity is verified.
- [ ] Persisted live audit reports zero unresolved findings.
- [ ] Final closeout PR is merged.
