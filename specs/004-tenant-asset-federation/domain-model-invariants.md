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
```

Events contain IDs, versions, tenant scope, reason codes, and checksums; never secret payloads.
