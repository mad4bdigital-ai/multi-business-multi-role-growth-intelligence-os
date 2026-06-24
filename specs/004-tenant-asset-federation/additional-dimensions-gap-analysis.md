# Additional Dimensions Gap Analysis

## 1. Conclusion

The current Spec Kit is strong in shared assets, contextual authority, typed policy composition, user preferences, optional variants, readiness, explainability, and governed adaptation. Deep review of the live code and database shows that a production-grade dynamic platform also needs surrounding planes for organizational identity, tenant lifecycle, data governance, commercial control, model governance, provenance, temporal/environment semantics, asynchronous execution, supply-chain trust, portability, resilience, and quality evaluation.

These dimensions do not replace the design. They extend the Context Compiler so that the Effective Runtime Manifest represents every authority and readiness surface that can materially change a decision.

## 2. Expanded compiler

```text
Principal and organization graph
+ Tenant federation and lifecycle
+ Workspace / brand / business activity / role
+ Time / environment / region / jurisdiction
+ Shared assets and optional variants
+ Policies and user preferences
+ Commercial entitlement / quota / cost reservation
+ Model capability / quality / cost / data-handling policy
+ Knowledge and artifact provenance
+ Connection / installation / certification
+ Workload / concurrency / scheduling / cancellation
+ Approval and human operating capacity
+ Resilience / backup / degraded-mode state
= Effective Runtime Manifest
```

## 3. Priority summary

### P0 — required before contextual write enforcement

1. Organizational principal graph and group/service identities.
2. Tenant federation, lifecycle, offboarding, and ownership transfer.
3. Data governance, purpose, consent, retention, residency, export, and erasure.
4. Commercial entitlement, metering, reservation, settlement, and cost attribution.
5. Model governance, evaluation, and context-aware routing.
6. Universal asynchronous consistency, idempotency, cancellation, and compensation.
7. Artifact/knowledge lineage, provenance, sensitivity, and verification.
8. Temporal, environment, region, and jurisdiction semantics.

### P1 — required before broad tenant ecosystem expansion

9. Plugin/package supply-chain and marketplace governance.
10. Schema and semantic compatibility governance.
11. Tenant portability, import/export, and disaster-recovery integration.
12. Human workload, escalation, service levels, and separation of duties.
13. Capability ontology, equivalence, substitution, and deprecation.
14. Localization, accessibility, and jurisdiction-aware behavior.

### P2 — required for mature self-optimizing growth

15. Quality/evaluation datasets and drift governance.
16. Fairness, recommendation exposure, and experimentation-bias controls.
17. Cross-tenant aggregate learning and confidentiality boundaries.
18. Transparent economic optimization and entitlement experimentation.

## 4. Organizational principal graph

### Current evidence

- `container_role_assignments.principal_type` supports `user`, `agent`, `service`, and `group`.
- No operational group/team/organization identity registry or group-membership authority was found.
- `memberships` contains only user, tenant, role, and status.
- `agent_delegations` exists but is empty and models a narrow execution delegation lifecycle.

### Required design

- principal registry for user, agent, service, and group identities;
- group/team registry and nested membership with cycle/depth limits;
- service-account ownership and authentication assurance;
- principal status, risk, and recertification;
- separation-of-duties rules;
- delegation chains with maximum depth and non-escalation proof;
- break-glass identities with expiry and post-use review;
- principal-specific memory and data-access boundaries.

## 5. Tenant federation and lifecycle

### Current evidence

- `tenants` supports platform owner, partner organization, freelancer operator, managed client account, and brand types.
- `tenant_relationships` supports owns, manages, partners-with, and white-labels, but has no operational rows.
- Tenant status is limited to active, suspended, pending, and archived.
- No dedicated offboarding, ownership-transfer, tenant export, erasure, or legal-hold authority was found.

### Required design

- tenant relationship projection into the context graph;
- relationship-specific delegated administration;
- parent/child billing and shared-service rules;
- white-label branding and domain ownership;
- managed-client isolation from partner operator data;
- tenant transfer and administrator succession;
- lifecycle states such as offboarding, legal hold, exporting, and erasure pending;
- connection shutdown, grant revocation, export, retention, and final erasure workflow;
- orphan asset, variant, approval, and credential handling.

## 6. Data governance and privacy

