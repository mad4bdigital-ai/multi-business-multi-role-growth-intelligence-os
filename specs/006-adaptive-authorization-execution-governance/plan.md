# Implementation Plan: Adaptive Authorization and Execution Governance

## Summary

Implement an additive, shadow-first architecture that resolves canonical capabilities, relationships, grants, contextual policy, adapters, approvals, execution envelopes, and evidence without disrupting existing routes.

## Architecture impact

- **API**: Add resource-oriented authorization, envelope, approval, execution, and evidence contracts. Existing routes become compatibility clients only after shadow validation.
- **Application**: Add use cases for decision, envelope creation, approval, dispatch, readback, and reconciliation.
- **Domain**: Add typed capability, relationship, grant, policy, obligation, envelope, execution, and evidence models.
- **Infrastructure**: Add SQL repositories, policy adapter, relationship resolver, adapter registry, audit store, and reconcilers.
- **Database**: Additive registries and ledgers only after physical-model review and migration authorization.
- **OpenAPI**: OpenAPI 3.1 contract with strict schemas and structured errors.
- **Canonicals**: Update system bootstrap, direct instruction patch, module loader, prompt router, memory schema, and knowledge guide when implementation begins.

## Phases

### Phase 0 — Specification and contracts

Approve ADR and terminology, validate the logical model against existing registries, finalize contracts, and define pilot metrics. No runtime behavior change.

### Phase 1 — Shadow decision kernel

Resolve canonical aliases, read existing relationships, grants, and policies without mutation, produce adaptive decisions beside legacy decisions, persist bounded no-secret comparison evidence, and fix operational presentation so active grants remain active. No adaptive decision may authorize provider execution.

### Phase 2 — Pilot capability projections

Pilot `activation.skills.read`, `platform.output-artifact.write`, and `content.wordpress.publish`. Read and internal-write pilots may advance to canary after parity. WordPress publish remains shadow until approval, credential, resource authority, idempotency, and readback gates pass.

### Phase 3 — Enforcement canary

Enable the shared PEP kernel for selected internal operations, require revision-bound envelopes, exercise approval expiry and replay prevention, and preserve explicit rollback.

### Phase 4 — Reconciliation

Introduce narrow reconcilers for relationship drift, grant lifecycle, policy revision, connection readiness, adapter certification, approval expiry, and execution readback.

### Phase 5 — Compatibility migration

Route wrappers call the adaptive kernel, legacy use and parity are measured, deprecation windows are published, and duplicate authorization is removed only after complete evidence.

## Safety and rollout

- Fail closed on ambiguity and stale decisions.
- Resolve tenant authority from authentication.
- Return no secrets or raw policy internals to tenant callers.
- Require idempotency for state-changing execution.
- Use additive reversible migrations.
- Separate implementation PRs from migration, rollout, and closeout PRs.
- Record CI, staging, production parity, rollback rehearsal, and post-merge audit.

## Observability

Measure decision latency, parity, mismatch reasons, stale-envelope rejection, approval expiry, adapter ambiguity, readback completion, and reconciliation lag.

## Validation

Unit, integration, cross-tenant, replay, stale-revision, idempotency, concurrent approval, shadow parity, OpenAPI compatibility, Spec Kit completion, CI, release readiness, and post-merge audit tests are required.
