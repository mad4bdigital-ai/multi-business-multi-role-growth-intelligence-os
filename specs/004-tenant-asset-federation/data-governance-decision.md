# DFR-003 — Layered Purpose-Bound Data Governance

## Status

**Approved design. Implementation is not authorized.**

The platform adopts layered, purpose-bound data governance. Possessing access authority is necessary but never sufficient for data use. Every collection, read, transformation, inference, transfer, retention, export, sharing, learning, correction, restriction, or deletion operation must also satisfy the effective classification, registered purpose, lawful-basis or consent, residency, retention, legal-hold, provider/model, destination, and most-restrictive applicable policy constraints.

No runtime enforcement, schema migration, provider call, external write, deletion, or production cutover is authorized by this decision document.

## 1. Eligibility equation

```text
Access authority
+ allowed registered purpose
+ permitted data classification
+ valid lawful basis / consent where required
+ residency and transfer eligibility
+ retention and legal-hold compatibility
+ provider/model data-use eligibility
+ exact operation, audience, environment, and destination
= eligible data use
```

If any required evidence is missing, stale, conflicting, revoked, or ambiguous, consequential use fails closed.

## 2. Policy resolution order

```text
Platform hard bounds
→ jurisdiction and regulatory requirements
→ Tenant data-governance policy
→ Brand data policy
→ Workspace purpose and environment policy
→ delegated Department/Group restrictions
→ resource and data-class policy
→ subject consent/preferences where applicable
→ exact operation, provider, model, region, audience, and destination
```

The most restrictive applicable rule wins. Lower scopes may tighten policy but cannot weaken Platform, jurisdiction, Tenant, mandatory Brand, legal-hold, security, provider-contract, or fail-closed restrictions.

## 3. Classification model

Classification is multi-dimensional.

### Sensitivity tier

```text
public
internal
confidential
restricted
highly_restricted
```

### Category attributes

Initial attributes include:

```text
personal_data
special_category_personal_data
customer_content
employee_data
financial
payment
health
legal
credential_or_secret
intellectual_property
location
communications
behavioral
biometric
children_data
model_input_restricted
regulated_record
```

A resource has one sensitivity tier and may have multiple category attributes. The highest applicable restriction governs each operation. Classification override cannot downgrade credentials, secrets, legal holds, or mandatory regulated categories.

## 4. Registered processing purposes

Every consequential data operation declares a registered purpose. Initial purposes include:

```text
service_delivery
customer_support
security
fraud_prevention
billing
analytics
marketing
legal_compliance
model_inference
model_evaluation
personalization
product_improvement
aggregate_learning
export
migration
backup_and_recovery
```

Purpose records define allowed classifications, operations, audiences, recipients, providers/models, regions, lawful basis, consent requirements, retention profile, derived-data eligibility, approval requirements, and opt-out behavior. Purpose reuse is forbidden when the actual use materially differs from the registered purpose.

## 5. Lawful basis and consent

Supported basis types include:

```text
contract
legal_obligation
legitimate_business_use
explicit_consent
vital_interest
public_task
tenant_instruction
user_request
```

Consent is purpose-specific, category-specific where required, versioned, timestamped, audience/provider aware where applicable, and revocable. Consent is never inferred from unrelated acceptance and cannot authorize a use prohibited by Platform, law, security, contract, or Tenant policy.

Consent withdrawal invalidates future matching use and creates a derived-data disposition plan, subject to legal holds and mandatory retention.

## 6. Residency and transfer

The effective policy may constrain:

```text
allowed_storage_regions
allowed_processing_regions
allowed_model_regions
allowed_provider_regions
allowed_backup_regions
allowed_export_destinations
cross_border_transfer_mechanisms
```

A provider or model fallback is ineligible if it violates residency, transfer, retention, provider-training, deletion, or contract requirements. Runtime must block rather than silently select a non-compliant fallback.

## 7. Retention and disposition

Retention resolves from:

```text
Data class
+ processing purpose
+ Tenant / Brand / Workspace policy
+ artifact or record type
+ source contract
+ jurisdiction
+ legal hold
+ subject request
```

