# Migration and Cutover Map

## 1. Objective

Introduce the shared asset fabric and contextual policy composition without replacing working authorities prematurely, duplicating assets per tenant, or creating a one-time big-bang migration.

The migration is projection-first, bridge-first, shadow-first, and family-by-family.

## 2. Current-to-target mapping

| Current surface | Current role | Target role | Migration action |
|---|---|---|---|
| `agents`, `agent_skills`, `workflows`, `actions`, `plugins`, apps, logic/engine/knowledge registries | shared definitions | canonical shared asset sources | preserve; register catalog pointers |
| `execution_policies` | active runtime enforcement | legacy policy bridge until cutover | preserve; normalize read-only policy atoms |
| platform policy registry/rules | target/evidence policy definitions | typed policy source and eventual authority by family | map fields/operators; shadow compare |
| `role_assignments` | tenant user role | legacy role bridge | project to container assignments where scope known |
| `agent_skill_grants` | skill authority | specialized bridge | project/read parity; no immediate replacement |
| `agent_workflow_bindings` | workflow bindings | specialized bridge | add contextual projection/read parity |
| `app_action_grants` | action/connection grant | specialized bridge | preserve exact action/connection checks |
| `workspace_resource_grants` | workspace resource access | specialized bridge | map resource types to dimensions |
| workspace/brand/activity/workflow tables | canonical subjects | container subject projection | idempotent project + relationship validation |
| `connections`, user connections | connection identity/eligibility | runtime readiness source | preserve; add contextual binding selection |
| `installations` | operational validation | runtime readiness source | preserve; clean classifications only after validation |
| package variant tables | package customization | reusable variant concepts | preserve; add generic non-package variant layer |
| preference tables | fragmented UX preferences | bridge to unified user runtime profile | read/merge then migrate selectively |
| recommendation/intent/execution telemetry | signals/outcomes | adaptive evidence | preserve; add manifest attribution |
| `ai_model_providers`, `ai_model_registry`, `agent_model_runs` | current provider/model/run authorities | compatibility sources plus exact provider/model-version projections | preserve; normalize provider endpoints, model versions, lifecycle, and historical evidence |
| `platform_runtime_config.agent_model_runtime`, task profiles, `provider_order`, `free_first` | current routing/bootstrap behavior | compatibility router during DFR-005 shadow and family cutover | preserve; shadow contextual decisions; retire only after certified parity and rollback readiness |
| allowlisted provider adapters | provider transport implementations | infrastructure adapters selected by governed model decisions | preserve in code; register adapter keys only; prohibit arbitrary endpoint/code/secret injection |
| job repository, job queue, async runner, attempts/status fields | current asynchronous delivery/retry behavior | compatibility Activity/attempt/queue projections | preserve; classify operation/effect families, idempotency, retry stage, deadlines, and terminal outcomes; shadow before cutover |
| `execution_plans`, `execution_plan_steps`, `execution_plan_events` | sequential orchestration, claim token, approval and step history | compatibility Workflow/Activity/history projections | preserve; map deterministic step/event semantics, claims to leases/fencing, and unresolved effects explicitly |
| workflow runs and step runs | workflow execution evidence | compatibility Workflow/Activity/Effect run projections | preserve history; bind exact manifest, attempts, effects, verification, and outcome dimensions where evidence exists |
| approval holds and scheduled/deferred work | waits and gates | durable signals/timers/dependencies/approval events | preserve; map exact expiry, consumption, idempotency, and authority; do not infer approval from status labels |
| email/notification/webhook and other surface Outboxes | surface-specific event delivery | compatibility sources before shared transactional Outbox/Inbox adoption | preserve; register transport event identity/schema, deduplication, delivery attempts, dead-letter, and redrive semantics |
| execution logs and provider references | audit/result evidence | Workflow history/Effect verification and reconciliation inputs | preserve append-only evidence; import only deterministic, no-secret, provenance-valid links; unknown outcomes remain explicit |
| `output_artifacts` and output sink routes | generated text/JSON/file result storage and retrieval | compatibility Artifact identity/version/content/representation source | preserve; derive stable logical identity only where deterministic, capture canonical/stored checksums, producer/run/manifest, Tenant scope, and mark missing provenance/policy/trust explicitly |
| `json_assets` and `json_asset_subject_links` | JSON asset payloads and subject-scope links | compatibility Artifact/Version and ownership/context projections | preserve; map exact payload checksum/schema/source/subject authority, reject ownership promotion, and keep unknown source/license/verification as debt |
| `memory_scope_links` and memory state | dynamic subject/context attachments and memory references | compatibility provenance/context and derived-memory dependency source | preserve scope/ownership and source references; never infer content provenance, license, trust, or publication from a scope link |
| `platform_graph_nodes`, `platform_graph_edges`, and graph evidence | general graph/knowledge relationships and validation | compatibility provenance/claim/relation candidates | preserve typed validated evidence only; distinguish semantic graph relations from exact-version provenance and prohibit silent conversion of weak/free-form edges |
| `session_drive_artifacts`, Drive references, and session summaries | external file references, hashes, session outputs, and writeback evidence | compatibility Source/Representation/Artifact Version evidence | preserve Drive/file identity and available SHA-256/size/producer/session evidence; capture immutable snapshot/version only when proven; mutable current files remain non-versioned evidence |
| current documents, prompts, reports, datasets, evaluation samples, and knowledge registries | heterogeneous knowledge inputs/outputs | compatibility Knowledge Source/Artifact family inputs | inventory by type/risk/audience/license/freshness; register exact source/version/checksum only where evidence exists and do not generate trust or publication state from presence |
| current vector/search/embedding or retrieval surfaces where present | mutable derived retrieval state | compatibility Chunk/Embedding/Index/ Retrieval Evidence inputs | preserve provider/index references; exact source/chunk/model/profile/membership evidence is required before target activation; unknown builds remain non-authoritative migration debt |

