# Implementation PR-2G: Governed Policy & Operational Attention Phase

## Phase scope

This integrated phase implements the common governed questionnaire and policy lifecycle required by Spec 012 tasks T018, T019, T029A, T029B, and T029C, then adopts it for:

- T024B deployment-evidence exposure policy; and
- T025 Activation operational-attention projection.

The phase is deliberately delivered as one architectural unit rather than isolated task patches. Questionnaire intake, pinned versioning, deterministic compilation, immutable safety bounds, impact preview, approval binding, activation, critical invalidation, exact registry readback, rollback, deployment exposure, and operational attention share one authority model and one regression suite.

## Architecture

### Domain

`http-generic-api/src/domain/governedPolicy/governedPolicyQuestionnaireEngine.js`

- immutable versioned definitions;
- pinned sessions;
- deterministic context/prior-answer question visibility;
- bounded schema-oriented answer validation;
- deterministic compiler inputs and hashes;
- immutable safety-bound validation;
- risk and approval-class resolution;
- impact preview and provenance;
- no-secret enforcement.

Domain adapters:

- `activationDeploymentExposurePolicyAdapter.js` enforces immutable principal ceilings, exact registered operation applicability, bounded freshness, unknown-on-missing evidence, and no OAuth reconnect guidance for deployment mismatch;
- `activationOperationalAttentionPolicyAdapter.js` maps Activation/deployment evidence into the existing `operational_alerts` authority without creating a parallel attention table or replaying execution.

### Application

- `governedPolicyQuestionnaireService.js` requires active domain-adoption, exact definition, safety-bound, and compiler versions before session/answer/compilation operations.
- `governedPolicyLifecycleService.js` persists proposals, validates exact proposal/resource/hash approval, prepares activation, publishes critical invalidation, finalizes only after invalidation readback, and requires exact active registry readback. Rollback is a new exact-bound governed operation.

### Infrastructure

`governedPolicyRepository.js` provides transaction-bound SQL ports for definitions, safety bounds, domain adoption, sessions, answers, compilations, proposals, approvals, versions, invalidation outbox, activations, and rollbacks.

Identity includes tenant, policy key, explicit policy version, resource URI SHA-256, and the exact resource URI. No foreign key to an external tenant/user table is introduced, avoiding cross-registry collation coupling while all reads and mutations remain tenant scoped.

## Contracts

- `governed-policy-questionnaire.openapi.yaml`
- `governed-policy-questionnaire.schema.json`
- `deployment-evidence-exposure-policy.schema.json`
- `activation-operational-attention-policy.schema.json`

The OpenAPI contract is final but explicitly records `x-runtime-wired: false`, `x-runtime-authority: governed_sql_policy_registry`, and `x-migration-authorized: false`.

## Persistence design and T026 boundary

Two additive migration designs are included:

- `20260731_governed_policy_questionnaire_foundation.sql`;
- `20260731_governed_policy_registry_authority.sql`.

Neither migration self-registers in `governed_migration_authorization_registry`; neither is authorized or applied by this phase. No active domain/questionnaire/safety-bound seed is inserted. Runtime resolution therefore remains fail-closed until T026 receives governed preflight, explicit authorization, apply, ledger readback, schema readback, and exact registry seed/readback evidence.

## Operational attention reuse

T025 reuses `operational_alerts` and its existing lifecycle/fingerprinting/idempotency authority. The new projection produces bounded candidates only. It performs no notification send, execution replay, provider call, repair, retry, or status mutation.

## Verification

The independent Spec 012 test manifest runs:

- `test-governed-policy-questionnaire-domain.mjs`;
- `test-governed-policy-application-lifecycle.mjs`;
- `test-governed-policy-repository-contract.mjs`;
- `test-governed-policy-migration-and-contracts.mjs`.

The suite proves deterministic compilation, version pinning, visibility, tenant ceilings, no-secret handling, exact approval/readback, invalidation failure behavior, governed rollback, SQL ordering/scoping, unregistered migrations, contract completeness, and absence of route wiring.

## Final head provenance

- Latest `main` observed before the final human-authored CI head: `c86161e48359eb5be3a3567036d7d343b14cfe1e`.
- The only newer `main` delta from the branch merge base was documentation and Work Map output outside the 22-file phase write set; no phase file overlap was present.
- Deterministic frontend artifacts were regenerated, bounded-write verified, and committed by `PR Generated Artifact Refresh` at `d2154e34ce4f16a4cea55eb9654539ad03af68d6`.
- This provenance update creates the human-authored verification head after automation output; it does not authorize or apply migrations, wire runtime routes, deploy, restart, or mutate production.

## Explicit non-effects

This phase performs no:

- database migration apply or ledger mutation;
- active registry seed;
- public route/header wiring;
- production deployment or restart;
- provider/business write;
- external send or notification;
- credential read or secret storage;
- protected-user-path smoke or rollback verification in production.

Spec 012 remains `in_progress`; T026 and runtime-delivery phases remain open after this code phase merges.