Each retained object records its retention profile/version, start event, expiry or review date, legal-hold state, disposition action, and last decision evidence.

Allowed disposition actions include:

```text
delete
anonymize
aggregate
archive
rebuild_without_subject
restrict
retain_under_hold
retain_minimal_tombstone
```

Retention expiry never overrides a legal hold. Legal hold is an independent overlay and grants no read authority.

## 8. Privacy and data-subject requests

Supported request types include:

```text
access
export
correction
restriction
erasure
objection
consent_withdrawal
```

A governed request discovers primary and derived data, validates identity and authority, evaluates legal holds, exemptions, retention obligations, provider copies, indexes, backups, and dependent artifacts, then records completion evidence.

## 9. Derived-data lineage and propagation

The platform maintains provenance and disposition relationships for:

```text
raw records
normalized records
summaries
embeddings
vector indexes
Agent memory
recommendation evidence
model evaluation samples
analytics outputs
aggregates
artifacts
provider copies
backups
```

When source data is corrected, restricted, erased, retracted, or made ineligible, each dependent object is classified for delete, rebuild, invalidate, retract, anonymize, retain as aggregate, retain under legal hold, or retain minimal non-content audit evidence.

Derived data is not assumed anonymous merely because it is transformed.

## 10. AI and model data-use controls

Policy fields include:

```text
may_send_to_external_model
may_use_for_inference
may_retain_prompt
may_retain_response
may_use_for_evaluation
may_use_for_fine_tuning
may_use_for_cross_tenant_learning
may_store_embeddings
may_store_agent_memory
may_allow_provider_training
required_zero_retention_mode
```

Restricted or sensitive data defaults to denied for external training, fine-tuning, cross-Tenant learning, and provider retention unless an explicit compatible policy and contract allow it.

Each provider/model candidate is checked for region, retention, provider training, subprocessors, contract/certification, security posture, deletion capability, and purpose compatibility.

## 11. Cross-Tenant learning

Raw cross-Tenant content sharing or learning is forbidden.

Only privacy-governed aggregate evidence may be eligible when all conditions hold:

- registered purpose;
- Tenant participation policy and opt-out where applicable;
- no raw customer-content exposure;
- minimum cohort threshold;
- contribution and dominance limits;
- sensitive-trait and re-identification safeguards;
- compatible jurisdiction and residency policy;
- provenance, quality, and fairness evidence;
- no Tenant-specific example exposed to another Tenant.

Cross-Tenant aggregate learning never grants access to another Tenant's data.

## 12. Data-use decision resource

Each consequential operation produces or references an immutable decision containing:

- actor and active context;
- Tenant, Brand, Workspace, Department, and Group where applicable;
- resource/data identifiers;
- classification and source versions;
- declared purpose;
- lawful basis and consent evidence;
- residency, transfer, audience, and destination result;
- retention and legal-hold result;
- provider/model eligibility;
- applicable policies and most-restrictive operator;
- allow, block, or restrict decision;
- expiry and governance version vector;
- explanation and recovery actions;
- no-secret checksum.

The Effective Runtime Manifest binds this data-use decision and version vector.

## 13. Proposed authorities

```text
data_classification_registry
data_classification_assignments
processing_purpose_registry
purpose_data_class_rules
lawful_basis_registry
consent_records
consent_events
data_residency_policies
data_transfer_policies
retention_profiles
retention_assignments
legal_holds
legal_hold_scopes
data_subject_requests
data_subject_request_items
data_lineage_edges
derived_data_disposition_runs
model_data_use_policies
provider_data_processing_profiles
data_use_decisions
data_governance_epochs
cross_tenant_learning_policies
cross_tenant_learning_runs
```

Specialized domain tables retain their data. Governance registries describe eligibility, lineage, policy, and disposition without becoming an unrestricted EAV store.

## 14. API direction

