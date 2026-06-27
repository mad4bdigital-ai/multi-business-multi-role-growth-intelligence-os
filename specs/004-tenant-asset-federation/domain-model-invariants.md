# Domain Model and Invariants

## 1. Aggregate boundaries

The design separates the platform into aggregates that may reference one another but must not silently absorb one another's authority.

### Shared Asset

Canonical platform definition referenced by all tenants. Examples: agent, skill, workflow, action, plugin, policy template, tool, logic, engine, or knowledge profile.

Owns:

- stable asset identity;
- canonical source pointer;
- platform version and checksum;
- visibility and entitlement metadata;
- customization policy;
- risk and runtime dependency declarations.

Does not own tenant grants, credentials, user preferences, or contextual policy outcomes.

### Context Graph

Tenant-bounded topology containing tenant, workspace, brand, business activity, workflow, and future container types.

Owns:

- containment and non-containment relationships;
- classifications;
- role assignments;
- resource bindings;
- authority epoch;
- immutable resolution evidence.

Does not own canonical shared asset content or credential values.

### Composition Profile

Versioned user- or administrator-selected rules controlling how eligible context layers combine for specific dimensions and policy families.

Owns:

- registered composition operators;
- required and optional layers;
- precedence and conflict behavior;
- conditions, validity, publication state, and provenance.

Does not grant resources or edit shared assets.

### User Preference Profile

The user's own non-authority behavior and ranking choices.

Owns:

- language, tone, depth, view, channel, cadence, and accessibility preferences;
- rankings among authorized agents, workflows, tools, and providers;
- default composition-profile selections where permitted;
- adaptation consent and visibility settings.

Does not own grants, quotas, credentials, mandatory policies, or another user's state.

### Optional Variant

Sparse scoped customization of one shared asset.

Owns:

- base asset/version/checksum reference;
- owner scope;
- bounded patches and versions;
- certification, conflict, upgrade, disable, and reset state.

Does not replace the canonical base or copy credential material.

### Runtime Readiness

Decision surface proving that an exact operation can run now.

Owns no durable secret. It resolves evidence from:

- action and endpoint authority;
- resource and role grants;
- connection eligibility;
- installation and certification;
- quotas and budgets;
- approval holds;
- provider/runtime health.

### Effective Runtime Manifest

Immutable, no-secret attribution record combining context, authority, composition, assets, variants, preferences, readiness, the exact data-use decision/version vector, and the exact commercial decision, billing profile/model, meter/unit/rating/price versions, estimate, reservation, standing, and commercial epoch.

It is a derived record, not an authority, reservation, settlement, ledger, invoice, or payment mutation surface.

### Data-Use Decision

Immutable, explainable eligibility record for one exact actor, context, resource/data reference, operation, purpose, audience, destination, provider/model, region, and policy snapshot.

Owns:

- classification and source versions;
- registered purpose and allowed-use evidence;
- lawful-basis and consent evidence where applicable;
- residency and transfer result;
- retention and legal-hold result;
- provider/model data-processing result;
- most-restrictive applicable policy sources;
- allow, block, or restrict decision;
- expiry, governance version vector, explanation, recovery actions, and checksum.

Does not grant resource access, store credential values, create lawful basis, or override a legal hold. It is bound into the Effective Runtime Manifest and revalidated before consequential dispatch.

### Billing Profile

Versioned commercial configuration selected for one eligible billing account/context from an approved template.

Owns:

- template and version;
- billing model and collection mode selections;
- eligible meter bundle and price/rating references;
- included units, delegated budgets/quotas, overage, alerts, statement grouping, and attribution settings;
- field-level customization provenance, approval, validity, lifecycle, and checksum.

Does not own prices, tax rules, FX rates, ledger accounts, payment credentials, billable ownership, or posted financial history. A profile cannot exceed contract, plan, Tenant, risk, accounting, payment, or Platform bounds.

### Usage Meter Definition

Versioned registered measurement contract for one stable meter key.

Owns:

- meter family and canonical unit;
- aggregation mode;
- source authority and allowed dimensions;
- deduplication, verification, late-event, correction, reservability, billability, and pricing eligibility semantics;
- lifecycle, compatibility, and checksum.

Does not own Tenant-specific prices or raw usage values. Tokens are one meter family only.

### Meter Event

Immutable raw measurement for one exact Tenant, billing account, operation, manifest, meter/version, unit, source event, and evidence checksum.

Corrections, retractions, or classification changes append linked events and never mutate the original measurement.

### Commercial Decision

Immutable explainable eligibility record for one exact actor/context, billing account, billable owner, billing profile, billing model, collection mode, entitlement, standing, meter/unit/rating/price versions, budgets/quotas, and commercial epoch.

It determines allow, block, approval-required, or constrained eligibility. It does not reserve or post value.

### Cost Estimate

Immutable bounded forecast separating raw/normalized/included/billable quantities, expected and maximum customer charge, expected provider/internal cost, tax, discount, credit offset, asset type, confidence, price/rating versions, expiry, and checksum.

It does not grant spend authority and cannot be reused after expiry or commercial-epoch drift.

### Cost Reservation

Atomic idempotent claim on available Credits, money, included units, budget, quota, or postpaid liability capacity for one operation and manifest.

Owns:

- billing owner/account/profile/model and settlement asset type;
- estimate/version/checksum;
- maximum units/amount and consumed/released portions;
- idempotency request checksum;
- expiry, commercial epoch, state, and evidence.

It cannot change billing asset type or billable owner after activation.

### Cost Settlement

Immutable verified financial result linked to one operation, manifest, reservation, evidence set, and ledger transaction.

Owns customer charge, provider/internal cost, tax/discount, included usage, released reservation, billability classification, and itemized source usage/outcome evidence.

### Commercial Ledger Transaction

Append-only balanced transaction containing one or more debit and credit entries in exactly one currency or one credit-unit family.

Posted transactions are immutable. Refunds, corrections, disputes, chargebacks, expiries, and reversals use linked compensating transactions.