## 3. Migration lanes

### Lane A — Shared catalog

1. Register source adapters by asset family.
2. Generate stable `asset_ref` and base checksum.
3. Validate one-to-one pointer uniqueness.
4. Expose admin diagnostics.
5. Expose tenant read-only catalog.

No tenant asset copies or source-row rewrites.

### Lane B — Context graph

1. Create deterministic container IDs from canonical subject references.
2. Project tenant and workspace roots.
3. Project brand and business activity relationships.
4. Project workflow contexts only where useful for authority/composition.
5. Build closure and integrity evidence.
6. Compare source counts and missing/orphan rows.

No enforcement until graph coverage and isolation pass.

### Lane C — Roles and grants

1. Map current role identities to role templates or inline permissions.
2. Preserve source assignment IDs and versions.
3. Project specialized grants as read-only binding candidates.
4. Compare decisions for representative requests.
5. Record unmappable semantics rather than inventing grants.

### Lane D — Policies

1. Inventory fields across `execution_policies` and target rules.
2. Classify fields by semantic type/operator.
3. Register schemas and mandatory floors.
4. Normalize current values to scoped atoms.
5. Shadow-evaluate contextual results.
6. Keep legacy enforcement for unresolved fields.

A policy family may have mixed status: some fields contextual, others legacy-only, until complete.

### Lane E — Preferences

1. Inventory current preference keys.
2. Classify each as presentation, ranking, composition selection, or unsupported.
3. Migrate compatible keys to unified profile versions.
4. Preserve old read path during compatibility window.
5. Dual-write only if idempotency and ownership are clear; otherwise use adapter reads.
6. Deprecate old writes after client migration.

### Lane F — Variants

1. Preserve package variants.
2. Add shared domain service for patch validation and versions.
3. Introduce generic variants for non-package assets.
4. Migrate no existing asset automatically.
5. Offer explicit conversion only when a user edits a compatible package/customization.

### Lane G — Adaptive learning

1. Add manifest attribution to new executions.
2. Backfill only safe aggregate links where deterministic.
3. Generate proposals only from evidence with known scope and quality.
4. Start with explicit feedback and Class A/B.
5. Add C/D after simulation and canary infrastructure.
6. Keep platform promotion admin-only.

### Lane H — Contextual model governance