```text
GET  /tenant/data-governance/classifications
POST /tenant/data-governance/classification-assignments
GET  /tenant/data-governance/purposes
POST /tenant/data-governance/purpose-policies
GET  /tenant/data-governance/residency-policies
POST /tenant/data-governance/residency-policies
GET  /tenant/data-governance/retention-profiles
POST /tenant/data-governance/retention-profiles
POST /tenant/legal-holds
POST /tenant/legal-holds/{holdId}/release
POST /tenant/data-subject-requests
GET  /tenant/data-subject-requests/{requestId}
POST /tenant/data-use-decisions/preview
GET  /tenant/data-use-decisions/{decisionId}
POST /tenant/derived-data-disposition-runs/preview
POST /tenant/derived-data-disposition-runs
GET  /tenant/model-data-use-policies
POST /tenant/model-data-use-policies
GET  /tenant/cross-tenant-learning-policy
PATCH /tenant/cross-tenant-learning-policy
```

Previews perform no provider call, deletion, transfer, model execution, or external write. Retryable mutations require idempotency, version preconditions, object-level authorization, audit, approvals where applicable, and same-cycle readback.

## 15. Runtime resolution sequence

1. Resolve actor and active Tenant/Brand/Workspace context.
2. Validate access authority.
3. Resolve resource classification and lineage.
4. Validate declared registered purpose.
5. Resolve lawful basis and consent evidence.
6. Resolve jurisdiction, residency, transfer, audience, destination, and provider constraints.
7. Resolve retention and legal-hold constraints.
8. Evaluate AI/model data-use fields.
9. Apply the most restrictive rule.
10. Persist or attach the data-use decision.
11. Bind governance versions into the Effective Runtime Manifest.
12. Revalidate before consequential dispatch, export, deletion, or provider submission.

## 16. Stable blocking conditions

```text
data_classification_missing
processing_purpose_missing
processing_purpose_not_allowed
lawful_basis_missing
consent_required
consent_revoked
residency_not_allowed
cross_border_transfer_not_allowed
provider_data_use_incompatible
model_data_use_not_allowed
retention_policy_missing
legal_hold_conflict
data_subject_restriction_active
derived_data_disposition_required
cross_tenant_raw_data_forbidden
cross_tenant_cohort_too_small
data_governance_version_changed
```

## 17. Hard invariants

- Access authority alone never authorizes processing.
- Every consequential data use declares a registered purpose.
- The most restrictive applicable policy wins.
- Lower scopes cannot weaken higher mandatory controls.
- Legal hold grants no read authority.
- Credentials and secrets cannot be downgraded by classification override.
- External provider/model fallback must remain policy compatible.
- Raw cross-Tenant data learning is forbidden.
- Derived data retains lineage and disposition obligations.
- Retention expiry does not override legal hold.
- Consent does not override Platform, legal, security, or contract prohibitions.
- Data-use decisions are versioned, explainable, auditable, and fail closed when evidence is missing.

## 18. Acceptance examples

- CRM read access does not permit sending customer records to an external model when purpose or provider policy forbids it.
- A compliant regional zero-retention model remains eligible while a preferred but incompatible model is excluded.
- Marketing use blocks when required consent or another valid basis is absent.
- Consent withdrawal invalidates future matching use and creates a disposition plan for derived data.
- Legal hold prevents deletion but grants no read access.
- Erasure discovers embeddings, Agent memory, indexes, summaries, artifacts, provider copies, and backups.
- A Personal Workspace cannot receive company restricted data through an unauthorized copy.
- Raw Tenant content is never included in cross-Tenant learning.
- Aggregate learning blocks when cohort, participation, residency, or re-identification controls fail.
- Missing classification or purpose evidence blocks consequential execution.
- Governance-policy change increments the governance epoch and invalidates stale manifests.

## 19. Final decision

> **Layered Purpose-Bound Data Governance.** Access authority is necessary but insufficient. Every data operation must satisfy classification, registered purpose, lawful basis or consent, residency and transfer, retention, legal hold, provider/model data-use, audience, destination, and the most restrictive applicable Platform, jurisdiction, Tenant, Brand, Workspace, resource, and subject policy. Consequential use fails closed when required evidence is absent, stale, conflicting, revoked, or ambiguous.
