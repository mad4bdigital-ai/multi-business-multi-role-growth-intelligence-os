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

Immutable, no-secret attribution record combining context, authority, composition, assets, variants, preferences, readiness, and the exact data-use decision/version vector.

It is a derived record, not a mutation authority.

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
+ normalized request + resolver version
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
```

Events contain IDs, versions, tenant scope, reason codes, and checksums; never secret payloads.