### Current evidence

- `compliance_profiles` exists but has no rows and is primarily referenced by migration/release-readiness code.
- `database_table_lifecycle_registry` covers 439 tables, while 116 have explicit retention days.
- Current lifecycle scheduling/reporting is deliberately non-destructive and does not execute archive or deletion.
- No general data-subject request, consent-purpose, residency, legal-hold, or erasure registry was found.
- Legal pages mention access, correction, export, and deletion without a corresponding general runtime workflow.

### Required design

- data-classification and sensitivity registry;
- processing-purpose and lawful-basis/consent records where applicable;
- purpose-to-data-use policy;
- tenant/user data-subject request lifecycle;
- legal hold and deletion suppression;
- residency and allowed-processing-region policy;
- retention execution plans with preview, approval, archive, deletion, and evidence;
- derived-data and model-feature deletion propagation;
- cross-tenant aggregation privacy thresholds;
- user-visible data-use and personalization history;
- minimal immutable audit evidence separated from deletable personal content.

## 7. Commercial entitlement and FinOps

### Current evidence

- Plans, subscriptions, entitlements, quotas, usage limits/meters, tenant usage, commercial profiles, credit ledgers, and a budget/quota authority registry exist.
- Several operational tables are empty or sparsely populated.
- The budget/quota authority is currently a dry-run control with one active authority row.
- Commercial routes expose snapshots and direct usage/credit mutations but are not universally bound to an Effective Runtime Manifest, exact action, reservation, or provider readback.

### Required design

```text
Estimate → Reserve → Execute → Verify → Settle → Refund or adjust
```

- asset-family and feature entitlement binding;
- tenant/parent-tenant billing ownership;
- pre-execution cost estimate and reservation;
- idempotent debit, credit, and refund linked to manifest and execution;
- concurrent reservation protection;
- user/workspace/brand/activity showback and chargeback;
- hard ceiling, warning, throttle, approval, and overage policies;
- model/provider token and cost budgets;
- cost-to-business-outcome attribution;
- currency, tax, trial, grace-period, and past-due behavior;
- visible distinction between safety, readiness, and commercial restriction.

## 8. Model governance and routing

### Current evidence

- `ai_model_registry`, `ai_model_providers`, and `agent_model_runs` exist with small registry populations.
- `agentModelRuntimeSettings` uses platform-global configuration, environment credentials, provider ordering, free-first behavior, and a small task-class set.
- `modelAdapterRouter` binds provider/model from configuration and environment.
- Current selection does not fully resolve tenant, workspace, brand, activity, risk, sensitivity, residency, measured quality, tenant entitlement, or dedicated/managed model policy.
- No model-evaluation, golden-dataset, benchmark, drift, or red-team authority was found.

### Required design

- model capability registry for context, tool use, structured output, modality, language, latency, cost, and safety;
- tenant/plan/provider entitlement;
- data-handling and training-retention policy;
- region and residency eligibility;
- risk/task/activity compatibility;
- dedicated/local/managed model-source policy;
- measured quality, latency, reliability, and cost scorecards;
- offline golden evaluations and online calibration;
- model/version deprecation and migration;
- fallback policy that cannot weaken data, safety, tool, or quality constraints;
- prompt/model/tool contract compatibility;
- response verification and confidence requirements by operation class.

## 9. Asynchronous execution and consistency

### Current evidence

- Execution plans, steps, retries, attempts, idempotency keys, chain events, schedulers, and specialized outboxes exist.
- Outbox/inbox behavior is surface-specific rather than universal.
- No single orchestration contract covers transaction-to-event publishing, dead-letter handling, cancellation, compensation, priority, fairness, or backpressure across all actions.

### Required design

- universal operation identity and idempotency contract;
- transactional outbox for state changes that emit events;
- inbox/deduplication for consumers;
- declared delivery semantics: at-most-once, at-least-once, or effectively-once;
- deadlines, cancellation, pause/resume, and expiry;
- retry classification with jitter/backoff;
- dead-letter and manual recovery;
- saga/compensation for multi-step external operations;
- resource reservations and concurrency locks;
- tenant fairness, priority, rate, and backpressure;
- partial-success semantics and resumable checkpoints.

## 10. Artifact and knowledge provenance

### Current evidence

