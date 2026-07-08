# DFR-005 — Contextual Model Governance

## Dev Orchestrator model-governance overlay

The Dev Orchestrator design adds a future OpenRouter runtime lane and a separate OpenRouter Management API readiness lane. Runtime model calls, key-management actions, catalog/limit inspection, and budget/key lifecycle controls must remain distinct. Free-first routing cannot bypass model allowlists, data-use policy, output/tool contract, readiness evidence, or commercial reservation. Paid fallback requires explicit budget-owner approval and readback. Optional `openai-agents-js` use must remain a thin orchestration layer governed by platform registry, policy, tracing, session, and tool boundaries.

## Status

**Approved design. Implementation is not authorized.**

The platform adopts **Capability-First, Policy-Gated, Evidence-Ranked Model Governance**.

Model and provider selection begins with a registered task and capability contract, applies deterministic eligibility gates, ranks only eligible candidates through a registered optimization profile, reserves the selected candidate's authorized commercial cost, binds the exact decision and fallback set into the Effective Runtime Manifest, and revalidates all contributing evidence before any provider call.

No runtime routing change, model/provider call, credential mutation, database migration, deployment, evaluation execution, commercial reservation, or production enforcement is authorized by this document.

## 1. Authoritative selection sequence

```text
Task classification
→ capability contract resolution
→ contextual policy and data-use resolution
→ candidate discovery
→ deterministic eligibility gates
→ evaluation/readiness floors
→ evidence-ranked optimization
→ provisional cost comparison
→ selected candidate and approved fallback set
→ final estimate and reservation
→ immutable model-selection decision
→ Effective Runtime Manifest binding
→ pre-dispatch revalidation
→ provider call or fail-closed block
```

A model score never overrides a deterministic gate. Missing, stale, conflicting, revoked, insufficient, or ambiguous mandatory evidence fails closed.

## 2. Current-state compatibility

Existing authorities remain migration inputs and compatibility surfaces:

```text
ai_model_providers
ai_model_registry
agent_model_runs
platform_runtime_config.agent_model_runtime
intelligence_engines
intelligence_policies
skill_manifests
agent_tool_index
provider adapters in backend code
```

Current `provider_order`, `free_first`, execution classes, task profiles, and configured model IDs remain compatibility bootstrap behavior until shadow parity and certified cutover. They are not the final production authority for contextual selection.

Provider adapters remain allowlisted backend implementations. Database rows may select a registered adapter key and bounded behavior but cannot introduce arbitrary URLs, headers, executable code, SQL, JavaScript, shell, or secret values.

## 3. Candidate identity

A candidate is the exact tuple:

```text
provider_key
provider_endpoint_profile_id
model_key
model_version_id
inference_profile_key/version
region_key
data-processing profile/version
commercial price profile/version
```

Consequential operations pin an exact immutable model version or a recorded alias-resolution snapshot. A mutable alias such as `latest` cannot be the sole identity evidence. Alias movement advances the model-governance epoch and invalidates stale decisions when compatibility or evaluation evidence changes.

## 4. Task and capability contracts

Initial registered task families may include:

```text
classification
summarization
translation
structured_extraction
content_generation
code_generation
planning
tool_orchestration
vision_analysis
image_generation
image_edit
audio_transcription
speech_generation
video_analysis
authority_sensitive_decision
```

The active catalog is database-authoritative. Runtime rejects unregistered task classes rather than silently mapping them to a generic model.

Each operation resolves a versioned capability contract containing applicable fields such as:

```text
input/output modalities
languages/locales
minimum context window
maximum output size
structured-output schema/profile
tool-use and parallel-tool requirements
streaming requirement
vision/audio/video requirements
reasoning class
grounding/retrieval requirement
determinism behavior
safety/risk class
deadline and latency target
minimum quality and reliability floors
```

The capability contract is separate from a provider/model implementation. Every candidate must satisfy the same mandatory contract.

## 5. Deterministic eligibility gates

A candidate is excluded before ranking when it fails any applicable gate:

```text
model/provider lifecycle
capability and task compatibility
Tenant/plan entitlement
scope and principal authority
data-use and processing-purpose policy
provider retention/training/deletion policy
region, residency, transfer, and jurisdiction
risk and safety policy
tool-use policy
structured-output contract
context/output limits
provider endpoint and credential readiness
evaluation certification and freshness
incident/revocation restrictions
deprecation policy
commercial eligibility, estimate, and reservation feasibility
```