### Model Capability Profile

Versioned registered task/capability contract independent from any provider/model implementation.

Owns required and optional modalities, languages, context/output bounds, structured-output/tool/streaming/grounding/determinism requirements, risk class, quality/reliability/latency floors, validity, lifecycle, and checksum.

### Model Candidate

Immutable contextual identity of one provider endpoint/deployment, exact model version or alias-resolution snapshot, inference profile, region, data-processing profile, and commercial profile.

A candidate owns no credentials and grants no execution authority.

### Model Evaluation Suite

Versioned evaluation contract owning dataset references, rubric, deterministic validators, human/model-judge policy, adversarial/regression cases, sample requirements, metrics, thresholds, zero-tolerance failures, confidence, freshness, and checksum.

### Model Quality Scorecard

Immutable bounded summary for one exact candidate and contextual evaluation scope.

Owns suite/run versions, sample/corpus scope, metric values/confidence, failure classes, latency/reliability/error/cost observations, regions/endpoints, validity, drift state, and checksum. It does not create eligibility by itself.

### Model Readiness Snapshot

Time-bounded no-secret operational evidence for one exact provider endpoint/model feature set.

Owns credential-presence readiness without value, contract/certification, capacity/quota/rate-limit, circuit breaker, recent success/error/timeout/latency, feature availability, incident state, observed time, expiry, and readiness classification.

### Model Selection Decision

Immutable explainable decision for one exact Tenant/principal/context/operation and registered task/capability contract.

Owns candidate-universe snapshot, deterministic gate results, policy/evaluation/readiness/commercial evidence, optimization profile and metrics, selected candidate, fallback set, model-governance epoch, expiry, explanation, and checksum.

It does not store credentials, perform provider calls, run evaluation, or reserve cost by itself.

### Model Fallback Set

Immutable ordered set of independently eligible candidates bound to one task/capability/risk/data/commercial context and safe-boundary policy.

It cannot include a candidate that failed any mandatory gate.

### Model Deprecation Run

Governed impact/migration workflow owning affected assets/Agents/workflows/profiles/manifests, replacement candidates, deadline, shadow/canary evidence, exceptions, rollback, progress, and completion readback.

### Durable Workflow

Deterministic long-running decision aggregate reconstructed from immutable ordered history.

Owns Workflow identity, definition/version, Tenant/principal/context, manifest, idempotency, deadlines, policies, timers, signals, dependencies, lifecycle/outcome projection, governance epochs, and history checksum.

It schedules Activities but does not directly call providers, read credentials, or mutate external state.

### Runtime Activity

At-least-once execution unit bound to one Workflow and one allowlisted handler/type/policy version.

Owns Activity identity, input/output checksums, attempt history, queue/service class, lease/fencing evidence, deadline, retry/cancellation/concurrency policy, results, and linked Effects.

### Runtime Effect

Stable logical internal/external/human-visible/commercial result of an Activity.

Owns Effect type/contract version, logical key, target, expected checksum, provider idempotency/reference evidence, commit state, verification, reconciliation, compensation, retention, and recovery linkage.

An Effect never stores credential values and is not considered successful from transport status alone.

### Workflow Checkpoint

Immutable verified resumable state at an exact Workflow history sequence.

Owns state checksum, committed Effect references, remaining-work summary, manifest/authority/version vector, sensitivity, expiry, and compatible replay policy. It contains neither unverified process memory nor secrets.

### Runtime Recovery Case

Governed business-recovery aggregate for retry exhaustion, uncertain outcome, compensation failure, incompatible schema, changed authority/manifest, or manual decision.

Owns unresolved Effects, evidence, owner, severity, SLA, permitted actions, review/expiry, resolution, and checksum. It is distinct from transport dead letters.

### Transport Dead Letter

Failed Outbox/Inbox/queue/callback/notification delivery record with source identity, schema/checksum, attempts, failure class, redrive eligibility, owner, retention, and safe evidence.

It does not represent the business Workflow outcome and grants no authority to repeat an external Effect.

### Adaptive Change Proposal

Governed hypothesis for improving experience, execution, or business outcome.

Owns:

- target and objective;
- evidence and confidence;
- proposed delta;
- risk and approval class;
- simulation, experiment, measurement, expiry, and rollback.

It cannot directly modify authority or provider state.

## 2. Identity rules

### Shared asset identity

```text
asset_ref = asset_type + canonical_source + canonical_key
```

The stable identity survives display-name changes. Version identity changes when canonical behavior changes.

### Context identity

A container uses a stable platform ID plus canonical subject reference. A user-supplied key cannot create a second identity for the same canonical subject.

### Variant identity

A variant is unique by:

```text
tenant_id + base_asset_ref + owner_scope_type + owner_scope_ref + variant_key
```

### Manifest identity

A manifest checksum binds:

```text
principal + context target + authority epoch + registry snapshot
+ composition profile versions + policy atom versions
+ shared asset versions + variant versions + preference version
+ data-use decision and governance version vector
+ commercial decision + billing profile/model/collection-mode versions
+ meter/unit/rating/price-book versions + estimate/reservation checksums
+ commercial epoch + normalized request + resolver version
```

## 3. Global invariants

### INV-001 — Shared by default

Referencing or granting a shared asset must not create a tenant/user copy.

### INV-002 — Sparse customization

A variant exists only after explicit customization or accepted Class D adaptation.

### INV-003 — Platform-base immutability

Tenant principals cannot update canonical shared asset records.

### INV-004 — Tenant containment

Every tenant-owned profile, variant, connection binding, proposal, experiment, and manifest belongs to exactly one tenant.

### INV-005 — Preference cannot grant

User preference can rank, hide, narrow, or select among authorized candidates; it cannot add authority.

### INV-006 — Composition cannot bypass

No composition mode can remove mandatory deny, validator, approval, credential, quota, certification, or isolation requirements.

### INV-007 — Typed semantics only

Every composable policy field must have a registered schema and semantic operator. Unknown fields fail validation.

