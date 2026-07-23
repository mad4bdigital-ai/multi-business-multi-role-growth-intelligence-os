# ADR-005: Governed Interactive Policy Questionnaire Engine

**Status**: Accepted  
**Date**: 2026-07-22  
**Decision owner**: Platform Admin / Product / Policy Runtime  
**Resolves**: Q-004 architecture and establishes a platform-wide configuration principle

## Context

The platform contains many operational choices that should vary by tenant, workflow, dependency, risk, service tier, and user preference. Examples include Activation time budgets, retry behavior, freshness windows, Managed/Dedicated integration modes, Resolution approval policy, rollout cohorts, notification escalation, agent delegation, and data-governance profiles.

Hardcoding every value creates deployment coupling, policy drift, and poor long-term scalability. Exposing raw technical values directly to non-technical users creates unsafe configuration and a poor experience. Allowing unrestricted dynamic policy would weaken security and reliability.

## Decision

Adopt a platform-wide **Governed Interactive Policy Questionnaire Engine**.

The engine presents context-aware questionnaires, compiles validated answers into a versioned policy proposal, shows an impact preview, resolves the required approval path, and activates the resulting policy only through governed registry authority and readback.

The lifecycle is:

```text
Context
→ questionnaire definition/version
→ answer session
→ policy compilation
→ validation and safety bounds
→ impact preview
→ approval/typed confirmation when required
→ versioned policy activation
→ runtime resolution
→ monitoring
→ rollback/supersession
```

A questionnaire is an intake and decision surface. It is never runtime authority. SQL policy registries remain runtime authority.

## First implementation domain

Spec 012 uses the engine first for Activation stage SLO, timeout, retry, freshness, degradation, and synchronous/asynchronous response policy.

Q-004 is resolved architecturally as follows:

- service targets are not hardcoded per route or provider;
- users select goals and risk preferences through guided profiles or advanced questions;
- the compiler produces an `activation_stage_slo_policy` proposal;
- the policy is validated against immutable safety bounds;
- the active version is stored in a governed SQL registry;
- runtime resolves the active policy by stage, operation profile, activation mode, dependency class, tenant tier, and effective time;
- exact production thresholds are measured and versioned as policy profiles rather than embedded throughout application code.

## Interaction modes

### Guided

For tenant owners and non-technical users. Uses goal-oriented questions and recommended profiles such as:

- `fast`;
- `balanced`;
- `complete`;
- `high_reliability`;
- `custom_governed`.

### Advanced

For authorized technical administrators. Exposes bounded technical controls such as soft/hard deadlines, attempts, freshness, degradation behavior, and alert sensitivity.

### Expert governed

For Platform Admin/Security/Operations. Supports custom policy proposals, risk classification, impact preview, effective dates, rollout, approval, typed confirmation, and rollback.

## Dynamic question behavior

Questions are selected from context and previous answers. Examples:

- read-only operations do not ask mutation-idempotency questions;
- external providers expose timeout, rate-limit, freshness, and degradation questions;
- repair operations expose approval, typed-confirmation, idempotency, and readback questions;
- tenant viewers see read-only options;
- Dedicated mode exposes infrastructure-readiness questions;
- high-risk answers trigger additional review and approval questions.

Every answer session is pinned to a questionnaire version. Question definitions do not change silently during an active session.

## Safety model

### Configurable within bounds

The engine may configure:

- soft and hard deadlines within allowed ranges;
- retry count within ceilings;
- backoff policy;
- freshness windows;
- synchronous versus asynchronous behavior;
- degradation behavior;
- notification and escalation timing;
- rollout cohort and observation window;
- approved integration mode;
- policy detail/retention profiles where allowed.

### Immutable or non-overridable safeguards

The engine cannot disable or weaken:

- tenant isolation;
- active membership checks;
- issuer/audience/resource/purpose verification;
- no-secret handling;
- object-level authorization;
- maximum retry and operation-window ceilings;
- reconcile-before-retry for unknown unsafe outcomes;
- idempotency for unsafe retryable mutations;
- required capability, approval, typed confirmation, or readback;
- fail-closed behavior for missing/invalid policy;
- prohibition on cross-tenant access.

The registry can choose within safety bounds but cannot redefine those bounds.

## Policy compiler

The compiler input includes:

- questionnaire key/version;
- tenant/user/workspace context;
- actor role and authority;
- answers;
- source profile/template version;
- applicable domain/stage/dependency/risk context.

The compiler output includes:

- proposed policy type and version;
- normalized values;
- source answer references;
- compiler version;
- safety validation result;
- risk tier;
- affected resources/operations/tenants;
- compatibility impact;
- required approval class;
- rollout and rollback plan;
- effective/expiry timestamps;
- no-secret declaration.

The same inputs and versions must produce deterministic policy output.

## Impact preview

Before submission or activation, the user sees:

- affected operations, tenants, apps, and stages;
- expected user experience;
- timeout/retry/freshness behavior;
- security and permission impact;
- cost/performance estimate where evidence supports it;
- compatibility impact;
- required approvals;
- rollout/canary plan;
- rollback or prior policy version;
- unresolved warnings or blocked conditions.

The preview is evidence-based and does not claim certainty where measurement is unavailable.