Hard gates use deterministic registered semantics. Optimization weights, user preference, low cost, low latency, popularity, or provider order cannot compensate for a failed gate.

## 6. Evidence-ranked optimization

Only eligible candidates are ranked.

Initial registered optimization profiles may include:

```text
quality_first
balanced
cost_first
latency_first
privacy_first
local_only
reliability_first
```

A profile declares metric keys and weights, normalization/version, floors, bounds, missing-evidence behavior, freshness requirements, tie-break policy, confidence treatment, and risk-class applicability.

Candidate ranking may consider quality, safety, reliability, latency, customer charge, provider/internal cost, data privacy, locality, structured-output validity, tool-selection success, tool-argument validity, availability, and timeout/error rates.

A single opaque composite score is insufficient. The decision stores every metric, source, version, freshness, confidence, normalized value, weight, gate result, and tie-break evidence.

Equal-ranked incompatible candidates block with `MODEL_SELECTION_AMBIGUOUS` unless a registered deterministic tie-breaker resolves them.

## 7. User and Tenant customization

Users or delegated administrators may customize only fields exposed by an approved model-selection profile and within Platform, data, safety, quality, commercial, and contract bounds.

When permitted, selectable preferences may include:

```text
optimization profile
preferred eligible provider/model
local-only or privacy-first behavior
maximum customer cost below the authorized ceiling
maximum latency below the authorized ceiling
fallback disabled
pin an eligible model/version for a low-risk task
presentation and explanation preferences
```

A user cannot add a raw unregistered model ID or endpoint; lower quality, safety, evaluation, data, residency, tool, or output floors; enable prohibited provider training/retention; select revoked, deprecated, unready, uncertified, or commercially ineligible candidates; bypass commercial reservation; change credentials; or create arbitrary formulas.

The most restrictive applicable rule wins. Preference narrows or ranks eligible candidates and never creates eligibility.

## 8. Evaluation suites

Every model version requires contextual evaluation evidence keyed by applicable capability, task, language/locale, modality, activity/domain, risk class, tool policy, output contract, data policy, and region.

A suite version declares versioned dataset references, rubric, deterministic validators, human-evaluation policy, model-judge policy, safety/adversarial cases, regressions, sample size, metric definitions, thresholds, zero-tolerance failures, confidence requirements, and freshness window.

A model judge cannot be the only authority for high-risk or authority-sensitive tasks. Evaluation datasets and results are immutable, provenance-linked, access-controlled, and data-governance constrained.

Representative metrics include task accuracy, groundedness, hallucination rate, structured-output validity, tool-selection/argument accuracy, instruction following, safety violations, locale quality, latency, availability, timeout/provider-error rates, customer charge, and provider cost.

## 9. Quality scorecards and drift

Each exact candidate has a scorecard containing evaluation suite versions, sample count and corpus scope, metric values/confidence intervals, failure classes, latency percentiles, reliability, timeout/error observations, cost observations, observed regions/endpoints, validity window, drift state, and checksum.

Scorecard states include:

```text
current
stale
drifting
insufficient_evidence
failed
revoked
```

Stale or drifting evidence blocks high-risk and authority-sensitive use by default. Production outcomes may trigger drift and re-evaluation but cannot silently rewrite evaluation results or selection policy.

## 10. Provider readiness

Quality and readiness are independent. A readiness snapshot may include credential readiness without values, endpoint region/deployment, contract/certification, quota/capacity, rate limits, circuit breaker, recent success/error/timeout rates, latency, streaming/tool/output availability, incident state, observation time, and expiry.

Readiness states are `ready`, `degraded`, `not_ready`, `unknown`, and `stale`. Stale evidence follows explicit task policy and is never silently treated as ready.

## 11. Commercial integration

Model selection and DFR-004 remain separate decisions:

```text
eligible candidates
→ provisional cost estimates
→ contextual ranking
→ selected candidate
→ final cost estimate
→ atomic reservation
```

Cost-first optimization still obeys every quality, safety, data, capability, readiness, and evaluation floor.

If reservation fails, runtime may consider only candidates already included in the approved fallback set. Each fallback needs a new candidate-specific estimate and reservation. A reservation for one candidate cannot silently finance another.

## 12. Governed fallback

Fallback is an immutable ordered set of independently eligible candidates, not the next provider in a global list.

Each fallback must independently satisfy the same mandatory capability, data/residency, tool/output, evaluation, readiness, lifecycle, entitlement, and commercial requirements.