### INV-008 — Deny accumulation

Applicable mandatory and contextual denies remain effective regardless of positive union.

### INV-009 — Restrictive numerical resolution

Upper limits use minimum; required lower bounds, risk, sensitivity, and approval severity use maximum unless a registered domain rule says otherwise.

### INV-010 — Ambiguity blocks

Equal-ranked conflicting values, paths, variants, or connections block rather than choosing nondeterministically.

### INV-011 — Credential separation

Credential payloads never appear in assets, variants, profiles, manifests, proposals, experiments, logs, or API responses.

### INV-012 — Authorization precedes materialization

Credential materialization and provider-client creation happen only after exact contextual authority passes.

### INV-013 — Epoch consistency

A mutation or dispatch may not use a manifest whose authority epoch or contributing versions changed before execution.

### INV-014 — Reconstructability

Every effective decision must be reconstructable from immutable IDs, versions, operators, paths, and checksums.

### INV-015 — Adaptation proposes, not commands

Behavioral evidence may create a proposal. It may not silently change an effective profile, variant, grant, credential, or provider state.

### INV-016 — Scoped experiment

Every experiment has an exact cohort, baseline, treatment, start snapshot, measurement window, guardrails, expiry, and rollback.

### INV-017 — Cross-tenant promotion is separate

Tenant-local content cannot become a shared platform asset without privacy review, certification, and normal platform release governance.

### INV-018 — Current authority preserved during migration

Legacy policy/grant paths remain authoritative until contextual parity and cutover criteria pass for the exact asset family.

### INV-019 — Branch continuity first

Repository work repairs the current feature branch before creating a replacement branch whenever governed reconciliation demonstrates a safe no-force path.

### INV-020 — Access is not processing eligibility

A valid access grant is necessary but cannot authorize collection, use, transfer, inference, export, retention, learning, correction, restriction, or deletion without a compatible data-use decision.

### INV-021 — Registered purpose required

Every consequential data operation declares a registered purpose. Missing, materially mismatched, or disallowed purpose fails closed.

### INV-022 — Most restrictive data rule wins

The effective data-use result applies the most restrictive applicable Platform, jurisdiction, Tenant, Brand, Workspace, delegated organizational, resource, subject, operation, provider/model, region, audience, and destination rule.

### INV-023 — Protected classifications cannot be downgraded

Credentials, secrets, legal-hold coverage, and mandatory regulated categories cannot be weakened by local classification override, preference, variant, or inherited Blueprint.

### INV-024 — Consent is bounded evidence

Consent is purpose/category/audience/provider scoped where applicable, versioned, revocable, and cannot override Platform, legal, security, contract, or Tenant prohibitions.

### INV-025 — Residency before materialization

Storage, processing, provider/model, backup, export, and transfer eligibility is resolved before credential materialization, content transfer, indexing, model invocation, or provider dispatch.

### INV-026 — Legal hold is not authority

A legal hold may prevent covered deletion or mutation but never grants read, export, processing, or cross-scope discovery authority.

### INV-027 — Derived data inherits obligations

Summaries, embeddings, indexes, Agent memory, evaluations, analytics, aggregates, artifacts, provider copies, and backups retain lineage and explicit correction, restriction, retraction, erasure, or hold disposition obligations.

### INV-028 — Transform does not imply anonymous

Derived or transformed data is not considered anonymous without approved evidence and cannot escape source-purpose, retention, residency, subject, or lineage obligations by format change alone.

### INV-029 — Provider fallback preserves data policy

Fallback may occur only among providers/models that satisfy the same or stricter purpose, residency, transfer, retention, deletion, training, contract, security, and zero-retention requirements.

### INV-030 — Raw cross-Tenant learning forbidden

Raw Tenant content and Tenant-specific examples cannot be inputs to or outputs from cross-Tenant learning. Only governed aggregate evidence meeting participation, cohort, contribution, residency, re-identification, provenance, quality, and fairness requirements may be eligible.

### INV-031 — Governance epoch consistency

A consequential operation cannot use a data-use decision or manifest after any contributing classification, purpose, consent, lawful-basis, residency, transfer, retention, hold, provider/model, subject-request, or aggregate-learning policy version changes.

### INV-032 — Preview has no effect

Data-use and disposition previews perform no provider call, credential read, content transfer, deletion, mutation, model execution, external write, or authority grant.

### INV-033 — Commercial semantics are registered

Billing models, collection modes, units, meters, aggregation modes, rating models, price books, profile templates, customizable fields, reason codes, and lifecycle transitions resolve from versioned database authorities. Unknown or unsupported semantics fail closed.

### INV-034 — User customization is bounded

A user may select or tighten only template-exposed typed fields within contract, plan, Tenant, delegated, tax, accounting, payment, risk, and Platform bounds. User customization cannot invent price, meter, unit, formula, currency, FX, tax, ledger, billable owner, or credit-limit semantics.

### INV-035 — Credits, money, and usage are distinct

Credits, monetary assets, and usage quantities cannot be balanced or settled against one another without an explicit compatible conversion contract and current quote/version.

### INV-036 — One direct billable owner

Each cost-bearing operation resolves exactly one billing account and one billable owner through a direct active commercial relationship. Ownership, management, support, white-label, and attribution do not imply liability.

### INV-037 — Tokens are not universal

Tokens are one meter family. Every measured resource uses a registered meter/version, canonical unit, aggregation mode, source authority, and evidence contract appropriate to its domain.

### INV-038 — Raw measurement is immutable

Original meter events are append-only, deduplicated, Tenant/account scoped, and evidence linked. Corrections or retractions append new events and never overwrite source measurements.

### INV-039 — Measurement and rating are separate

Raw usage, normalized usage, included usage, billable usage, provider/internal cost, customer charge, reservation, settlement, and ledger posting remain separately reconstructable.

### INV-040 — Composite meters preserve components

A composite meter uses only registered typed operators and immutable versioned components. It cannot erase, mutate, or hide the raw component events used to derive billable usage.

