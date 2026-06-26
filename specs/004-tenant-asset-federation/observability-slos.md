# Observability, SLOs, and Operational Intelligence

## 1. Observability goals

The platform must answer, without reading secrets:

- Which shared assets are visible, authorized, configured, and ready?
- Which context paths, profiles, policies, variants, and preferences produced a decision?
- Why did a request block or select a given asset?
- Are contextual decisions consistent with legacy authorities during migration?
- Are recommendations calibrated and producing verified outcomes?
- Did a rollout or experiment improve value without degrading safety, cost, or latency?
- Which task/capability contract, hard gates, evaluation, readiness, optimization, commercial evidence, and fallback set produced a model selection?
- Are selected and fallback candidates current, independently eligible, commercially reserved, and safe for the exact context?
- Is contextual model selection consistent with current provider-order/free-first routing during migration, and where is it intentionally more restrictive?
- Can every consequential execution be reconstructed from immutable evidence?

Observability is part of runtime correctness, not a dashboard-only concern.

## 2. Correlation model

Every request and derived operation should carry:

```text
request_id
correlation_id
session_id
conversation_id when applicable
tenant_id
principal_id hash or governed ID
workspace/brand/activity/workflow context IDs
container_resolution_id
effective_runtime_manifest_id
model_selection_decision_id when applicable
model_evaluation_run_id / scorecard_id when applicable
model_readiness_snapshot_id when applicable
model_fallback_set_id when applicable
runtime_cost_estimate_id / reservation_id when applicable
execution_id
approval_hold_id when applicable
adaptive_proposal_id / experiment_id when applicable
```

Public responses return only safe identifiers. Logs and metrics must not include credential payloads, tokens, hidden prompts, or unnecessary personal content.

## 3. Structured event families

### Catalog

```text
shared_asset_catalog_queried
shared_asset_opened
shared_asset_readiness_viewed
shared_asset_not_visible
shared_asset_not_entitled
```

### Context and composition

```text
context_resolution_started
context_resolution_completed
context_resolution_blocked
composition_profile_selected
composition_profile_conflict
policy_atom_invalid
policy_field_resolved
```

### Variants and preferences

```text
user_preference_changed
user_preference_reset
asset_variant_created
asset_variant_published
asset_variant_conflict
asset_variant_reset
```

### Readiness and execution

```text
connection_binding_resolved
connection_binding_ambiguous
installation_not_ready
certification_required
approval_required
manifest_created
manifest_stale
execution_dispatched
execution_completed
execution_failed
readback_verified
```

### Contextual model governance

```text
model_task_class_resolved
model_capability_contract_resolved
model_candidate_discovered
model_candidate_excluded
model_candidate_ranked
model_selection_previewed
model_selection_allowed
model_selection_blocked
model_selection_decision_created
model_preference_changed
model_evaluation_started
model_evaluation_completed
model_scorecard_published
model_scorecard_stale
model_drift_detected
model_readiness_observed
model_readiness_degraded
model_fallback_selected
model_fallback_blocked
model_version_restricted
model_version_revoked
model_deprecation_started
model_deprecation_completed
model_governance_epoch_advanced
```

### Contextual model governance

```text
model_task_class_resolved
model_capability_contract_resolved
model_candidate_discovered
model_candidate_excluded
model_candidate_ranked
model_selection_previewed
model_selection_allowed
model_selection_blocked
model_selection_decision_created
model_preference_changed
model_evaluation_started
model_evaluation_completed
model_scorecard_published
model_scorecard_stale
model_drift_detected
model_readiness_observed
model_readiness_degraded
model_fallback_selected
model_fallback_blocked
model_version_restricted
model_version_revoked
model_deprecation_started
model_deprecation_completed
model_governance_epoch_advanced
```

### Adaptive growth

```text
adaptive_proposal_created
adaptive_proposal_simulated
adaptive_proposal_accepted
adaptive_proposal_dismissed
adaptive_experiment_started
adaptive_experiment_metric_observed
adaptive_experiment_rolled_back
adaptive_change_promoted
platform_promotion_candidate_created
```

