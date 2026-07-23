# Governed Interactive Policy Questionnaires

## Purpose

The platform uses interactive questionnaires to collect user and operator intent for configurable operational policies without exposing unsafe raw configuration or hardcoding tenant/provider behavior throughout the codebase.

A questionnaire is a governed decision-intake surface. It is not runtime authority. Active policy remains in versioned SQL registries.

## Lifecycle

```text
Context
→ questionnaire definition/version
→ answer session
→ deterministic compilation
→ safety validation
→ impact preview
→ approval/typed confirmation
→ policy activation
→ registry readback
→ monitoring
→ rollback/supersession
```

## Design principles

- Guided choices before raw technical values.
- Progressive disclosure for advanced/expert controls.
- Immutable safety bounds outside user control.
- Deterministic compilation from pinned definitions, templates, compiler versions, and answers.
- Exact proposal/resource/version binding for approvals.
- SQL registry authority and readback before reporting activation.
- Idempotent submission, activation, and rollback.
- Tenant, workspace, object, and role isolation at every stage.
- No credentials, raw secrets, tokens, or authorization headers in definitions, answers, previews, or audit evidence.
- AI may explain and recommend but cannot invent values, bypass policy, or activate high-risk changes.

## Interaction modes

### Guided

Uses goal-oriented questions and safe versioned profiles such as `fast`, `balanced`, `complete`, and `high_reliability`.

### Advanced

Allows authorized technical users to choose bounded deadlines, retries, freshness, degradation, alert, and rollout behavior.

### Expert governed

Allows Platform Admin/Security/Operations to propose custom policy within domain safety contracts, with impact preview, approval, typed confirmation, effective dates, and rollback.

## Platform domains

The common engine is intended for staged domain adoption:

1. Activation SLO, retry, freshness, and degradation policy.
2. Resolution risk, approval, repair, retry, and readback policy.
3. Onboarding/JIT provisioning and workspace defaults.
4. Managed/Dedicated/mixed integration profiles.
5. Agent delegation, model/provider, concurrency, and budget controls.
6. Notification, escalation, and operational-attention policy.
7. Shadow/canary/GA rollout and rollback policy.
8. Data retention, export, diagnostic detail, and redaction policy.
9. Growth Intelligence workflow objectives, channels, approvals, budgets, and measurement windows.

A domain may adopt the engine only after defining its schema, safety bounds, deterministic compiler, risk model, approval policy, runtime registry mapping, parity tests, observability, and rollback contract.

## Safety boundary

Configurable examples:

- soft/hard deadlines within allowed ranges;
- retry count within ceilings;
- freshness window;
- synchronous/asynchronous response behavior;
- degradation profile;
- notification/escalation timing;
- rollout cohort and observation window;
- integration mode where permitted.

Non-configurable safeguards include:

- tenant isolation;
- active membership checks;
- issuer/audience/resource/purpose verification;
- no-secret handling;
- object-level authorization;
- required capability/approval/typed confirmation/readback;
- maximum retry and operation-window ceilings;
- idempotency for unsafe retryable operations;
- reconcile-before-retry for unknown unsafe outcomes;
- fail-closed behavior for missing or invalid policy.

## Versioning and provenance

Every active policy records:

- questionnaire key/version;
- template key/version;
- compiler key/version;
- normalized answer/input hash;
- safety-bounds version;
- policy proposal/version;
- approval and resource binding;
- effective/expiry timestamps;
- prior/superseded version;
- activation and registry-readback evidence.

Profiles are versioned, for example `balanced_v1`. Updating a template does not silently change an already active policy.

## Impact preview

Before approval, the user sees:

- affected tenants, apps, operations, and stages;
- expected user experience;
- security and permission impact;
- performance/cost estimate where supported by evidence;
- compatibility impact;
- required approval;
- rollout/canary behavior;
- rollback target;
- incomplete or uncertain evidence.

Unsupported estimates must be identified as unknown rather than invented.

## Approval and activation

- Low-risk bounded proposals may use tenant-owner confirmation.
- Medium-risk proposals require designated owner approval.
- High-risk proposals require Platform Admin or Security approval.
- Critical or mutation-enabling proposals require plan-bound typed approval.
- Proposal or resource drift invalidates prior approval.
- Activation is not complete until the exact version is read back from runtime authority.

## API direction

Proposed resource-oriented operations include:

```text
GET  /tenant/questionnaires
POST /tenant/questionnaire-sessions
GET  /tenant/questionnaire-sessions/{sessionId}
POST /tenant/questionnaire-sessions/{sessionId}/answers
POST /tenant/questionnaire-sessions/{sessionId}/previews
POST /tenant/questionnaire-sessions/{sessionId}/submissions
POST /tenant/policy-proposals/{proposalId}/approvals
POST /tenant/policy-proposals/{proposalId}/activations
POST /tenant/policies/{policyId}/rollbacks
```

Public implementation uses OpenAPI 3.1, stable operation IDs, explicit security, structured errors, request IDs, pagination where needed, and idempotency for unsafe retryable operations.

## Runtime layers

- **Interface**: request validation, authentication/authorization, and response mapping.
- **Application**: session, question selection, compilation, preview, approval, activation, readback, and rollback orchestration.
- **Domain**: visibility rules, deterministic compiler, safety bounds, risk and approval policy, compatibility, and lifecycle invariants.
- **Infrastructure**: SQL registries/repositories, audit, metrics, external evidence adapters, and cache invalidation/readback.

## First implementation

Spec 012 applies the pattern first to Activation stage SLO, timeout, retry, freshness, degradation, and synchronous/asynchronous behavior. Production baselines and starter profiles are measured before activation; values are versioned policy, not scattered constants.

## References

- `specs/012-tenant-activation-lifecycle/decisions/ADR-005-governed-interactive-policy-questionnaire-engine.md`
- `.specify/memory/constitution.md`
- `docs/spec-kit-governance.md`
- `AI_Agent_Knowledge_Guide.md`