### INV-041 — Estimate is not authority

A cost estimate is an expiring forecast and does not authorize execution, reservation, settlement, invoice, or payment collection.

### INV-042 — Reservation precedes cost-bearing dispatch

A consequential cost-bearing operation cannot dispatch without an active compatible reservation unless an explicit bounded postpaid policy permits the exact operation and liability capacity.

### INV-043 — Reservation is atomic and single-asset

One reservation atomically claims available capacity for one billing owner, account, profile, billing model, settlement asset, manifest, operation, and commercial epoch. Concurrent operations cannot consume the same capacity.

### INV-044 — Streaming work is bounded

Unknown or streaming usage consumes bounded reservation windows. Denied extension stops further cost-bearing work at the next safe boundary.

### INV-045 — Settlement requires verified evidence

Settlement requires current reservation, execution, usage/outcome, billability, rating/price, owner/account, manifest, and commercial-epoch evidence and cannot exceed authorization without a separately approved overage reservation.

### INV-046 — Customer charge and provider cost differ

Provider/internal cost does not automatically become customer liability. Unauthorized provider-cost, FX, or usage drift cannot silently increase the customer charge.

### INV-047 — Ledger is immutable and balanced

Every posted commercial transaction balances debit and credit within one currency or credit-unit family. Posted entries are never updated or deleted; corrections use compensating transactions.

### INV-048 — Attribution grants nothing

Cost attribution to Brand, Workspace, Department, Group, campaign, objective, principal, project, or custom cost center creates neither billing liability nor data/resource authority.

### INV-049 — Commercial epoch consistency

An operation cannot use a commercial decision, estimate, reservation, profile, price, meter, standing, or manifest after a contributing commercial authority version changes.

### INV-050 — Commercial preview has no effect

Billing-profile, entitlement, estimate, and reservation previews perform no reservation, charge, ledger posting, invoice, payment collection, provider call, credential read, or external write.

### INV-051 — Selection starts from capability

Model/provider selection begins with a registered task class and versioned capability contract. A raw model name, mutable alias, global provider order, or convenience default cannot substitute for that contract.

### INV-052 — Candidate identity is exact

A candidate binds provider endpoint/deployment, exact model version or alias-resolution snapshot, inference profile, region, data-processing profile, and commercial profile. Consequential execution cannot use a partially specified candidate.

### INV-053 — Hard gates precede ranking

Lifecycle, capability, entitlement, authority, data, region, risk, tool, output, evaluation, readiness, incident/deprecation, and commercial gates execute before optimization. Score, preference, cost, latency, popularity, availability, or provider order cannot override a failed gate.

### INV-054 — Ranking includes only eligible candidates

Only candidates that independently pass every mandatory gate may enter the ranked set or fallback set.

### INV-055 — Preference does not create eligibility

User or Tenant preference may narrow, reorder, or disable eligible options but cannot introduce a raw candidate, lower mandatory floors, weaken data/safety/region/tool/output policy, modify credentials, or bypass commercial reservation.

### INV-056 — Evaluation is contextual and bounded

Evaluation evidence is bound to exact candidate, task/capability, locale, modality, domain, risk, tool/output, data, region, suite, dataset, metric, threshold, confidence, and freshness versions.

### INV-057 — High-risk certification is plural

A model judge cannot be the sole certification authority for high-risk or authority-sensitive use. Applicable deterministic and independent human or governed review evidence is required by policy.

### INV-058 — Readiness and quality are independent

A high-quality candidate may be operationally unready, and a ready candidate may lack sufficient quality evidence. Neither plane substitutes for the other.

### INV-059 — Stale evidence is explicit

Stale, unknown, drifting, insufficient, failed, or revoked evaluation/readiness evidence follows explicit task/risk policy and is never silently interpreted as current or eligible.

### INV-060 — Fallback is pre-certified

Fallback is an immutable ordered set of independently eligible exact candidates. It is never inferred from a global provider list at failure time.

### INV-061 — Fallback cannot downgrade

Fallback cannot weaken capability, data, region, safety, tools, output contract, evaluation, readiness, lifecycle, entitlement, or commercial authorization.

### INV-062 — High-risk fallback is opt-in by certification

Authority-sensitive and other high-risk tasks have fallback disabled unless an alternative is certified equivalent for the same mandatory contracts and evidence.

### INV-063 — Commercial authority is candidate-specific

Each selected or fallback candidate requires its own estimate and active reservation. One candidate's reservation cannot finance another candidate.

### INV-064 — Selection decision is immutable evidence

A model-selection decision records the candidate universe, gate evidence, metric evidence, ranking, selected candidate, fallback set, commercial references, epoch, expiry, explanation, and checksum. It grants neither credentials nor provider-call authority.

### INV-065 — Provider adapters are allowlisted code

Database registries may select an approved adapter key and bounded profile but cannot introduce arbitrary endpoints, headers, executable code, SQL, JavaScript, shell, model code, or secret values.

### INV-066 — Model lifecycle invalidates stale execution

Restriction, deprecation, revocation, material alias movement, policy change, evaluation/scorecard change, readiness change, incident, fallback change, or commercial compatibility change advances the model-governance epoch where applicable.

### INV-067 — Pre-dispatch revalidation is mandatory

Before every provider call, runtime revalidates lifecycle, incident/revocation, evaluation freshness, readiness, data/region, entitlement, commercial reservation, fallback eligibility, expiry, and model-governance epoch.

### INV-068 — Partial-output switching is not implicit

After streamed output, content, state, or tool effects begin, switching models is not an automatic fallback. DFR-006 determines restart, resume, idempotency, compensation, and duplicate-effect behavior.

### INV-069 — Model preview has no effect

Model-selection and deprecation previews perform no provider/model call, credential read, evaluation execution, commercial reservation, lifecycle mutation, or external write.

### INV-070 — Workflow history is authoritative

Durable Workflow state is reconstructed from immutable ordered history. Snapshots, queues, caches, and projections are rebuildable accelerators and cannot override history.