## 4. Core metrics

### Coverage

- shared catalog source mappings by asset family;
- tenant-visible shared assets;
- projected versus missing containers;
- relationship and closure coverage;
- roles/grants/policies bridged;
- composition profile coverage;
- policy fields with registered semantics;
- assets with modifiable-path profiles;
- executions linked to effective manifests.

### Resolution quality

- context resolution allow/deny/block rate;
- path count and visited-container distributions;
- missing required layers;
- policy conflicts;
- variant conflicts;
- ambiguous connection resolution;
- stale epoch/version retries;
- deterministic checksum mismatch count.

### Readiness

- visible → authorized conversion;
- authorized → configured conversion;
- configured → ready conversion;
- connection-required count;
- operational pending installations;
- expired certifications;
- actual pending approvals;
- quota/budget blocks;
- provider/runtime outages.

### Contextual model governance

- registered task/capability coverage by task and risk family;
- candidate discovery count and eligible/excluded ratio;
- exclusion count by lifecycle, capability, data, region, risk, tool, output, evaluation, readiness, entitlement, and commercial gate;
- selected candidate distribution by provider endpoint, exact model version, inference profile, region, task, risk, Tenant cohort, and optimization profile;
- evaluation coverage, freshness, sample/confidence sufficiency, zero-tolerance failures, and stale/drifting scorecards;
- readiness current/degraded/not-ready/unknown/stale distribution and observation lag;
- deterministic tie frequency and unresolved ambiguity count;
- fallback-set coverage, activation rate, block/exhaustion rate, downgrade-attempt count, and candidate-specific reservation coverage;
- provider-order/free-first versus contextual-selection parity and mismatch classification;
- selection-decision and manifest reconstruction coverage;
- alias movement, incident restriction, revocation propagation, deprecation progress, and epoch invalidation lag;
- selected versus realized quality, latency, reliability, customer charge, and provider-cost calibration;
- model preference adoption, reset, opt-out, and blocked escalation attempts.

### Personalization

- preference profile adoption;
- composition profile selection and reset;
- variant creation/publish/reset;
- preview-to-apply conversion;
- conflicts per base upgrade;
- adaptation opt-in/opt-out;
- user-reported relevance and trust.

### Adaptive growth

- proposal volume by class;
- accepted/dismissed/expired rate;
- simulation pass/block rate;
- canary promotion/rollback rate;
- predicted versus realized impact;
- calibration error;
- recommendation diversity;
- result-observed coverage;
- platform promotion candidate throughput.

### Safety

- cross-tenant denial attempts;
- secret-like field rejections;
- mandatory-policy bypass attempts;
- approval replay/scope mismatch;
- stale-manifest dispatch attempts;
- provider call before authority violations;
- privacy/promotion review blocks;
- critical shadow mismatches.

## 5. Proposed SLOs

Initial targets are design proposals and require benchmark validation.

### Catalog SLO

- availability: 99.9% monthly for tenant catalog reads;
- p95 latency: ≤ 300 ms for indexed list/get without live provider probes;
- freshness: source projection lag ≤ 5 minutes for non-security metadata;
- security-critical status invalidation: ≤ 60 seconds.

### Context preview SLO

- successful bounded preview availability: 99.9%;
- p95 latency: ≤ 150 ms under initial graph limits;
- p99 latency: ≤ 400 ms;
- deterministic replay mismatch: 0;
- audit/manifest coverage: 100% for dispatchable decisions.

These align with the current Dynamic Container rollout registry budgets but must be measured against seeded production-like data.

### Model selection preview SLO

Initial design targets, subject to benchmark validation:

- preview availability: 99.9% monthly;
- p95 latency: ≤ 250 ms for cached current evaluation/readiness evidence and bounded candidate sets;
- p99 latency: ≤ 750 ms;
- exact task/capability contract resolution: 100%;
- mandatory-gate evidence coverage for eligible candidates: 100%;
- selected/fallback candidates with current evaluation, readiness, lifecycle, and commercial evidence: 100%;
- candidate exclusions with stable reason code and source/version evidence: 100%;
- deterministic replay mismatch for identical version vectors: 0;
- provider/model calls, credential reads, evaluation executions, reservations, lifecycle mutations, or external writes during preview: 0.