- `output_artifacts` stores run, tenant, brand, workflow, artifact type, content, sink targets, and status.
- The observed schema lacks a complete source lineage, schema version, content checksum, sensitivity, license, retention, verification, and effective-manifest reference.
- Post-run execution-log compliance is not a universal gate.

### Required design

- artifact schema/version and immutable checksum;
- source/evidence graph and trust level;
- effective runtime manifest reference;
- content sensitivity and audience;
- license, ownership, and reuse rights;
- freshness and expiry;
- verification status and validator evidence;
- derived-from relationships and transformation history;
- citation and grounding requirements;
- correction/retraction propagation;
- retention, export, and deletion behavior;
- embedding/index version and retrieval policy.

## 11. Temporal semantics

### Current evidence

- Validity/expiry fields are distributed across roles, grants, policies, relationships, certifications, approvals, connections, and identities.
- Timezone is present in selected scheduler/dashboard/site settings.
- No unified `as_of` resolution contract spans every authority.

### Required design

- effective-from, effective-until, observed-at, and as-of semantics;
- scheduled profile/policy/variant publication;
- grace periods and delayed revocation policy;
- timezone and daylight-saving normalization;
- clock-skew tolerance;
- historical replay against exact authority snapshots;
- experiment-window and temporal-overlap conflict detection;
- future-state preview.

## 12. Environment, region, and jurisdiction

### Current evidence

- Environment and region metadata appears in brand/site and runtime-verification surfaces.
- Certifications are environment-aware.
- No uniform environment/region/jurisdiction dimension was found across profiles, variants, credentials, model routing, and data policy.

### Required design

- environment as a first-class context dimension;
- sandbox and production separation;
- environment-scoped connections, credentials, variants, and approvals;
- promotion pipeline and environment parity evidence;
- region/jurisdiction policy for data and providers;
- regional failover constraints;
- environment-specific quotas and risk posture;
- prohibition on production actions from preview/simulation manifests.

## 13. Plugin/package supply chain

### Current evidence

- Platform plugins include trust level, version, policy bindings, risk/capability metadata, and smoke certification.
- Private packages include source commit, manifest hashes, risk, certification, code-execution, and secret requirements.
- No clear publisher identity, cryptographic signature, SBOM, dependency-vulnerability, license, update-channel, or marketplace-review authority was found.

### Required design

- verified publisher identity;
- signed package/manifest and immutable digest;
- SBOM and dependency lock;
- vulnerability and malware evidence;
- license and redistribution terms;
- requested capability/permission manifest;
- tenant allow/deny and trust policy;
- update channels, staged rollout, rollback, and revocation;
- minimum runtime compatibility;
- marketplace review and abuse reporting;
- commercial/revenue-share policy if external publishers are introduced.

## 14. Schema and semantic compatibility

### Current evidence

- Version fields exist across many tables and package/runtime contracts.
- Resource API governance and OpenAPI coverage are present.
- No single compatibility authority covers asset schemas, policy DSL versions, manifest versions, clients, variants, and model/tool contracts together.

### Required design

- central contract/schema registry;
- backward, forward, full, and breaking compatibility modes;
- semantic-version and breaking-change policy by asset family;
- client capability negotiation;
- migration adapters and deprecation windows;
- policy atom and modifiable-path compatibility;
- variant auto-rebase versus mandatory-review rules;
- manifest-reader compatibility and historical reconstruction tests.

## 15. Portability and tenant exit

### Current evidence

- Internal capability export projections exist.
- No tenant-facing full export/import, subject export, or offboarding package was found.

### Required design

- tenant export manifest covering assets, variants, profiles, grants, preferences, artifacts, and connection metadata without secrets;
- portable stable IDs and source/version references;
- import validation and conflict mapping;
- ownership-transfer package;
- user subject export;
- connection/credential revocation checklist;
- legal-hold-aware deletion;
- deletion completion certificate;
- post-exit minimal-audit retention policy.

## 16. Resilience and disaster recovery

### Current evidence

- Backup policies, runs, artifact manifests, approvals, and restore tests are populated.

### Integration requirements

- RPO/RTO by authority and data family;
- backup coverage for profiles, variants, manifests, proposals, and experiments;
- credential-reference recovery without secret export;
- authority-epoch recovery and cache invalidation;
- regional/provider outage degraded modes;
- restore validation of tenant isolation and manifest reconstructability;
- disaster-mode policy and recovery owner;
- backup/restore evidence in operational readiness.