### INV-071 — Workflow decisions are deterministic

The same compatible Workflow definition/version and history must produce the same logical commands. Nondeterminism blocks and enters recovery rather than silently accepting divergent state.

### INV-072 — Dynamic semantics are typed and bounded

Workflow, Activity, Effect, retry, timer, signal, cancellation, compensation, reconciliation, replay, recovery, concurrency, and fairness semantics resolve from versioned typed registries. Unknown semantics fail closed.

### INV-073 — Executable code is allowlisted

Database rows may select certified handler/adapter keys and bounded parameters but cannot introduce executable code, arbitrary URLs/headers, SQL, JavaScript, shell, model code, or credential values.

### INV-074 — Child Workflows cannot broaden

A child Workflow inherits or tightens parent Tenant, authority, data/model/commercial, deadline, risk, cancellation, and credential boundaries.

### INV-075 — Activity delivery is at least once

An Activity may be delivered or attempted more than once. Correctness depends on stable Activity/Effect identity, idempotency, verification, fencing, and reconciliation rather than a single-delivery assumption.

### INV-076 — Effect identity is stable

One logical Effect keeps the same Effect ID/key and provider idempotency key across attempts. A retry cannot create a new logical identity for the same intended Effect.

### INV-077 — Idempotency binds request checksum

The same scoped idempotency key and checksum return the original logical result. Reuse with changed input blocks and creates no new Effect.

### INV-078 — Stale lease cannot commit

Every state-changing Activity commit requires a live lease and current monotonic fencing token. A stale Worker cannot update history, results, or Effect evidence.

### INV-079 — Transport success is not Effect success

An HTTP/provider acknowledgement does not prove business success unless the registered Effect verification policy is satisfied.

### INV-080 — Uncertain Effects reconcile before retry

If request transmission may have begun and Effect outcome is not proven, the Workflow schedules reconciliation before retry unless the Effect Contract proves idempotent repeatability.

### INV-081 — Retry is deadline and budget bounded

Retry cannot exceed absolute Workflow/Activity deadline, attempt/elapsed budget, circuit-breaker policy, quota, commercial reservation, or governance epochs.

### INV-082 — Timers and signals are durable

Timers, callbacks, approvals, cancellation requests, and other signals are persisted, typed, scoped, idempotent, and survive Worker/deployment restart.

### INV-083 — Cancellation cannot erase Effects

Cancellation prevents new unsafe work and may schedule compensation, but committed, visible, commercial, human, or irreversible Effects remain explicit.

### INV-084 — Outbox and Inbox are transactionally deduplicated

Workflow event/outbox publication shares one local transaction, and consumer Inbox completion shares the consumer Effect transaction where possible. Duplicate delivery cannot repeat the logical Effect.

### INV-085 — Business recovery is not transport dead letter

A business Workflow enters an explicit recovery case for uncertain or unresolved Effects. Dead letters are limited to transport artifacts and cannot redefine Workflow outcome.

### INV-086 — Compensation is a new Effect

Compensation is an idempotent, verified Effect linked to the original committed Effect. It never deletes or rewrites the source history.

### INV-087 — Partial success is itemized

Partial success enumerates required/optional step outcomes and committed, verified, compensated, uncompensated, and unknown Effects plus manual actions.

### INV-088 — Replay creates a new Workflow

Replay or recovery does not mutate the source Workflow. It creates a new linked identity from a verified checkpoint under current manifest, authority, policy, and commercial evidence.

### INV-089 — Model fallback respects commit boundaries

A fallback model cannot silently continue user-visible output or repeat a committed Tool/external Effect. It receives only an authorized verified checkpoint and remaining work.

### INV-090 — Runtime previews have no effect

Cancel, resume, replay, recovery, reconciliation-action, and redrive previews perform no Activity execution, provider/model/tool call, credential read, queue publish, commercial reservation, compensation, replay, lifecycle mutation, or external write.

## 4. State machines

### Optional variant

```text
draft → active → disabled → active
  │       │
  │       ├→ conflict → active|disabled|archived
  └→ archived
```

Rules:

- only draft may accept unrestricted allowed-path editing;
- publish validates base version, patch schema, approval, and certification;
- conflict cannot execute;
- reset disables/archives the variant and restores shared-base use;
- archived is terminal unless a separate restore policy is introduced.

### Composition profile

```text
draft → active → disabled → active
  └────────────→ archived
```

An active profile is immutable by version. Editing creates a new draft version.

### Adaptive proposal

```text
proposed → simulated → review_required → approved → canary → promoted
    │          │              │             │          ├→ rolled_back
    │          ├→ blocked     ├→ rejected   └→ expired └→ expired
    └→ dismissed|expired
```

### Effective runtime manifest

```text
previewed → ready|blocked → dispatched → completed|failed|partially_verified
```

A previewed manifest expires and cannot be promoted to dispatch after epoch/version drift.

### Data-use decision

```text
previewed → allowed|restricted|blocked → bound_to_manifest → consumed|expired|invalidated
```

Rules:

- `previewed` performs no effect and contains a bounded evidence snapshot;
- `allowed` or `restricted` requires all mandatory evidence and the most-restrictive resolution result;
- `blocked` records stable blocker codes and safe recovery actions;
- `bound_to_manifest` links one exact actor/context/resource/operation/purpose/provider/destination request;
- `consumed` does not authorize replay for another operation or destination;
- expiry or governance-epoch drift moves the decision to `expired` or `invalidated` before dispatch;
- a changed purpose, classification, consent, hold, region, provider/model, audience, or destination requires a new decision.

### Derived-data disposition run

```text
draft → previewed → review_required|ready → applying → completed|partially_completed|failed|cancelled
```

Apply requires a current preview checksum, exact authority, legal-hold revalidation, idempotency, approval where required, item-level outcomes, compensation/retry evidence, and same-cycle readback. Partial completion never reports the privacy or retention request as fully complete.

### Billing profile

```text
draft → previewed → review_required|ready → active → superseded|disabled|archived
```