### Model revocation and invalidation SLO

- emergency restriction/revocation publication to new selection decisions: immediate after committed authority readback;
- affected manifest/cache invalidation target: ≤ 30 seconds;
- queued pre-dispatch revalidation coverage: 100%;
- dispatch using a revoked exact model version after effective revocation: 0;
- fallback-set removal/invalidation for revoked candidates: 100%;
- historical decision/run reconstruction after revocation or retirement: 100%.

### Mutation SLO

For profile, preference, variant, and connection-binding mutations:

- idempotent retry correctness: 100%;
- same-cycle readback evidence: 100%;
- version conflict detection: 100%;
- stale-authority write acceptance: 0;
- p95 internal mutation latency excluding external OAuth/provider work: ≤ 750 ms.

### Invalidation SLO

- role/grant/policy/connection revocation propagated to effective authority: ≤ 30 seconds target;
- critical revocation should use event-driven invalidation immediately;
- stale cache grants: 0;
- stale preview may be displayed only as expired/unavailable, never dispatchable.

### Adaptive proposal SLO

- proposals include evidence/confidence/expiry/rollback fields: 100%;
- Class C/D simulation coverage before canary: 100%;
- Class E self-approval: 0;
- safety-triggered canary rollback initiation: ≤ 60 seconds after verified trigger;
- recommendation result-observed coverage target: ≥ 70% for executed recommendations before model/default promotion.

## 6. Error budgets

Error budgets are tracked per surface and risk class.

### Availability budget

Standard read surfaces may consume normal availability budget. Authority and safety failures do not become acceptable because an availability budget remains.

### Zero-tolerance conditions

No budget applies to:

- cross-tenant data exposure;
- secret exposure;
- mandatory policy bypass;
- unapproved consequential write;
- stale revoked authority dispatch;
- unreconstructable critical execution;
- destructive experiment outside exact cohort.

One verified occurrence triggers containment and rollout rollback.

## 7. Tracing spans

Suggested spans:

```text
request.authenticate
context.resolve_subjects
context.traverse_graph
authority.resolve_roles_bindings
catalog.resolve_candidates
composition.select_profiles
policy.load_atoms
policy.apply_algebra
variant.resolve_apply
preference.rank
readiness.resolve_connection
readiness.resolve_installation_certification
readiness.resolve_approval_quota
manifest.persist_readback
execution.dispatch
execution.verify_readback
model.resolve_task_class
model.resolve_capability_contract
model.discover_candidates
model.apply_hard_gates
model.load_evaluation_scorecard
model.load_readiness_snapshot
model.rank_eligible_candidates
model.build_fallback_set
model.estimate_candidate_cost
model.reserve_selected_candidate
model.persist_selection_decision
model.revalidate_pre_dispatch
model.invoke_provider_adapter
model.observe_outcome
model.detect_drift
model.invalidate_governance_epoch
adaptive.attribute_outcome
adaptive.score_candidate
adaptive.simulate
```

Span attributes use IDs, counts, versions, reason codes, and timing—not raw content or secrets.

## 8. Operational dashboards

### Shared Asset Health

- catalog coverage by family;
- visibility/entitlement/readiness funnel;
- unmapped canonical records;
- stale or revoked assets;
- optional variant conflicts.

### Context Authority Health

- projected container coverage;
- graph integrity;
- path-limit usage;
- role/binding coverage;
- authority epochs and invalidation lag;
- legacy/contextual parity.

### Personalization Trust

- active preference profiles;
- user resets and opt-outs;
- accepted versus dismissed proposals;
- recommendation cadence complaints;
- explanation views;
- calibration and rollback.

### Integration Readiness

- connections by state;
- installations and certifications;
- operational pending classification;
- ambiguous bindings;
- provider health;
- approval and quota blockers.

### Contextual Model Governance