## 17. Human operating model and service levels

### Current evidence

- Approval holds, assistance roles, execution plans, tickets, alerts, and managed-service modes exist.
- Decision rights are defined, but human workload capacity is not a first-class resolver input.

### Required design

- approver availability and fallback chain;
- queue ownership, workload limits, and escalation timers;
- separation of requester, approver, and executor for high-risk work;
- support-access requests and tenant-visible audit;
- managed-service SLA and handoff state;
- business-hours and timezone-aware escalation;
- unavailable/expired approver behavior;
- operational ownership for rollback and incident response.

## 18. Capability ontology and substitution

### Current evidence

- Asset equivalence groups exist but have no operational rows.
- Shared catalog and plugin capabilities provide candidate metadata.

### Required design

- capability ontology and canonical-intent mapping;
- equivalence, replacement, supersession, and incompatibility edges;
- capability requirements versus asset implementations;
- substitution respecting tenant preference and data policy;
- deprecation and alternative recommendation;
- multilingual synonyms and search taxonomy;
- compatibility graph across agent, skill, workflow, action, app, model, and connection.

## 19. Localization, accessibility, and jurisdiction

### Current evidence

- Locale-sensitive flags and selected timezone fields exist.
- User journeys include RTL/accessibility, but no unified runtime locale/jurisdiction policy was found.

### Required design

- locale/language context separate from canonical IDs;
- translated catalog and explanations;
- locale-specific legal/content constraints;
- currency, number, date, timezone, and calendar handling;
- accessible alternatives for graph/diff views;
- language/model capability compatibility;
- brand terminology and translation approval;
- jurisdiction-aware provider and data routing.

## 20. Quality evaluation and drift

### Current evidence

- Runtime verification covers deployment parity, steps, response size, and operational status.
- Agent model runs capture summaries and cost ledgers.
- No unified evaluation, benchmark, golden-dataset, or quality-drift authority was found.

### Required design

- evaluation suites by asset family, activity, language, and risk;
- tenant-private and platform-public golden datasets;
- exact evaluator/version and rubric;
- grounding, factuality, policy, tool-selection, and output-schema tests;
- red-team and abuse suites;
- model/prompt/workflow regression gates;
- online quality drift and calibration;
- human-review sampling;
- promotion/cutover blocked on insufficient evaluation coverage.

## 21. Fairness and cross-tenant learning

Required controls:

- prevent popularity and exposure feedback loops;
- preserve negative outcomes and dismissals;
- stop one high-volume tenant from dominating platform defaults;
- prohibit inference of sensitive traits;
- use minimum cohorts and approved aggregation;
- permit tenant opt-out where applicable;
- never use raw tenant examples in another tenant's simulation;
- separate aggregate reusable patterns from proprietary content;
- disclose commercial optimization and never disguise it as safety.

## 22. Updated plane model

```text
Identity and Organization Plane
Tenant Federation and Lifecycle Plane
Context and Resource Authority Plane
Policy Composition Plane
Preference and Variant Plane
Data Governance Plane
Commercial and FinOps Plane
Model Governance Plane
Knowledge and Provenance Plane
Runtime Orchestration Plane
Connection and Provider Readiness Plane
Human Approval and Operations Plane
Resilience and Recovery Plane
Adaptive Growth Plane
```

The Effective Runtime Manifest composes evidence from applicable planes while preserving separate ownership, policy, lifecycle, and rollback.

## 23. Revised Design Freeze gate

Do not freeze the production Context Compiler or Effective Runtime Manifest contracts until these decisions are resolved:

1. Principal/group/service identity authority.
2. Tenant federation and offboarding lifecycle.
3. Data purpose, retention, residency, export, and erasure policy.
4. Entitlement/cost reservation and runtime settlement contract.
5. Context-aware model selection and evaluation contract.
6. Universal async/idempotency/cancellation/compensation contract.
7. Artifact and knowledge provenance schema.
8. Unified temporal/environment/region semantics.
9. Plugin supply-chain trust requirements.
10. Initial quality suites and cutover thresholds.

The implementation remains incremental. The boundaries must be frozen before the manifest schema becomes a production contract.