1. Inventory current providers, endpoints/deployments, configured model IDs, task profiles, execution classes, `provider_order`, `free_first`, and allowlisted adapters.
2. Normalize exact provider endpoint, model version, inference profile, region, data-processing, and commercial profile projections without changing routing.
3. Register task classes and capability contracts and map current task profiles to compatibility records; unresolved mappings remain explicit migration debt.
4. Register contextual model policies, optimization profiles, preference templates, evaluation suites, metrics/thresholds, readiness sources, lifecycle, fallback, and governance epochs.
5. Import only provenance-valid historical evaluation/readiness/run evidence; do not infer certification from provider availability or popularity.
6. Run model-selection preview in no-effect mode and compare against current routing for each task/risk/data/region/commercial family.
7. Classify differences as exact match, contextual more restrictive, contextual more permissive, different candidate same eligibility, legacy missing context, contextual missing evidence, not comparable, or critical mismatch.
8. Require zero contextual-more-permissive and critical mismatches before any family enforcement; more restrictive differences require product/governance review.
9. Enable read-only explanations and candidate discovery for approved cohorts while current router remains execution authority.
10. Canary selection for low-risk families with exact manifests, candidate-specific estimate/reservation, provider-call adapter binding, and rollback to the certified compatibility route.
11. Progress high-risk and authority-sensitive families only after contextual evaluation, independent review, readiness, certified-equivalent fallback or explicit no-fallback, revocation, and DFR-006 safe-boundary evidence pass.
12. Retire provider-order/free-first behavior per family only after parity, SLO, security, commercial, rollback, and historical reconstruction certification.

No migration step invokes a provider/model merely to populate registry data, reads raw credentials, or silently changes customer billing/model preference.

### Lane I — Deterministic durable Workflow and Effect Commit

1. Inventory every asynchronous/long-running/effectful operation across jobs, queues, execution plans/steps/events, workflow/step runs, approval holds, scheduled work, surface Outboxes, callbacks, execution logs, provider references, and retry policies.
2. Classify each operation into Workflow, Activity, and Effect types; record current idempotency, deadline, retry, cancellation, commit-boundary, verification, reconciliation, compensation, concurrency, fairness, and recovery semantics without inventing missing evidence.
3. Register typed versioned Workflow/Activity/Effect/state/event/transition/timer/signal/error/retry/cancellation/compensation/reconciliation/checkpoint/replay/recovery/queue/concurrency/fairness authorities and allowlisted handler/build compatibility.
4. Add read-only compatibility projections over current jobs/plans/runs/outboxes and preserve source identities, attempts, timestamps, approvals, claims, provider references, and terminal outcomes.
5. Run deterministic shadow replay from projected history and compare commands, waits, deadlines, retries, outcomes, and Effect classifications against current behavior.
6. Classify differences as exact match, durable more restrictive, durable more permissive, different reason same safe outcome, missing history, missing Effect evidence, nondeterministic, not comparable, or critical mismatch.
7. Require zero durable-more-permissive, lost committed Effect, duplicate logical Effect, changed terminal outcome, accepted nondeterminism, cross-Tenant scope, or critical mismatch before enforcement.
8. Introduce append-only Workflow history, snapshots, durable timers/signals/dependencies, governance epochs, and transactional Outbox/Inbox with consumers disabled or shadow-only.
9. Introduce Activity attempts, bounded leases, monotonic fencing tokens, queue/service-class assignments, and no-effect handlers for selected low-risk families.
10. Introduce Effect Ledger, provider idempotency/reference binding, verification, reconcile-before-retry, compensation, checkpoints, recovery cases, and transport dead letters by effect family.
11. Execute fault-injection for crash-before/after dispatch, local commit failure after provider success, duplicate callback/delivery, stale Worker, timer restart, cancellation after commit, compensation failure, queue saturation, and cross-Tenant replay.
12. Canary low-risk read-only/internal-idempotent families first; progress to external idempotent/reconcilable effects only after exact parity, SLO, commercial/data/model integration, recovery, and rollback certification.
13. Progress external non-idempotent, financial, publish, delete, human-visible, irreversible, and authority-sensitive families only after explicit Effect Contracts, independent review, zero blind retry, reconciliation/manual recovery, and DFR-004/DFR-005 integration pass.
14. Retire current job/plan/run/outbox behavior per family only after no active legacy consumers, historical reconstruction, disaster restart, transport redrive, recovery ownership, and rollback pass.