For `authority_sensitive_decision` and other high-risk tasks, fallback is disabled by default unless the alternative is certified equivalent for the same capability, output contract, tool policy, risk class, evaluation suite, data policy, and commercial authorization.

After output, streamed content, or tool calls begin, switching models is not assumed safe. Restart, resume, partial-success, compensation, and duplicate-effect behavior are governed by DFR-006.

## 13. Lifecycle, incidents, deprecation, and revocation

```text
discovered → registered → evaluating → certified → active
→ restricted → deprecated → blocked → retired
```

Emergency transition:

```text
any eligible state → revoked
```

Deprecation requires impact preview, replacement candidates, affected assets, deadline, shadow/canary evidence, rollback or exception policy, new-use cutoff, and historical evidence retention.

Security, privacy, provider-contract, evaluation, or safety incidents may restrict or revoke immediately. Restriction/revocation advances the model-governance epoch and invalidates affected decisions/manifests.

## 14. Proposed database authorities

```text
model_task_class_registry
model_capability_registry
model_capability_profiles
model_capability_profile_requirements
model_provider_endpoint_profiles
model_versions
model_alias_resolution_snapshots
model_inference_profile_registry
model_context_policy_registry
model_context_policy_rules
model_optimization_profile_registry
model_optimization_profile_metrics
principal_model_preferences
model_compatibility_certifications
model_evaluation_suite_registry
model_evaluation_suite_versions
model_evaluation_dataset_refs
model_evaluation_metric_registry
model_evaluation_thresholds
model_evaluation_runs
model_evaluation_results
model_quality_scorecards
model_readiness_snapshots
model_selection_decisions
model_selection_candidate_evidence
model_fallback_sets
model_fallback_candidates
model_drift_events
model_incident_restrictions
model_deprecation_runs
model_governance_epochs
```

Existing model/provider registries, runs, runtime configuration, and provider adapters remain compatibility authorities or implementations until certified cutover. Registries define typed semantics and bounded policy, not unrestricted EAV or executable code.

## 15. Model-selection decision and manifest

The immutable decision records Tenant/principal/context/operation, task/capability versions, candidate-universe snapshot, hard-gate results, policy sources, evaluation/readiness evidence, optimization profile, selected exact candidate, fallback set, estimate/reservation, model-governance epoch, expiry, explanation, and checksum.

The Effective Runtime Manifest binds the decision, exact model version or alias snapshot, endpoint/inference profile, policy versions, data-use decision, region, evaluations/scorecard, readiness, optimization profile, exclusions, fallback, commercial estimate/reservation, epoch, and expiry.

Before provider dispatch, runtime revalidates lifecycle, evaluation freshness, readiness, data-use, region, entitlement, reservation, fallback eligibility, expiry, and epoch. Neither the decision nor manifest grants credentials or performs a provider call.

## 16. API direction

Tenant/resource surfaces:

```text
GET  /tenant/model-task-classes
GET  /tenant/model-capabilities
GET  /tenant/model-candidates
POST /tenant/model-selection-decisions/preview
GET  /tenant/model-selection-decisions/{decisionId}
GET  /tenant/model-selection-decisions/{decisionId}/explanation
GET  /tenant/model-selection-profiles
GET  /tenant/users/me/model-preferences
PATCH /tenant/users/me/model-preferences
```

Admin/governance surfaces:

```text
GET  /admin/model-providers
GET  /admin/model-provider-endpoints
GET  /admin/model-versions
GET  /admin/model-capability-profiles
GET  /admin/model-context-policies
GET  /admin/model-optimization-profiles
GET  /admin/model-evaluation-suites
POST /admin/model-evaluation-runs
GET  /admin/model-evaluation-runs/{runId}
GET  /admin/model-quality-scorecards
GET  /admin/model-readiness
POST /admin/model-deprecation-runs/preview
POST /admin/model-deprecation-runs
POST /admin/model-incident-restrictions
```

Preview performs no provider/model call, credential read, commercial reservation, evaluation execution, external write, or lifecycle mutation.

## 17. Stable blocking conditions