An active profile version is immutable. Editing creates a new draft. Publication validates template/version, field allowlist, parent bounds, billing-account eligibility, approvals, conflicts, and commercial-epoch impact.

### Meter event

```text
received → validated → normalized → verified|rejected|review_required → aggregated → rated → billable|included|non_billable|disputed → settled
```

Correction or retraction creates a linked append-only event. Late events follow the registered meter-version policy and cannot rewrite a closed statement.

### Cost estimate

```text
draft → calculated → valid → reserved|expired|invalidated
```

A changed billing profile, meter/unit, rating/price, standing, owner/account, entitlement, or commercial epoch invalidates the estimate.

### Cost reservation

```text
pending → active → partially_consumed → settled
   └────────────→ released|expired|cancelled|invalidated
```

Rules:

- activation atomically claims capacity;
- consumption cannot exceed authorization;
- extension is explicit, bounded, idempotent, and policy checked;
- settlement or terminal release returns unused capacity exactly once;
- asset type, billing owner, account, profile, operation, manifest, and epoch cannot change after activation.

### Cost settlement

```text
pending_verification → ready|review_required|blocked → posting → posted|partially_posted|failed
```

A settlement becomes `posted` only after balanced ledger readback. `partially_posted` cannot be represented as complete and requires reconciliation/compensation.

### Refund, adjustment, or dispute

```text
requested → eligible|rejected|review_required → approved → posting → completed|failed
```

A posted result links a compensating transaction and never mutates the original settlement or meter event.

### Invoice

```text
draft → open → partially_paid|paid|past_due|disputed → closed|written_off
```

Invoice state does not rewrite usage or ledger history. Payment collection stores provider references/evidence without raw payment credentials.

### Model version

```text
discovered → registered → evaluating → certified → active
→ restricted → deprecated → blocked → retired
```

Emergency path:

```text
registered|evaluating|certified|active|restricted|deprecated → revoked
```

A revoked version cannot return to active without a new governed version/certification record. Historical run evidence remains immutable.

### Model evaluation run

```text
draft → queued → running → completed|partially_completed|failed|cancelled
→ reviewed → accepted|rejected
```

Completion requires immutable per-case/per-metric results, evaluator provenance, dataset/suite/version checksums, and no-secret execution evidence. Partial completion cannot certify a candidate unless the suite explicitly allows and threshold evidence remains sufficient.

### Model quality scorecard

```text
draft → review_required|ready → current → stale|drifting|failed|revoked|superseded
```

Publication requires accepted evaluation evidence, sample/confidence/freshness policy, required independent review, and exact candidate/context identity.

### Model readiness snapshot

```text
observed → ready|degraded|not_ready|unknown → stale|superseded
```

Readiness is time-bounded evidence, not a durable provider entitlement or credential grant.

### Model selection decision

```text
previewed → allowed|blocked|approval_required → commercially_reserved
→ bound_to_manifest → dispatched|expired|invalidated
```

Rules:

- `previewed` has no provider or commercial side effect;
- `allowed` requires a non-empty eligible candidate set and deterministic tie resolution;
- `commercially_reserved` binds candidate-specific estimate/reservation evidence;
- `bound_to_manifest` fixes selected candidate, fallback set, versions, epoch, and expiry;
- dispatch is single logical use for the exact operation unless DFR-006 explicitly authorizes replay/resume;
- contributing policy/evaluation/readiness/lifecycle/commercial drift invalidates before dispatch.

### Model deprecation run

```text
draft → previewed → review_required|ready → active
→ migrating → completed|partially_completed|failed|cancelled
```

Completion requires affected-asset readback, replacement certification, deadline/new-use enforcement, rollback/exception accounting, manifest invalidation, and historical evidence preservation.

### Durable Workflow

```text
requested → validated → admitted → running
running → waiting_timer|waiting_signal|waiting_dependency|awaiting_approval|backpressured
running → reconciling|compensating|cancel_requested|recovery_required
running|waiting_*|reconciling|compensating → completed|recovery_required
```

Outcome remains separate from lifecycle and may be success, success-with-warnings, partial-success, failure-no-effect, failure-with-effects, cancelled-no-effect, cancelled-with-effects, compensated, compensation-failed, indeterminate, or expired.

A terminal history event is immutable. Replay creates a linked Workflow rather than reopening the terminal Workflow.

### Runtime Activity

```text
scheduled → queued → leased → running → dispatching → verifying → succeeded
                   ├→ retry_scheduled → queued
                   ├→ reconciliation_required
                   ├→ cancelled_before_dispatch
                   └→ failed|lease_lost|recovery_required
```

Every attempt is immutable. A new retry creates a new attempt under the same Activity and stable logical Effect identity.

### Runtime Effect

```text
not_started → prepared → dispatching → accepted|committed
accepted|committed → verified
prepared|dispatching|accepted → confirmed_no_effect|outcome_unknown
committed|verified → compensating → compensated|compensation_failed
outcome_unknown → reconciling → confirmed_no_effect|committed|verified|outcome_unknown|recovery_required
```

The registered Effect Contract controls legal transitions and required evidence.

### Workflow timer

```text
scheduled → armed → fired|cancelled|expired|missed → processed
```

Firing is idempotent. A missed timer follows its registered recovery/transition policy and is not silently discarded.

### Workflow signal

```text
received → validated → accepted|rejected|expired|duplicate → processed
```

Duplicate processing returns the original logical transition result.

### Runtime recovery case

```text
open → investigating → action_previewed → reconciliation|compensation|replay|manual_resolution
→ resolved|partially_resolved|escalated|expired
```

Resolution requires itemized unresolved Effect readback. Closing a case cannot relabel unknown Effects as no-effect.

### Transport dead letter

```text
created → review_required|redrive_eligible|blocked → redriving → delivered|failed|quarantined|resolved
```

Redrive applies only to the transport artifact and cannot repeat the business Effect without independent Workflow authority.

## 5. Transaction boundaries

### Profile publish

One transaction must:

1. validate draft/version precondition;
2. validate operator registry and required layers;
3. create immutable active version;
4. update active pointer;
5. increment affected authority/configuration epoch;
6. write audit and same-cycle readback.

### Variant publish

One transaction must:

1. lock/check variant version;
2. verify base checksum and modifiable paths;
3. verify approval/certification state;
4. publish immutable patch version;
5. update active pointer;
6. invalidate affected manifests;
7. audit/read back.

### Billing-profile publish

One transaction must:

1. validate billing-account/context ownership and exact template/version;
2. validate every changed field against the customization registry and parent limits;
3. resolve model/mode/meter/rating/price compatibility and standing;
4. detect equal-ranked conflicts and required approvals;
5. publish an immutable active profile version and update its active pointer;
6. advance the commercial epoch and invalidate affected estimates/manifests;
7. write audit and same-cycle readback.

### Atomic cost reservation

One transaction must:

1. validate the current commercial decision, estimate, manifest, owner/account/profile/model, asset type, standing, and epoch;
2. lock or compare-and-swap every affected balance/quota/budget/included-unit/liability projection;
3. verify available capacity after posted settlements, active reservations, and committed liabilities;
4. create one idempotent reservation and itemized reservation lines;
5. decrement or mark reserved capacity exactly once;
6. record expiry, safe-stop/extension behavior, audit, and readback;
7. roll back all claims if any line cannot reserve.

### Meter ingestion and rating

Raw event ingestion atomically validates source, scope, meter/version/unit, scaled quantity, dimensions, deduplication key, and evidence before append. Rating reads immutable events/aggregates and writes derived billable records without mutating source measurements.

### Settlement and ledger posting

One logical posting boundary must:

1. lock/check reservation and settlement idempotency;
2. revalidate operation/manifest, owner/account/profile/model, commercial epoch, verified usage/outcome, price/rating, overage, and standing policy;
3. calculate customer charge and provider/internal cost separately;
4. create one balanced append-only ledger transaction and entries;
5. create invoice/statement references where applicable;
6. consume authorized reservation and release unused capacity exactly once;
7. persist item-level evidence, audit, and same-cycle balance/ledger readback;
8. expose partial failure as reconciliation-required rather than complete.

### Refund or adjustment posting

One transaction validates source settlement, net refundable amount, prior compensations, reason code, authority, approval, asset/currency, tax impact, and idempotency, then posts a balanced compensating transaction and readback. It never edits the source transaction.

### Model policy or profile publish

One transaction must:

1. validate exact registry/profile version, owner scope, authority, schema, and adapter allowlist;
2. reject raw endpoints, headers, executable expressions, secrets, unsupported candidate combinations, or weakened mandatory floors;
3. validate affected task/capability, evaluation, readiness, fallback, and commercial compatibility;
4. publish an immutable version and update only the authorized active pointer;
5. advance the model-governance epoch and invalidate affected decisions/manifests;
6. write audit and same-cycle readback.

### Evaluation result and scorecard publication

Evaluation ingestion atomically binds exact candidate, suite/dataset/prompt/tool/workflow/environment versions and immutable result evidence. Scorecard publication separately validates accepted runs, sample/confidence/freshness/threshold policy, zero-tolerance failures, separation of duties, and checksum before changing the current scorecard pointer.

### Model selection decision creation

One logical decision boundary must:

1. resolve exact Tenant/principal/context/operation and registered task/capability contract;
2. snapshot the candidate universe and contributing policy/data/commercial epochs;
3. evaluate every mandatory gate with explicit source/version/freshness evidence;
4. exclude ineligible candidates before any ranking;
5. normalize/rank eligible candidates with the registered optimization profile and deterministic tie-breaker;
6. construct an independently eligible fallback set with safe-boundary policy;
7. bind candidate-specific estimate/reservation evidence where required;
8. persist immutable candidate evidence, selected candidate, fallback, explanation, expiry, checksum, and readback;
9. roll back the logical decision if evidence or commercial binding is incomplete.

### Model incident restriction or revocation

One transaction validates exact provider/endpoint/model/version scope, reason, authority, approval, effective time, review/expiry, and evidence, then publishes the restriction, advances the epoch, invalidates affected decisions/manifests/caches, and records impacted resources without deleting historical runs.

### Model deprecation apply

One transaction validates a current impact-preview checksum, replacement eligibility/certification, affected-resource inventory, deadline, exceptions, rollback, shadow/canary evidence, and approvals before activating the deprecation run and invalidating new-use paths.

### Workflow creation

One transaction must:

1. validate registered Workflow type/definition, exact Tenant/principal/context, authority, manifest, deadlines, service class, policies, concurrency, and commercial evidence;
2. compare-and-create the scoped idempotency identity and request checksum;
3. create the Workflow root record and first immutable history event;
4. create required reservation/dependency references without executing Activities;
5. insert the initial Outbox record in the same transaction;
6. return the existing logical Workflow for same-key same-checksum reuse;
7. roll back all writes on conflict or incomplete evidence.

### Workflow decision append

One deterministic decision boundary reads a contiguous history sequence and exact compatible definition version, computes commands, then atomically appends new decision events, timers/signals/dependencies/Activity schedules, projection updates, and Outbox records using an expected-history-sequence precondition. Concurrent decisions cannot both append at the same sequence.

### Activity claim and completion

Claim atomically checks queue eligibility, deadlines, authority/epoch, concurrency/admission, prior terminal state, and lease availability, then issues one lease with a monotonic fencing token and records an attempt.

Completion validates the same live lease/fencing token, immutable attempt identity, Effect evidence, result schema/checksum, and deadline before appending completion/failure history and releasing queue/concurrency capacity. A stale owner cannot commit.

### Effect dispatch and verification

Before dispatch, one local transaction validates the Effect Contract, stable Effect/idempotency identity, manifest, data/model/commercial readiness, retry budget, deadline, lease/fencing, and records `dispatching` plus immutable dispatch evidence.