No migration step replays a business Effect, invokes a provider/model/tool, reads credentials, changes billing, runs compensation, or redrives transport merely to populate target authorities. Unknown historical outcomes remain `unknown` or migration debt rather than being inferred as success/no-effect.

### Lane J — Policy-Bound Verifiable Artifact and Knowledge Fabric

1. Inventory every current Artifact and knowledge surface, including `output_artifacts`, output sinks, JSON assets/subject links, memory scope/state, platform graph evidence, session Drive artifacts, session summaries, documents, prompts, reports, datasets, evaluation samples, knowledge registries, and any vector/search/index surfaces.
2. Classify each family by logical Artifact identity, content/representation behavior, canonicalization possibility, Tenant/Platform ownership, source/version evidence, producer/run/manifest, schema/media type, sensitivity, audience, license, freshness, retention/legal hold, publication state, and downstream dependencies.
3. Register typed versioned Artifact, schema, source identity, attestation, transparency, provenance, claim/relation/citation, trust/verification, Policy Envelope, reproducibility, Knowledge Source/Chunk/Embedding/Index/Retrieval, correction/retraction/disposition, and governance-epoch authorities with allowlisted handlers only.
4. Add read-only compatibility projections that preserve exact source IDs, current scope/ownership, payload/reference checksums, file/provider references, producer/session/run evidence, and explicit `unknown`/`incomplete` fields. Never invent source identity, signature, license, trust, freshness, claim support, or publication approval.
5. Define canonicalization and representation-equivalence rules per Artifact/media family. Where canonicalization is not proven, retain stored-object checksum and mark canonical equivalence unavailable rather than merging versions.
6. Generate stable logical Artifact identities only from deterministic source keys and scope. Create immutable Version projections only when exact content/version/checksum evidence exists; mutable current URLs/files remain non-versioned Source Evidence.
7. Validate source identities, signer trust domains, attestation/key lifecycle, transparency sequence/root/witness behavior, and no-secret integration in shadow/no-effect mode before critical-family use.
8. Project provenance edges only from typed evidence and exact versions. Map graph/memory/subject links as context or weak relation candidates unless they satisfy exact-version provenance constraints.
9. Introduce Claim/Evidence/Citation projections for selected low-risk document/report families and preserve unsupported, contradicted, mutable-source, invalid-locator, and hidden-by-disclosure states explicitly.
10. Run multi-dimensional trust, freshness, license, audience, Policy Envelope inheritance, reproducibility, and publication eligibility in shadow mode against current access/publishing behavior.
11. Build no-effect Knowledge Source/Chunk/Embedding/Index plans with exact source memberships, chunk locators, profiles, model/version references, policy/trust/freshness, and checksums. Do not generate embeddings or invoke providers/models merely for backfill or shadow comparison.
12. Compare target eligibility/retrieval/publication/correction/retraction behavior against current surfaces and classify exact match, target more restrictive, target more permissive, wrong version/checksum, missing provenance, invented evidence, lost lineage, policy/trust mismatch, citation mismatch, disclosure mismatch, not comparable, or critical mismatch.
13. Require zero target-more-permissive, invented-evidence, wrong-version/checksum, cross-Tenant scope, hidden material contradiction, lost retraction/hold, unauthorized disclosure, or critical mismatch before family enforcement.
14. Enable read-only Artifact/Version/provenance/trust/policy/Knowledge explanations for approved cohorts using selective-disclosure profiles while current stores remain source authority.
15. Canary low-risk internal Artifact reads and immutable version creation first. Progress claim/citation publication, Knowledge builds, retrieval evidence, correction, retraction, and disposition only after exact identity, policy/trust, propagation, recovery, SLO, security, and rollback certification.
16. Exercise fault-injection for stored-content substitution, signer revocation, transparency fork, provenance cycle, citation drift, trust-score bypass, false declassification, selective-disclosure leak, poisoned index membership, alias movement, stale/retracted retrieval, queued-publication race, legal-hold conflict, partial erasure, and dependency-invalidation failure.
17. Retire current read/write authority per Artifact/Knowledge family only after no active legacy consumers, historical reconstruction, exact source/version/checksum parity, correction/retraction/disposition propagation, index rebuild, disaster recovery, selective-disclosure, and rollback pass.