```text
MODEL_TASK_CLASS_NOT_REGISTERED
MODEL_CAPABILITY_PROFILE_MISSING
MODEL_CAPABILITY_CONTRACT_INVALID
MODEL_CANDIDATE_NONE
MODEL_CAPABILITY_MISMATCH
MODEL_DATA_POLICY_INCOMPATIBLE
MODEL_REGION_INELIGIBLE
MODEL_ENTITLEMENT_DENIED
MODEL_TOOL_POLICY_INCOMPATIBLE
MODEL_OUTPUT_CONTRACT_UNSUPPORTED
MODEL_CONTEXT_LIMIT_EXCEEDED
MODEL_EVALUATION_MISSING
MODEL_EVALUATION_STALE
MODEL_EVALUATION_BELOW_THRESHOLD
MODEL_PROVIDER_NOT_READY
MODEL_READINESS_STALE
MODEL_DEPRECATED
MODEL_RESTRICTED
MODEL_REVOKED
MODEL_SELECTION_AMBIGUOUS
MODEL_SELECTION_VERSION_CHANGED
MODEL_FALLBACK_NOT_ALLOWED
MODEL_FALLBACK_EXHAUSTED
MODEL_COST_ESTIMATE_REQUIRED
MODEL_COST_RESERVATION_REQUIRED
MODEL_GOVERNANCE_EPOCH_CHANGED
```

## 18. Hard invariants

- Selection begins with a registered task/capability contract, never a raw model name.
- Candidate identity pins endpoint, exact model version, inference profile, region, data-processing profile, and commercial profile.
- Hard gates execute before optimization and cannot be overridden by score, preference, provider order, cost, or latency.
- Only independently eligible candidates enter ranked or fallback sets.
- User preference narrows or ranks and never creates eligibility.
- Evaluation evidence is versioned, contextual, confidence/freshness bounded, and provenance-linked.
- Readiness is separate from quality.
- Customer charge and provider/internal cost remain separate.
- Each selected or fallback candidate needs candidate-specific estimate/reservation.
- Fallback cannot weaken any mandatory requirement.
- Provider adapters are allowlisted code implementations; registries cannot execute arbitrary code or store secrets.
- Incidents, restrictions, revocations, deprecations, policy changes, and material alias movement advance the model-governance epoch.
- Decisions/manifests are immutable, explainable, no-secret, expiring, and revalidated.
- Missing, stale, conflicting, revoked, insufficient, or ambiguous mandatory evidence fails closed.

## 19. Acceptance examples

- A cheaper candidate below the groundedness floor is excluded before cost-first ranking.
- `privacy_first` reorders only eligible candidates and cannot weaken residency or training policy.
- A raw unregistered model ID is rejected without changing preference state.
- A provider-ready model with stale evaluation blocks for an authority-sensitive task.
- A high-quality candidate outside the permitted region is excluded before ranking.
- Reservation failure permits only an approved fallback with a new estimate/reservation.
- Global provider order lists a provider first, but contextual policy excludes it.
- Equal candidates with no tie-breaker produce `MODEL_SELECTION_AMBIGUOUS`.
- Provider outage before dispatch triggers readiness revalidation and only approved fallback or block.
- Emergency revocation invalidates affected manifests while preserving historical evidence.
- Alias movement triggers compatibility/evaluation and epoch review.
- Preview returns candidates, exclusions, evidence, weights, fallback, and estimated cost without provider call, credential read, or reservation.

## 20. Migration and cutover

```text
inventory current settings
→ normalize providers/endpoints/model versions/task classes
→ register capability and policy authorities
→ import evaluation/readiness evidence
→ shadow contextual selection against current routing
→ compare eligibility, candidate, fallback, cost, latency, and outcomes
→ certify task/risk families independently
→ cut over by family with rollback
```

`platform_runtime_config.agent_model_runtime`, hardcoded supported-provider/task lists, and global provider order remain compatibility inputs until family-specific parity and cutover. Zero-tolerance failures include data/region violations, revoked dispatch, unapproved fallback, missing commercial reservation, credential exposure, cross-Tenant evidence leakage, and unreconstructable selection.

## 21. Final decision

> **Capability-First, Policy-Gated, Evidence-Ranked Model Governance.** The platform selects providers and exact model versions from a registered task and capability contract, applies deterministic authority, data, region, risk, tool, output, evaluation, readiness, entitlement, lifecycle, and commercial gates, then ranks only eligible candidates through an explainable registered optimization profile. The immutable model-selection decision binds the selected candidate, independently eligible fallback set, evidence, versions, estimate/reservation, governance epoch, and expiry into the Effective Runtime Manifest. Fallback may never weaken a hard gate, and missing, stale, conflicting, revoked, insufficient, or ambiguous mandatory evidence fails closed.