Provider execution is external to the transaction. Subsequent acknowledgement, reference, verification, reconciliation, or failure evidence is appended idempotently. A local failure after provider dispatch cannot erase uncertainty or automatically mark no-effect.

### Reconciliation result

One transaction binds the exact Effect/dispatch, reconciliation policy/version, lookup keys, evidence, and outcome. Only `confirmed_no_effect` or contract-proven idempotency can authorize retry; `confirmed_effect` advances verification/completion; unknown/conflicting outcomes create or update recovery.

### Compensation scheduling and completion

Scheduling identifies committed reversible Effects, registered compensation handlers, dependency-safe order, authority/approval, deadlines, and idempotency. Completion appends a new compensation Effect and verification evidence without mutating source Effect/history. Failure itemizes unresolved Effects and creates recovery.

### Checkpoint and replay

Checkpoint creation atomically binds a verified history sequence, projection checksum, committed Effects, remaining work, manifest/version vector, sensitivity, expiry, and replay policy.

Replay apply validates a current no-effect preview checksum, source checkpoint, current authority/manifest/policies/reservations, known Effects, safe remaining Activities, approvals, and new idempotency identity, then creates a new linked Workflow. It never edits the source Workflow.

### Outbox delivery and Inbox processing

Outbox claim uses lease/fencing and immutable event identity. Consumer processing atomically checks `consumer_key + event_id`, payload checksum, applies its local logical Effect, and records Inbox completion. Duplicate same-checksum delivery returns the prior result; checksum mismatch blocks.

### Transport dead-letter redrive

Redrive validates the exact transport artifact, schema/consumer compatibility, current authority, prior attempts, no business-Effect duplication, and preview checksum before creating a new delivery attempt. It cannot invoke a Workflow replay or external Effect directly.

### Dispatch

The runtime transaction boundary covers internal execution planning and evidence, not the entire external provider operation. It must atomically bind the execution to one valid manifest before provider dispatch and later append result/readback evidence idempotently.

## 6. Consistency model

- canonical registries and tenant authority use MySQL-primary as source of truth;
- catalog and effective views may be eventually refreshed but cannot grant from stale data;
- cached allows require current epoch/version match;
- stale cache may be used only for safe deny or unavailable display, never for a new allow;
- provider state is externally consistent and verified through bounded readback;
- dashboards label observation time and missing evidence.

## 7. Domain events

Suggested events:

```text
shared_asset_version_published
shared_asset_visibility_changed
context_graph_changed
context_authority_epoch_advanced
composition_profile_published
composition_profile_selection_changed
user_runtime_preferences_changed
asset_variant_published
asset_variant_conflict_detected
connection_readiness_changed
installation_certification_changed
approval_hold_changed
effective_runtime_manifest_created
execution_outcome_observed
adaptive_proposal_created
adaptive_experiment_started
adaptive_experiment_rolled_back
platform_promotion_candidate_created
data_classification_changed
processing_purpose_policy_changed
consent_granted
consent_withdrawn
data_residency_policy_changed
retention_assignment_changed
legal_hold_created
legal_hold_released
data_subject_request_created
data_subject_request_item_completed
data_lineage_changed
derived_data_disposition_started
derived_data_disposition_completed
provider_data_processing_profile_changed
model_data_use_policy_changed
data_use_decision_created
data_governance_epoch_advanced
cross_tenant_learning_policy_changed
cross_tenant_learning_run_blocked
billing_account_changed
billing_owner_assignment_changed
commercial_relationship_changed
billing_model_registry_changed
collection_mode_registry_changed
billing_profile_published
billing_profile_selection_changed
usage_meter_registered
usage_meter_version_changed
usage_meter_event_received
usage_meter_event_corrected
usage_verification_completed
billable_usage_record_created
rating_model_changed
price_book_version_published
commercial_entitlement_decision_created
runtime_cost_estimate_created
runtime_cost_reservation_created
runtime_cost_reservation_extended
runtime_cost_reservation_released
runtime_cost_settlement_posted
commercial_ledger_transaction_posted
refund_adjustment_posted
usage_dispute_opened
invoice_opened
payment_collection_result_recorded
commercial_policy_epoch_advanced
model_task_class_changed
model_capability_profile_changed
model_provider_endpoint_profile_changed
model_version_registered
model_alias_resolution_changed
model_inference_profile_changed
model_context_policy_changed
model_optimization_profile_changed
principal_model_preference_changed
model_evaluation_suite_changed
model_evaluation_run_completed
model_quality_scorecard_published
model_readiness_snapshot_published
model_selection_decision_created
model_fallback_set_created
model_drift_detected
model_incident_restriction_created
model_incident_restriction_released
model_deprecation_run_started
model_deprecation_run_completed
model_version_restricted
model_version_revoked
model_governance_epoch_advanced
runtime_workflow_requested
runtime_workflow_validated
runtime_workflow_admitted
runtime_workflow_decision_appended
runtime_workflow_completed
runtime_workflow_recovery_required
runtime_workflow_cancel_requested
runtime_workflow_signal_received
runtime_workflow_timer_scheduled
runtime_workflow_timer_fired
runtime_activity_scheduled
runtime_activity_claimed
runtime_activity_lease_lost
runtime_activity_retry_scheduled
runtime_activity_completed
runtime_effect_prepared
runtime_effect_dispatch_started
runtime_effect_reference_observed
runtime_effect_verified
runtime_effect_outcome_unknown
runtime_effect_reconciliation_started
runtime_effect_reconciliation_completed
runtime_effect_compensation_started
runtime_effect_compensation_completed
runtime_checkpoint_created
runtime_replay_previewed
runtime_replay_started
runtime_recovery_case_created
runtime_recovery_case_resolved
runtime_outbox_event_created
runtime_inbox_event_processed
runtime_transport_dead_letter_created
runtime_transport_dead_letter_redriven
runtime_concurrency_backpressure_applied
runtime_governance_epoch_advanced
```

Events contain IDs, versions, tenant scope, reason codes, and checksums; never secret payloads.