No migration step signs content, invokes a provider/model, generates embeddings, publishes, corrects, retracts, erases, invalidates caches, notifies users, or writes externally merely to populate target authorities. Unknown historical evidence remains explicit migration debt.

## 4. Additive schema sequence

Suggested migration sequence:

1. shared asset catalog registry and source mappings;
2. policy field semantics registry;
3. composition profiles/rules/selections;
4. user runtime preference profiles;
5. generic asset variants/patches/upgrades;
6. effective runtime manifest ledger;
7. model task/capability, endpoint/model-version, inference-profile, context-policy, optimization, and preference authorities;
8. model evaluation suite/dataset/metric/run/result, scorecard, readiness, selection, fallback, drift, incident, deprecation, and governance-epoch authorities;
9. Workflow/Activity/Effect/state/event/transition/timer/signal/error/retry/cancellation/compensation/reconciliation/checkpoint/replay/recovery/queue/concurrency/fairness registries and certified handler metadata;
10. durable Workflow history/snapshots/timers/signals/dependencies, Activity attempts/leases/results, Effect dispatch/verification/reconciliation/compensation, Outbox/Inbox, checkpoints/recovery/replay, transport dead letters, queues/rate/concurrency, and runtime-governance epochs;
11. Artifact type/schema/identity/version/content-object/representation, source identity/attestation/transparency, provenance/claim/relation/citation, trust/verification/freshness, Policy Envelope/selective disclosure, and reproducibility authorities;
12. Knowledge Source/Chunk/Embedding/Index/membership/Retrieval Evidence, correction/retraction/disposition/dependency-invalidation, and Artifact-governance authorities;
13. adaptive proposals/simulations/experiments/measurements/promotion candidates;
14. views for catalog, bridge parity, model-selection parity/readiness, durable Workflow shadow parity/recovery, Artifact/Knowledge parity/trust/propagation, and adaptive health;
15. indexes, partitioning, archival, content-addressed storage metadata, transparency-proof retention, and evidence-retention metadata;
16. feature/rollout registry rows.

Each migration includes authorization metadata, preflight, indexes, rollback/disable strategy, and same-cycle schema readback.

## 5. Backfill design

### Requirements

- idempotent by stable source key;
- bounded batches with cursor/checkpoint;
- no secret reads;
- dry-run counts before apply;
- source/target checksums;
- retry-safe upserts;
- error/debt table for unmapped rows;
- observed-at timestamps;
- no deletion of source authority;
- pause/resume and rollback by disabling consumers.

### Container projection checkpoint

```text
source_subject_type
source_primary_key
source_version
projected_container_id
projection_checksum
status
last_attempt_at
error_code
```

### Policy atom checkpoint

```text
source_policy_table
source_policy_key
source_version
registered_field_count
unmapped_field_count
atom_checksum
status
```

## 6. Compatibility modes

### Legacy-only

Current runtime remains sole authority.

### Shadow

Contextual resolver runs read-only and records comparison.

### Read-only contextual

Contextual resolver may drive catalog/explanation/ranking but not consequential execution.

### Bounded canary

Exact cohorts and asset families use contextual authority for approved read-only operations.

### Enforced by family

Certified family uses contextual authority; legacy path remains fallback only if explicitly approved and safe.

### Legacy retired

Source tables may remain historical/read-only until retention and dependency review. Retirement is a separate change.

## 7. Parity classification

Comparisons classify:

- `exact_match`;
- `contextual_more_restrictive`;
- `contextual_more_permissive`;
- `different_reason_same_decision`;
- `legacy_missing_context`;
- `contextual_missing_bridge`;
- `durable_missing_history`;
- `durable_missing_effect_evidence`;
- `durable_nondeterministic`;
- `durable_duplicate_effect_risk`;
- `durable_changed_terminal_outcome`;
- `artifact_target_more_restrictive`;
- `artifact_target_more_permissive`;
- `artifact_wrong_version_or_checksum`;
- `artifact_missing_provenance`;
- `artifact_invented_evidence`;
- `artifact_lost_lineage`;
- `artifact_trust_or_policy_mismatch`;
- `artifact_citation_mismatch`;
- `artifact_selective_disclosure_mismatch`;
- `artifact_retraction_or_hold_mismatch`;
- `knowledge_index_membership_mismatch`;
- `knowledge_retrieval_gate_mismatch`;
- `not_comparable`;
- `critical_mismatch`.

