# Implementation Plan: Adaptive Authorization and Execution Governance

## Summary

Implement an additive, shadow-first architecture that resolves canonical capabilities, relationships, grants, contextual policy, adapters, approvals, execution envelopes, and evidence without disrupting existing routes.

## Architecture impact

- **API**: Resource-oriented decision, envelope, approval, execution, and evidence contracts.
- **Application**: Use cases for decision, envelope creation, approval, dispatch, readback, and reconciliation.
- **Domain**: Typed capability, relationship, grant, policy, obligation, envelope, execution, and evidence models.
- **Infrastructure**: SQL repositories, policy adapter, relationship resolver, adapter registry, audit store, and reconcilers.
- **Database**: Additive registries and ledgers only after physical-model review and migration authorization.
- **OpenAPI**: Version 3.1 with strict schemas and structured errors.
- **Canonicals**: Update system bootstrap, direct instruction registry patch, module loader, prompt router, memory schema, and knowledge guide during implementation.

## Phases

### Phase 0 — Specification and contracts

Approve the ADR, map logical resources to existing authorities, finalize contracts, and define pilot metrics. No runtime changes.

### Phase 1 — Shadow decision kernel

Resolve canonical aliases, read existing authority, produce adaptive decisions beside legacy decisions, persist bounded comparison evidence, and correct active-grant presentation. Adaptive decisions cannot authorize provider execution.

### Phase 2 — Pilot projections

Pilot `activation.skills.read`, `platform.output-artifact.write`, and `content.wordpress.publish`. WordPress remains shadow-only until all approval, credential, authority, idempotency, and readback gates pass.

### Phase 3 — Enforcement canary

Enable the shared enforcement kernel for selected internal operations, require revision-bound envelopes, test expiry and replay prevention, and preserve rollback.

### Phase 4 — Reconciliation

Introduce narrow reconcilers for relationship, grant, policy, connection, certification, approval, and readback drift.

### Phase 5 — Compatibility migration

Compatibility wrappers call the adaptive kernel, legacy use and parity are measured, deprecation windows are published, and duplicate authorization is removed only after complete evidence.

## Safety, observability, and validation

Fail closed on ambiguity and stale decisions, resolve scope from authentication, exclude credential material, require idempotency, use additive migrations, and separate specification, implementation, migration, rollout, and closeout PRs.

Measure decision latency, parity, mismatch reasons, stale-envelope rejection, approval expiry, adapter ambiguity, readback completion, and reconciliation lag.

Require unit, integration, cross-tenant, replay, stale-revision, idempotency, concurrency, shadow parity, OpenAPI compatibility, Spec Kit completion, CI, release readiness, rollback, and audit evidence.