- task/capability registration and contextual coverage;
- eligible/excluded candidate funnel and gate reasons;
- selected provider endpoint/model-version/inference-profile distribution;
- evaluation-suite and scorecard current/stale/drifting/failed coverage;
- readiness current/degraded/not-ready/unknown/stale coverage and lag;
- optimization-profile use, tie/ambiguity, and user-preference effects;
- fallback coverage, activation, block/exhaustion, certified equivalence, and reservation status;
- provider-order/free-first shadow parity and critical mismatches;
- alias movement, incidents, restrictions, revocations, deprecation, and invalidation lag;
- selected versus realized quality, latency, reliability, customer charge, and provider cost.

### Adaptive Growth

- opportunities by objective;
- proposal lifecycle;
- experiments and guardrails;
- realized business impact;
- promotion candidates;
- unresolved adaptation debt.

## 9. Alerting

### Critical

- cross-tenant access success;
- secret detected in prohibited surface;
- mandatory policy bypass;
- provider write without valid manifest/approval;
- stale revoked authority dispatch;
- experiment cohort breach;
- provider dispatch using a revoked exact model version;
- selected or fallback candidate bypassed a mandatory data, region, safety, evaluation, readiness, lifecycle, or commercial gate;
- raw provider endpoint/adapter/code/secret injection accepted;
- model-selection preview caused a provider call, credential read, reservation, lifecycle mutation, or external write.

### High

- critical legacy/contextual mismatch;
- readback missing for consequential operation;
- invalidation lag exceeds critical threshold;
- p99 resolver latency sustained above budget;
- widespread connection/certification failure;
- calibration degradation causing harmful recommendations;
- model evaluation or readiness freshness below task/risk policy;
- provider-order/free-first shadow comparison produces a contextual-more-permissive or critical mismatch;
- fallback activation, block, or exhaustion exceeds baseline;
- emergency revocation propagation or model-governance epoch invalidation exceeds SLO;
- repeated selection ambiguity, alias movement, scorecard drift, or candidate-specific reservation failure.

### Medium

- rising variant conflicts;
- ambiguous profile/connection resolution;
- catalog projection lag;
- low result-observed coverage;
- repeated user dismissal/opt-out;
- adaptation proposal backlog.

Alerts include tenant-safe context, runbook link, recent deployment/config change, and rollback action.

## 10. Data quality

Every metric/event specifies:

- authority/source table or service;
- event schema version;
- observed and occurred timestamps;
- tenant/user/context scope;
- deduplication key;
- completeness and freshness;
- verification status;
- retention class.

Dashboards distinguish zero, unknown, unavailable, stale, and not applicable.

## 11. Sampling and retention

- authority decisions and consequential executions are not sampled out;
- high-volume field-level traces may be sampled only after the immutable manifest preserves the decision;
- security and approval evidence follow required retention;
- user preference history follows privacy/retention policy;
- adaptive raw events may be aggregated and minimized after attribution windows;
- no retention policy deletes evidence required to reconstruct an active approval, variant, or experiment.

## 12. Runbook requirements

Runbooks must cover:

- resolver latency/path explosion;
- authority epoch invalidation failure;
- legacy/contextual parity regression;
- catalog projection failure;
- variant/base conflict surge;
- credential/installation outage;
- secret-like payload detection;
- adaptive experiment rollback;
- platform promotion containment;
- feature-family cutover rollback;
- task/capability misclassification or candidate-empty incidents;
- evaluation poisoning, stale scorecard, or drift containment;
- readiness spoofing, provider outage, circuit-breaker, and fallback exhaustion;
- emergency model restriction/revocation and queued-work invalidation;
- alias movement and unevaluated version substitution;
- model-selection shadow mismatch and compatibility-router rollback;
- deprecation replacement, exception, and rollback;
- repository branch reconciliation.

## 13. Release observability gates

Before each rollout stage:

- dashboards and alerts exist for new failure modes;
- baseline metrics are captured;
- SLO query definitions are versioned;
- audit coverage is measured;
- no-secret assertions are active;
- rollback signal and operator are identified;
- deployment and registry SHAs/versions are visible;
- post-release behavioral readback confirms expected traffic and decisions.