Rules:

- more permissive is blocking until reviewed;
- critical mismatch tolerance is zero;
- more restrictive may be acceptable only with product/governance review;
- not-comparable rows contribute to migration debt, not success rate.

## 8. Cutover unit

Cutover is never platform-wide by one flag. The unit includes:

```text
tenant/cohort
+ asset family
+ operation class
+ context type
+ task class and capability profile/version where applicable
+ risk/data/region family where applicable
+ model optimization profile/version where applicable
+ Workflow/Activity/Effect family and definition/contract versions where applicable
+ retry/cancellation/reconciliation/compensation/recovery policy versions where applicable
+ queue/service class/concurrency/fairness policy versions where applicable
+ composition profile/version
+ resolver/model-selection/durable-runtime version
```

Examples:

- read-only shared workflow discovery for one internal tenant;
- analytics read actions for one workspace;
- personal workflow ranking for opted-in users;
- WordPress publish preview, not dispatch;
- later, exact approved WordPress write actions.

## 9. Cutover checklist per family

- source mapping coverage complete;
- context graph coverage complete;
- policy field semantics complete;
- specialized grants bridged;
- parity sample threshold met;
- critical mismatch count zero;
- cross-tenant and secret tests pass;
- p95/p99 budgets pass;
- audit/manifest coverage 100%;
- rollback flag tested;
- operator and owner identified;
- release readiness and explicit approval recorded;
- applicable task/capability mappings complete and unregistered/raw model paths blocked;
- exact endpoint/model-version/inference-profile inventory and adapter allowlist complete;
- evaluation/scorecard/readiness evidence current for the task/risk/data/region family;
- contextual-more-permissive and critical model-selection mismatch count zero;
- selected and fallback candidates independently pass all mandatory gates;
- candidate-specific estimate/reservation coverage 100% for cost-bearing execution;
- high-risk certified-equivalence or explicit no-fallback policy verified;
- emergency restriction/revocation, queued-work invalidation, alias movement, and deprecation rollback tested;
- Workflow/Activity/Effect definitions, handler builds, commit boundaries, and policy versions are registered and certified for the exact family;
- deterministic replay, history/snapshot reconstruction, and expected-sequence append pass with zero accepted nondeterminism;
- scoped idempotency, stable provider/effect keys, duplicate callback/delivery, and changed-payload conflict tests pass;
- Activity leases/fencing, timer/signal restart, Outbox/Inbox atomicity, and consumer deduplication fault-injection pass;
- uncertain external outcomes reconcile before retry, and zero blind retry or lost committed Effect is observed;
- cancellation, partial success, compensation, recovery ownership/SLA, checkpoint/replay, and transport dead-letter redrive are exercised;
- durable-more-permissive, duplicate-effect-risk, changed-terminal-outcome, and critical mismatch count is zero;
- queue admission, Tenant/resource/provider concurrency, fairness, priority aging, starvation, backpressure, and reserved recovery capacity meet SLO;
- model fallback after visible output or committed Tool/external Effect is blocked or uses verified remaining-work restart plus new reservation;
- rollback to the prior certified family authority is tested without deleting Workflow/Effect history;
- post-cutover readback confirms expected decision mix.

## 10. Rollback hierarchy