## Approval model

- Low-risk bounded proposals may require tenant-owner confirmation.
- Medium-risk proposals require designated owner approval.
- High-risk proposals require Platform Admin or Security approval.
- Critical or mutation-enabling proposals require plan-bound typed approval and cannot reuse unrelated approval holds.
- Approval is invalidated by proposal/version/resource drift.

## Platform data model

Logical entities include:

- QuestionnaireDefinition;
- QuestionDefinition;
- QuestionnaireSession;
- QuestionnaireAnswer;
- PolicyTemplate;
- PolicyCompilation;
- PolicyProposal;
- ImpactPreview;
- PolicyApproval;
- PolicyActivation;
- PolicyVersion;
- PolicyReadback;
- PolicyRollback/Supersession.

Physical storage must reuse governed registries where semantics fit and use additive schema where needed.

## Platform application domains

The engine is designed for staged adoption in:

1. Activation SLO/retry/freshness/degradation policy;
2. Resolution risk, approval, retry, and repair boundaries;
3. onboarding/JIT provisioning and workspace defaults;
4. integration Managed/Dedicated/mixed profiles;
5. agent runtime delegation, model/provider, concurrency, and budgets;
6. notification, escalation, and attention policy;
7. rollout/canary/GA and rollback policy;
8. data retention, diagnostic detail, export, and redaction policy;
9. Growth Intelligence workflow objectives, channels, budgets, approvals, and measurement windows.

Each domain adoption requires a domain contract, safety bounds, compiler, approval policy, tests, and runtime registry mapping. The engine is not a generic arbitrary-configuration editor.

## API shape

The proposed resource-oriented API includes:

- `GET /tenant/questionnaires`;
- `POST /tenant/questionnaire-sessions`;
- `GET /tenant/questionnaire-sessions/{sessionId}`;
- `POST /tenant/questionnaire-sessions/{sessionId}/answers`;
- `POST /tenant/questionnaire-sessions/{sessionId}/previews`;
- `POST /tenant/questionnaire-sessions/{sessionId}/submissions`;
- `POST /tenant/policy-proposals/{proposalId}/approvals`;
- `POST /tenant/policy-proposals/{proposalId}/activations`;
- `POST /tenant/policies/{policyId}/rollbacks`.

Unsafe create/approve/activate/rollback operations require idempotency and stable structured errors.

## Runtime architecture

### Interface layer

Validates questionnaire/session/answer requests, authenticates and authorizes, and maps responses.

### Application layer

Orchestrates sessions, question selection, compilation, preview, approval, activation, readback, and rollback.

### Domain layer

Owns visibility rules, deterministic compilation, safety bounds, risk classification, approval requirements, compatibility, and lifecycle invariants.

### Infrastructure layer

Implements SQL registries/repositories, metrics, audit, external evidence adapters, and policy cache invalidation/readback.

## Long-term growth controls

- Questionnaire, template, compiler, and policy versions are explicit.
- Active sessions remain pinned to their original version.
- Profiles are versioned, e.g. `balanced_v1`; templates do not change active policies silently.
- New question types and domains require schema and compatibility review.
- Policy registry changes are audited and fail closed.
- Critical policy changes invalidate or bypass stale caches.
- AI may explain and recommend but cannot override safety bounds, invent registry values, or activate high-risk policy without required approval.

## Consequences

### Positive

- Reduces code deployments for bounded operational configuration.
- Gives non-technical users understandable choices while preserving expert control.
- Standardizes configuration, preview, approval, versioning, activation, and rollback across domains.
- Prevents hardcoded route/provider settings from proliferating.
- Produces explainable, auditable, deterministic policy changes.
- Supports tenant-specific growth without separate products or OAuth clients.

### Costs and risks

- The engine and compiler become security- and reliability-critical.
- Questionnaire complexity may overwhelm users without guided profiles and progressive disclosure.
- Policy/template/compiler version drift requires strong provenance and testing.
- Impact estimates may be incomplete; previews must disclose uncertainty.
- A generic engine could become a dumping ground unless each domain has explicit ownership and safety contracts.

## Rejected alternatives

### Hardcode operational values

Rejected because it couples policy evolution to code deployment and does not scale across tenants/providers.

### Expose raw configuration fields directly

Rejected because it is unsafe, difficult for non-technical users, and lacks intent/impact context.

### Fully autonomous AI policy tuning

Rejected because it is not sufficiently explainable or governable for security, reliability, and mutation-sensitive policies. AI recommendations may produce drafts only.

### Unrestricted generic settings engine

Rejected because domain-specific safety bounds, authority, and validation are required.

## Verification

Required verification includes:

- deterministic compilation from pinned versions and answers;
- question visibility and dependency logic;
- guided/advanced/expert authority boundaries;
- safety-bound enforcement;
- invalid/unknown answer rejection;
- proposal and impact-preview provenance;
- approval invalidation on drift;
- idempotent submission/activation/rollback;
- active policy registry readback;
- cache invalidation for critical changes;
- rollback to prior version;
- tenant/object-level isolation;
- no raw secrets or sensitive values in definitions, answers, previews, or audit evidence;
- domain-specific contract and runtime parity.