1. Stop adaptive experiments and disable new canary admissions for the affected operation/effect family.
2. Stop new durable Workflow creation or Activity dispatch for the affected family while preserving active history and recovery access.
3. Restrict or revoke an unsafe Workflow definition, Activity handler build, Effect Contract, provider endpoint, or model version and advance the applicable governance epoch.
4. Quarantine uncertain/duplicate-risk Effects, pause automatic retries/compensation/redrives, and route active work to bounded reconciliation or recovery.
5. Disable contextual model selection for the affected task/risk/data/region family and stop new selection decisions where implicated.
6. Disable new profile/variant publication if implicated.
7. Disable contextual/durable consumers for the affected family/cohort and preserve transactional Outbox/Inbox/history evidence.
8. Return to the prior job/plan/run/provider-order/free-first or legacy authority only where it is separately certified safe for the exact family and known committed Effects; otherwise block.
9. Invalidate affected model selections, manifests, checkpoints, caches, queued pre-dispatch work, timers/signals, and reservations where required without deleting source history.
10. Revoke or expire canary approvals and release only proven-unused commercial/resource reservations.
11. Preserve Workflow history, Activity attempts, Effect dispatch/verification/reconciliation/compensation, recovery, transport, model, and outcome evidence and compare before/after.
12. Rebuild projections/snapshots from history and verify zero lost or duplicated logical Effects.
13. Keep recovery/system-critical capacity available for reconciliation, compensation, customer-visible status, and operator actions.
14. Apply code/schema rollback only if consumer disablement, handler/definition restriction, and authority rollback are insufficient.

Data is generally retained for audit; rollback does not delete tenant preferences or variants unless they are unsafe and separately handled.

## 11. Data cleanup after cutover

Cleanup is deferred until:

- dependency scan shows no active consumers;
- historical/audit retention is satisfied;
- export/rollback path is tested;
- generated OpenAPI and documentation are updated;
- destructive migration is separately approved.

Likely cleanup categories:

- duplicate connector endpoint records;
- internal transports modeled as installable connectors;
- deprecated preference write paths;
- obsolete bridge views;
- stale projection debt after canonical source retirement.

## 12. Failure handling

### Partial backfill

Keep cursor/checkpoint and retry failed rows. Consumers must treat missing projections as incomplete evidence and fall back/block according to stage.

### Schema applied but service not deployed

Additive tables remain unused. No runtime change.

### Service deployed but migration missing

Startup/readiness check marks feature unavailable; no silent fallback to permissive behavior.

### Contextual regression

Feature-family flag returns traffic to previous authority; manifests preserve evidence.

### Main/branch repository drift

Repair current branch first through governed reconciliation, expected SHAs, merge/fast-forward or scoped no-force patch, CI, and ancestry readback.

## 13. Environment progression

```text
local/unit
→ CI static/contract tests
→ development migration preflight
→ development shadow with seeded representative data
→ development canary
→ release readiness
→ production schema apply with consumers disabled
→ production shadow
→ bounded read-only canary
→ family cutover
→ monitored expansion
```

No environment step is inferred from successful code merge alone.

## 14. Completion definition

Migration is complete only when:

- shared assets remain canonical;
- target tenant/context subjects are projected;
- required fields have typed semantics;
- user preferences and optional variants are available without authority escalation;
- executions link to effective manifests;
- adaptive proposals use measured evidence;
- model selection for each migrated task/risk family starts from registered capability contracts, uses current evaluation/readiness evidence, independently eligible fallback, candidate-specific commercial authorization, and reconstructable manifests;
- provider-order/free-first and hardcoded task/model behavior is retired only for certified families and remains documented compatibility debt elsewhere;
- emergency model restriction/revocation, drift, deprecation, alias movement, rollback, and historical reconstruction are operational;
- every migrated operation/effect family runs through a registered deterministic Workflow definition, certified Activity handler, explicit Effect Contract, scoped idempotency, deadlines, retry/cancellation/reconciliation/compensation/recovery policy, and reconstructable immutable history;
- Activity leases/fencing, durable timers/signals/dependencies, transactional Outbox/Inbox, verification, reconciliation, compensation, checkpoints/replay, transport dead letters, and recovery ownership are operational and observable;
- current jobs/plans/runs/outboxes are retired only for certified families and remain documented compatibility debt elsewhere;
- zero accepted nondeterminism, successful stale-fencing commit, duplicate logical Effect, blind retry after uncertain dispatch, lost committed Effect, cross-Tenant replay, or unsafe model fallback is demonstrated;
- queue admission, concurrency, fairness, priority aging, backpressure, and reserved recovery capacity meet approved SLOs under representative load;
- all target families are cut over or explicitly retained as legacy with documented debt;
- operational dashboards, SLOs, rollback, and runbooks are active;
- deprecated authorities are retired only through separate approved work.
