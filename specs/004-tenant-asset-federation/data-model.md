# Data Model

## 1. Modeling principles

1. Shared canonical assets remain in their existing source tables.
2. Ordinary tenant or user use creates bindings and preferences, not copies.
3. Optional variants are created only for explicit customization.
4. Context topology, roles, and resource authority reuse Dynamic Container Authority.
5. Credentials remain in existing connection/vault authorities.
6. Adaptation records proposals and experiments, never hidden authority mutation.
7. New schema is additive and can be disabled without deleting shared assets or existing grants.

## 2. Reused authorities

### Shared definitions

- `agents`
- `agent_skills`
- `workflows`
- `actions`
- `app_integrations`
- `plugins`
- `logic_definitions`
- engine and knowledge registries
- `execution_policies`
- `platform_engine_policy_registry`
- `platform_engine_policy_rules`

### Context and authority

- `containers`
- `container_relationships`
- `container_closure`
- `container_classifications`
- `container_role_assignments`
- `container_resource_bindings`
- `container_resource_dimension_registry`
- `container_effective_context_ledger`
- `container_authority_epochs`

### Runtime readiness

- `connected_systems`
- `connections`
- `user_app_connections`
- `installations`
- action grants, resource grants, approvals, quotas, and certification registries

### Existing preference, variant, and learning evidence

- `user_agent_surface_preferences`
- dashboard preference tables
- `platform_package_variants`
- `platform_package_variant_patches`
- `platform_variant_edit_sessions`
- `adaptation_records`
- `tenant_growth_recommendation_events`
- `intent_resolutions`
- execution and result evidence tables

## 3. Shared catalog projection

### `platform_asset_catalog_registry`

A normalized registry that points to canonical assets without duplicating their full payload.

Key fields:

- `asset_ref` — stable global ID;
- `asset_type`;
- `canonical_source_table`;
- `canonical_source_key`;
- `canonical_version_ref`;
- `base_checksum`;
- `tenant_visibility`: `public_to_tenants | entitled | managed_only | platform_internal`;
- `customization_policy`: `none | preference_only | patchable | extend_only`;
- `modifiable_path_profile_key`;
- `risk_class`;
- `required_capability_keys_json`;
- `required_connection_profile_key`;
- `status` and timestamps.

The catalog is an identity and policy projection. Canonical content remains in its source table.

## 4. Composition authorities

### `context_composition_profiles`

Stores reusable or user-selected runtime composition profiles.

Key fields:

- `profile_id`;
- `tenant_id`;
- `profile_key`;
- `display_name`;
- `owner_principal_type`: `platform | tenant | user | group`;
- `owner_principal_id` nullable for platform templates;
- `target_container_id` nullable;
- `profile_class`: `template | custom | adaptive_candidate`;
- `status`: `draft | active | disabled | archived`;
- `version`;
- `created_by`, `approved_by`, timestamps.

### `context_composition_profile_rules`

One row per dimension or policy family.

Key fields:

- `profile_rule_id`;
- `profile_id`;
- `dimension_key`;
- `policy_family` nullable;
- `composition_mode`: `guarded_union | strict_intersection | deny_wins | minimum | maximum | nearest_replace | priority_replace | stable_topological_merge | ordered_append_dedupe | bounded_weighted_merge`;
- `required_layers_json`;
- `layer_precedence_json`;
- `missing_layer_behavior`: `block | ignore_optional`;
- `conflict_behavior`: `block | require_review`;
- `conditions_json`;
- `status` and version.

The dimension registry remains the authority for which modes are allowed. Profile rules can choose only an allowed subset.

### `principal_composition_profile_selections`

Selects a profile for one principal and context.

- `selection_id`;
- `tenant_id`;
- `principal_type` and `principal_id`;
- optional `container_id`, `workspace_id`, `brand_key`, `business_activity_type_key`, `role_template_key`;
- `dimension_key` or `policy_family`;
- `profile_id`;
- priority, validity, status, version.

Specific selections outrank broader selections only where the registered operator allows replacement. They never outrank mandatory policy.

## 5. Typed policy atom registry

### `policy_field_semantics_registry`

Defines how each policy field may compose.

- `policy_family`;
- `field_key`;
- `value_schema_json`;
- `semantic_type`;
- `default_operator`;
- `allowed_operators_json`;
- `safety_polarity`: `deny_wins | true_wins | false_wins | neutral`;
- `mandatory_floor_json`;
- `user_customizable`;
- `variant_customizable`;
- `explanation_template`;
- status and version.

### `scoped_policy_atoms`

Normalized scoped policy values linked to platform policy sources or future tenant-local policy records.

- `atom_id`;
- `tenant_id` nullable only for platform atoms;
- `policy_family`, `field_key`;
- `source_table`, `source_pk`, `source_version`;
- `source_layer`;
- optional container, role, and user scope;
- `value_json`;
- `priority`;
- mandatory flag, validity, status, checksum.

This may initially be implemented as bridge views before becoming a mutation surface.

## 6. User preference authority

### `user_runtime_preference_profiles`

A versioned no-secret profile for one user.

- tenant/user identity;
- locale, language, explanation depth, output and notification preferences;
- preferred shared asset refs and rankings;
- default composition profile selections;
- autonomy and review preferences within registered limits;
- adaptation consent and visibility controls;
- version, status, checksum, timestamps.

Preference payloads use a registered schema and explicit allowlist. Unknown keys are rejected.

## 7. Optional generic variants

Existing package variants remain valid for package assets. A generic layer is required for non-package shared assets.

### `platform_asset_variants`

- `variant_id`;
- `tenant_id`;
- `base_asset_ref`;
- `base_version_ref` and checksum;
- `owner_scope_type`: `tenant | workspace | brand | business_activity | role | user`;
- `owner_scope_ref`;
- `variant_key`;
- `display_name`;
- `status`: `draft | active | disabled | archived | conflict`;
- `current_version`;
- `created_by`, timestamps.

### `platform_asset_variant_patches`

- `patch_id`;
- `variant_id`;
- `variant_version`;
- `patch_type`: `append | override | remove | disable | reorder | policy_tightening`;
- `target_path`;
- `patch_json`;
- `risk_class`;
- approval and certification state;
- checksum and provenance.

Patches are rejected when they target non-modifiable or mandatory fields.

### `platform_asset_variant_upgrade_runs`

Stores preview/apply evidence for a shared base update, including changed paths, conflicts, proposed checksum, approvals, and readback.

## 8. Effective runtime manifest

### `effective_runtime_manifest_ledger`

Extends—not replaces—`container_effective_context_ledger` with a full no-secret runtime manifest.

Key fields:

- `manifest_id`;
- linked `container_resolution_id`;
- tenant, principal, request, session, and target context;
- authority epoch and registry snapshot hash;
- composition profile selections and versions;
- policy atom source IDs and typed operator results;
- selected shared asset refs and versions;
- selected variants and patch checksums;
- preference profile version;
- connection/installation/certification readiness summaries;
- approvals, quotas, and blocking codes;
- final decision;
- manifest checksum;
- expiry and timestamps;
- `provider_call_made`, `credential_payload_read`, `secrets_included` flags.

This manifest is the attribution key for execution outcomes and adaptive learning.

## 9. Adaptive growth authorities

### `adaptive_change_proposals`

- proposal identity and target scope;
- proposal class A–E;
- current and proposed state summaries;
- objective and expected impact;
- evidence references and confidence;
- risk and required approval;
- simulation plan, measurement plan, rollback plan;
- status and expiry.

### `adaptive_simulation_runs`

- proposal and corpus version;
- baseline/proposed manifest summaries;
- policy, readiness, cost, latency, and predicted outcome deltas;
- guardrail results;
- reproducible checksum;
- no provider write.

### `adaptive_experiments`

- exact cohort scope;
- baseline and treatment refs;
- immutable start snapshot;
- success and guardrail metrics;
- minimum sample and measurement window;
- status, rollback trigger, approval evidence.

### `adaptive_outcome_measurements`

- experiment/proposal/manifest links;
- metric key, value, confidence, observed window;
- attribution quality and evidence refs.

### `platform_asset_promotion_candidates`

Stores privacy-reviewed candidates for a new or improved shared asset. Promotion remains a separate admin certification and release workflow.

## 10. Bridge views

- `v_shared_asset_catalog_effective`
- `v_context_composition_profile_effective`
- `v_policy_atoms_effective_candidates`
- `v_optional_variants_effective_candidates`
- `v_principal_runtime_preferences_effective`
- `v_contextual_authority_bridge_parity`
- `v_runtime_policy_bridge_parity`
- `v_effective_runtime_readiness`
- `v_adaptive_proposal_readiness`

## 11. Dynamic Blueprint and Layer Inheritance authorities

### `platform_layer_type_registry`

Defines every inheritable or instantiable layer family and its canonical source.

Key fields:

- `layer_type_key`;
- canonical source table/key;
- supports Blueprints, runtime instances, hierarchy, multi-parent, variants, and resource bindings;
- allowed parent/child layer types;
- default and allowed merge strategies;
- modifiable-path profile;
- risk class, version, and status.

Initial layer types include:

```text
department
group
role
member_profile
agent_profile
business_activity
knowledge_tree
skill_set
workflow_set
policy_set
app_set
plugin_set
action_set
tool_set
engine_set
logic_set
graph_fragment
dashboard_profile
metric_set
validator_set
prompt_profile
output_template
```

### `platform_layer_relationship_type_registry`

Defines typed relationships such as `contains`, `inherits_from`, `references`, `requires`, `conflicts_with`, `replaces`, `supersedes`, `compatible_with`, `managed_by`, and `assigned_to`, including source/target type constraints, direction, transitivity, cardinality, conflict behavior, and version.

### `platform_layer_blueprints`

- Blueprint ID/key and layer type;
- platform or Business-Type owner;
- Business-Type key where applicable;
- canonical template source reference;
- required/recommended/optional adoption class;
- version/checksum/status;
- compatibility and entitlement conditions;
- default settings profile;
- customization and upgrade policy;
- risk/certification metadata.

### `platform_layer_blueprint_relationships`

Stores Blueprint hierarchy and dependency edges with typed relationship, source/target Blueprint versions, conditions, priority, validity, and provenance.

### `platform_layer_blueprint_closure`

Stores bounded transitive closure for Blueprint hierarchy, dependency traversal, cycle detection, impact analysis, deterministic checksums, and fast preview.

### `platform_layer_blueprint_resource_bindings`

Links Blueprints to canonical shared resources without copying them.

Binding purposes include:

```text
required
recommended
allowed
default
denied
validator
fallback
```

Each row stores resource dimension/reference, effect, priority, conditions, inheritance behavior, validity, and provenance.

### `brand_business_type_bindings`

- tenant and Brand;
- Business Type key;
- binding role: primary, secondary, specialization, seasonal, or experimental;
- classification source/confidence;
- inheritance profile reference;
- priority, effective dates, status, approval, and provenance.

The binding grants no execution authority.

### `layer_inheritance_profiles`

- tenant and Brand;
- profile key/version/status;
- contributing Business Types and priorities;
- required/recommended/optional Blueprint selection policy;
- per-layer merge strategy;
- exclusion, replacement, pin, upgrade, and auto-adoption behavior;
- local override policy;
- publisher, approval, checksum, and timestamps.

### `layer_inheritance_profile_rules`

Stores one rule per layer family, Blueprint family, Business Type, condition, or conflict group, including merge mode, required layers, allowed exclusions/replacements, upgrade channel, and block/review behavior.

### `layer_inheritance_runs`

Immutable preview/apply evidence:

- input Brand/Business-Type/profile versions;
- eligible, selected, excluded, replaced, conflicted, and blocked Blueprints;
- proposed instance/resource changes;
- impact on members, agents, roles, grants, schedules, approvals, variants, artifacts, cost, and authority epochs;
- status, approval, checksum, and readback.

### `layer_inheritance_conflicts`

Typed conflict records for equivalent, overlapping, incompatible, stale, ambiguous, or locally patched Blueprints, with candidate resolutions and decision evidence.

### `brand_layer_instances`

Generic projection of Brand-scoped operational instances while specialized domain tables retain full fields.

- layer instance ID;
- tenant and Brand;
- layer type;
- canonical runtime table/key;
- source mode: inherited, local, imported, or promoted;
- source Blueprint/version;
- inheritance profile/version;
- lifecycle status;
- effective settings checksum;
- local override/variant reference;
- authority epoch and timestamps.

### `brand_layer_instance_relationships`

Stores typed operational Brand hierarchy/dependency edges between layer instances.

### `brand_layer_instance_closure`

Stores Brand-scoped transitive closure, depth, path/version checksum, source relationships, and validation evidence.

### `brand_layer_resource_bindings`

Stores effective inherited or local references from Brand layer instances to canonical shared resources, including purpose, effect, priority, conditions, source Blueprint, profile version, local override, and status.

### `brand_layer_override_patches`

Sparse bounded Brand, Department, Group, Role, or Principal-profile overrides against inherited settings or resource bindings. Protected authority, credential, audit, and mandatory-policy paths remain non-modifiable.

### `layer_inheritance_upgrade_runs`

Compares new Blueprint versions with active instances and local patches, classifying each change as auto-safe, review-required, conflict, blocked, pinned, superseded, or revoked.

### Specialized Brand organization authorities

- `brand_departments`;
- `brand_department_relationships` and `brand_department_closure`;
- `brand_department_memberships`;
- `brand_groups`;
- `brand_group_relationships` and `brand_group_closure`;
- `brand_group_memberships`;
- scoped Role/member/Agent profile authorities;
- `principal_authority_settings` and `principal_authority_epochs`.

These rows reference Business-Type Blueprints and shared assets; they do not duplicate shared definitions.

## 12. Extended authority-plane data model

The following are proposed authorities or bridge contracts. They are not an instruction to create every table in one migration. Existing canonical tables are reused whenever they already own the behavior.

### Identity and organization

- `principal_registry` — user, agent, service, and group identity, tenant ownership, assurance, status, and recertification.
- `principal_group_memberships` — bounded nested group membership with validity and cycle protection.
- `principal_delegation_chains` — exact delegated scope, operations, source authority, expiry, and maximum depth.
- `separation_of_duties_rules` — incompatible requester, approver, executor, and publisher combinations.

### Scoped invitation onboarding and personal contexts

Existing `users`, `invitations`, `memberships`, `workspace_resource_grants`, and Google authentication remain migration inputs. The target adds:

- `user_identities` — global user to provider identity links using provider subject, verified email, assurance, status, and last-use evidence; no provider access/refresh token values;
- `invitation_scope_bindings` — immutable typed Tenant, Brand, Workspace, Department, Group, Role/profile, workflow, Agent, asset, capability, and future-resource scope rows with permission/effect, conditions, expiry, source authority, and checksum;
- `invitation_delivery_events` — queued/sent/failed/viewed delivery evidence without raw token retention;
- `invitation_acceptance_runs` — identity evidence, invitation checksum, transactional membership/grant/assignment IDs, context issued, readback checksum, and idempotency;
- `personal_account_profiles` — optional one-per-user personal-account Tenant policy, status, plan, creation source, and lifecycle;
- `active_user_contexts` — short-lived selected Tenant/Brand/Workspace/Department/Group/Role context, source membership/grant versions, authority epoch, expiry, and revocation;
- `context_switch_events` — requested/previous/new context, validation outcome, source versions, and audit evidence.

Target enum additions include `personal_account` for Tenant type and `personal` for Workspace type. Invitation tokens are stored only as hashes with single-use and expiry evidence.

### Tenant creation and Workspace boundary

Existing `tenants`, `memberships`, `workspace_registry`, and `workspace_resource_grants` remain migration inputs. The target adds or extends:

- `tenant_type_registry` — registered Tenant types, eligibility, verification, default templates, federation eligibility, plan compatibility, and lifecycle policy;
- `tenant_creation_policies` — Platform/Tenant-creator policy, required verification, regions, plan rules, allowed types, fraud/risk checks, and hard bounds;
- `tenant_creation_entitlements` — per-user/plan maximum owned Tenants, allowed types, trial behavior, status, validity, and source subscription;
- `tenant_provisioning_runs` — asynchronous requested/provisioning/active/failed/cancelled state, requested type/name/region/plan, owner, idempotency, approval/risk evidence, created resource IDs, and readback;
- `tenant_owner_assignments` — canonical versioned owner Principal, ownership type, status, validity, transfer source, verification/approval, and checksum;
- `workspace_type_registry` — `personal`, `brand`, `project`, `campaign`, `operations`, `sandbox`, plus future types with allowed binding and execution behavior;
- extend `workspace_registry` with owning Tenant, workspace type, environment, visibility, lifecycle, primary Brand where applicable, provisioning source, settings profile, and authority epoch;
- `workspace_brand_bindings` — one primary and optional additional Brand bindings within the same Tenant;
- `workspace_department_bindings` — Brand Department participation and purpose;
- `workspace_group_bindings` — Brand Group participation and purpose;
- `workspace_activity_bindings` — eligible Business Activities and workflow/task contexts;
- `workspace_context_policies` — multi-Brand, environment, data, Agent, connection, scheduling, and resource behavior within parent bounds;
- `workspace_authority_epochs` — invalidation after Workspace, binding, membership, grant, environment, or lifecycle changes;
- `workspace_deletion_runs` — preview, dependency disposition, approval, archive/delete actions, evidence, and rollback/readback.

A Workspace row always has one immutable owning `tenant_id`. Bindings never create cross-Tenant authority and are not grants by themselves.

### Tenant federation and lifecycle

- extend/project `tenant_relationships` into contextual authority with relationship policy and delegated operations;
- `tenant_lifecycle_runs` — suspension, ownership transfer, offboarding, export, legal hold, erasure, and completion evidence;
- `tenant_ownership_transfers` — current/future owner, approvals, effective time, and rollback;
- `tenant_orphan_resource_reviews` — variants, grants, connections, approvals, artifacts, and scheduled work requiring disposition.

### Data governance

The approved DFR-003 authority set is layered and purpose-bound. Access grants remain separate from processing eligibility.

- `data_classification_registry` — registered sensitivity tiers, category attributes, protection floors, allowed downgrade behavior, version, and status;
- `data_classification_assignments` — resource/data reference, source classification, sensitivity tier, category attributes, classifier/authority, confidence where applicable, validity, version, and checksum;
- `processing_purpose_registry` — registered purpose, operations, audiences, recipients, lawful-basis/consent expectations, derived-data behavior, approvals, and lifecycle;
- `purpose_data_class_rules` — purpose-to-class eligibility, allowed source/use/sink categories, environments, destinations, providers/models, regions, retention profile, and deny/review behavior;
- `lawful_basis_registry` — supported basis types, jurisdiction applicability, evidence schema, review requirements, and version;
- `consent_records` — subject, purpose, categories, audience/provider scope, grant source, version, validity, withdrawal state, and no-secret evidence;
- `consent_events` — grant, update, withdrawal, expiry, dispute, and resulting invalidation/disposition evidence;
- `principal_data_use_preferences` — opt-in/opt-out and transparency preferences where applicable; preferences cannot authorize prohibited use;
- `data_residency_policies` — storage, processing, model, provider, backup, and export region constraints by scope and data class;
- `data_transfer_policies` — allowed destination, recipient, cross-border mechanism, contract/evidence, conditions, validity, and review state;
- `retention_profiles` — trigger, duration/review rule, disposition action, legal basis, jurisdiction, and override floor;
- `retention_assignments` — data/resource/artifact binding to profile/version with source policy, start event, expiry/review date, and checksum;
- `legal_holds` — hold identity, reason, authority, lifecycle, validity, and audit; a hold grants no read authority;
- `legal_hold_scopes` — exact Tenant, Brand, Workspace, subject, resource, case, date-range, category, and source-system coverage;
- `data_subject_requests` — access, export, correction, restriction, erasure, objection, or consent-withdrawal lifecycle and identity evidence;
- `data_subject_request_items` — discovered primary/derived objects, exemption/hold/retention decision, action, completion, and readback;
- `data_lineage_edges` — typed source-to-derived relationships for raw records, summaries, embeddings, indexes, Agent memory, evaluations, analytics, aggregates, artifacts, provider copies, and backups;
- `derived_data_disposition_runs` — preview/apply evidence for delete, rebuild, invalidate, retract, anonymize, aggregate, retain-under-hold, or minimal-tombstone actions;
- `model_data_use_policies` — inference, prompt/response retention, evaluation, fine-tuning, cross-Tenant learning, embeddings, Agent memory, provider training, and zero-retention controls;
- `provider_data_processing_profiles` — region, retention, training use, subprocessors, contract/certification, security posture, deletion capability, and purpose compatibility;
- `data_use_decisions` — immutable actor/context, resource, classification, purpose, lawful-basis/consent, residency/transfer, retention/hold, provider/model, audience/destination, policy sources, decision, expiry, version vector, explanation, and checksum;
- `data_governance_epochs` — scope invalidation after policy, classification, consent, hold, retention, provider-profile, or subject-request change;
- `cross_tenant_learning_policies` — participation/opt-out, approved purposes, eligible aggregates, minimum cohort, contribution/dominance limits, residency, re-identification, quality, and fairness controls;
- `cross_tenant_learning_runs` — immutable cohort, inputs-as-aggregate, policy versions, privacy/quality checks, outputs, blockers, and readback;
- `retention_execution_runs` — governed preview, approval, archive/delete/anonymize action, lineage propagation, checksum, and readback.

Specialized domain tables retain their records. These authorities govern eligibility, lineage, and disposition and do not form an unrestricted generic EAV write surface.

### Commercial and FinOps

The approved DFR-004 model is database-authoritative, registry-driven, user-configurable within governed templates, reservation-first, and double-entry. Existing plans, subscriptions, entitlements, quotas, usage, credits, and `budget_quota_authority_registry` remain migration inputs and compatibility projections until certified cutover.

#### Billing ownership and account authorities

- `billing_accounts` — billing identity, owning Tenant, status/standing, default currency, tax/payment profile references, credit limit, statement cycle, and commercial epoch;
- `billing_owner_assignments` — versioned legal/contractual billable owner with validity, authority, approval, and checksum;
- `commercial_relationship_bindings` — direct non-transitive `bills_for`, reseller, managed-service, or cost-sharing contract with exact scope, limits, validity, and settlement responsibility;
- `billing_account_model_bindings` — allowed billing models, collection modes, currencies/credit units, fallback order, effective dates, and contract/version evidence.

#### Dynamic model and customization registries

- `billing_model_registry` — registered billing model semantics, supported asset types, reservation/settlement capabilities, compatibility, version, and status;
- `collection_mode_registry` — prepaid, postpaid, or future registered collection semantics, required standing/payment evidence, lifecycle, and compatibility;
- `billing_profile_template_registry` — reusable Platform/contract/plan templates, allowed models, meter bundles, price/rating references, parent limits, and status;
- `billing_profile_customization_field_registry` — typed customizable path, value schema, allowed operators/options, min/max, delegation ceiling, explanation, and risk class;
- `billing_profiles` — Tenant, billing-account, Brand, Workspace, group, or user-scoped profile instance with template/version, selected model/mode, meter bundle, limits, approvals, lifecycle, and checksum;
- `billing_profile_selections` — principal/context selection of one eligible profile with priority, validity, and source authority;
- `billing_profile_meter_rules` — per-profile included units, hard/soft limits, overage, display, rating/price binding, and delegation behavior;
- `billing_profile_alert_rules` — threshold, channel, cadence, recipients, severity, and status;
- `commercial_policy_operator_registry` — typed commercial operators such as deny-wins, minimum ceiling, explicit grant, priority select, and block-on-ambiguity;
- `commercial_state_transition_registry` — allowed lifecycle transitions and required authority/approval/readback by resource class;
- `commercial_reason_code_registry` — stable reason/adjustment/refund/dispute codes and required evidence.

#### Currency, credit, and conversion authorities

- `currency_registry` — ISO currency key, exponent, validity, rounding, display, and settlement support;
- `credit_unit_registry` — non-currency credit-unit identity, issuer, expiry/transfer/refund policy, precision, and status;
- `credit_conversion_contracts` — explicit money-credit conversion terms, price/version, direction, scope, validity, and approval;
- `fx_quote_registry` — base/quote currency, rate, source, quoted/expiry time, contract scope, and checksum.

#### Metering and units

- `usage_unit_registry` — canonical unit family, conversion ratio, quantity scale, rounding, minimum increment, and display semantics;
- `usage_meter_registry` — stable meter key/family, source authority, billability/reservability/pricing eligibility, current version, and status;
- `usage_meter_versions` — unit, aggregation mode, deduplication, verification, late-event/correction, dimensions, lifecycle, and checksum;
- `usage_meter_dimension_registry` — allowed dimension keys, value schema, cardinality limits, privacy class, and attribution behavior;
- `meter_aggregation_mode_registry` — registered `sum`, `maximum`, `minimum`, `latest`, `unique_count`, `duration`, `time_integral`, and `verified_count` semantics;
- `usage_meter_events` — immutable raw measurement with Tenant/account/operation/manifest, meter/version, unit, scaled quantity, source event, dedupe key, evidence, and timestamps;
- `usage_meter_event_corrections` — append-only correction/retraction/reclassification linked to original event and authority;
- `usage_meter_aggregates` — rebuildable scoped/period projections with source range/checksum and version;
- `composite_meter_definitions` — customer-facing composite meter/version, registered operator/formula, packaging, rounding, and checksum;
- `composite_meter_components` — component meter/version, weight/operator, inclusion rule, and provenance;
- `usage_verification_runs` — outcome/delivery/quality verification, duplicate checks, attribution window, evidence, and decision;
- `billable_usage_records` — derived included, billable, non-billable, disputed, or adjusted quantity with rating inputs and provenance.

#### Rating and pricing

- `rating_model_registry` — registered typed rating semantics and supported meter/model combinations;
- `price_book_registry` — owner/scope, billing model, contract family, lifecycle, and current version;
- `price_book_versions` — effective period, currency/credit unit, tax/discount policy, rounding, approval, and checksum;
- `price_book_rate_lines` — meter/version, unit, tier/package/commitment/outcome/pass-through rule, quantity range, price, included behavior, and conditions;
- `commercial_entitlement_decisions` — immutable account/profile/plan/capability/meter eligibility, limits, standing, policy sources, decision, expiry, and version vector.

#### Estimate, reservation, and settlement

- `runtime_cost_estimates` — immutable account/profile/model, customer/internal totals, tax/discount/credit offset, price/rating versions, confidence, expiry, and checksum;
- `runtime_cost_estimate_lines` — meter/version, raw/normalized/included/billable quantities, expected/maximum units, customer charge, internal cost, asset type, and evidence;
- `runtime_cost_reservations` — idempotent atomic reservation bound to manifest, operation, billable owner, profile/model, commercial epoch, asset type, amount/units, expiry, and state;
- `runtime_cost_reservation_lines` — meter, included-unit, budget, quota, credit, prepaid balance, or postpaid liability capacity consumed/released;
- `runtime_cost_settlements` — verified settlement classification, reservation/operation/manifest, account/owner, totals, released difference, evidence, and ledger transaction;
- `runtime_cost_settlement_lines` — verified usage/outcome, customer charge, internal/provider cost, tax/discount, billability, asset type, and source meter records.

#### Ledger, invoices, adjustments, and attribution

- `commercial_ledger_accounts` — typed Tenant/Platform subledger account, currency or credit unit, owner, normal balance, status, and version;
- `commercial_ledger_transactions` — append-only balanced transaction identity, type, source resource, period, status, approval, checksum, and reversal link;
- `commercial_ledger_entries` — debit/credit line, ledger account, amount/quantity, currency/credit unit, attribution, and source evidence;
- `commercial_refund_adjustment_runs` — request/eligibility/review/approval/posting/completion lifecycle and compensating transaction;
- `usage_dispute_runs` — disputed events/records, evidence, provisional treatment, decision, adjustment, and communication state;
- `invoice_accounts`, `invoice_runs`, and `invoice_lines` — postpaid statement, tax, terms, due date, settlement lines, collection status, and readback;
- `payment_collection_events` — authorized payment attempt/result/reference evidence without raw payment credentials;
- `cost_attribution_ledger` — user, Workspace, Brand, Department, Group, campaign, objective, project, and custom registered cost-center attribution; attribution grants no liability or authority;
- `commercial_policy_epochs` — invalidation after account, contract, profile, meter, price, standing, budget/quota, conversion, or ledger-policy change;
- `commercial_balance_projections` — rebuildable available/reserved/consumed/receivable projections derived from the ledger.

Specialized authorities remain specialized. Registries define allowed semantics and customization without creating an unrestricted EAV, SQL-expression, JavaScript, shell, or arbitrary financial mutation surface.

### Model governance

The approved DFR-005 model is capability-first, policy-gated, evidence-ranked, evaluation/readiness bounded, commercially reserved, and fail-closed. Existing `ai_model_registry`, `ai_model_providers`, `agent_model_runs`, `platform_runtime_config.agent_model_runtime`, `intelligence_engines`, `intelligence_policies`, `skill_manifests`, and allowlisted provider adapters remain compatibility inputs or implementation surfaces until certified family-specific cutover.

#### Task and capability authorities

- `model_task_class_registry` — stable task key, description, risk class, allowed modalities, default capability profile, required evaluation families, lifecycle, version, and status;
- `model_capability_registry` — typed capability dimensions such as modality, language, context, structured output, tools, streaming, grounding, determinism, safety, latency, and reliability;
- `model_capability_profiles` — versioned task/capability contract with required/optional dimensions, minimum/maximum bounds, output/tool contracts, risk, validity, and checksum;
- `model_capability_profile_requirements` — normalized capability key, operator, required value/range/schema, mandatory flag, and explanation template.

#### Provider endpoint, model-version, and inference-profile authorities

- `model_provider_endpoint_profiles` — provider, allowlisted adapter key, endpoint/deployment identity, region, data-processing profile, contract/certification, feature support, readiness policy, lifecycle, and no-secret credential reference;
- `model_versions` — exact provider/model version identity, family, release/retirement dates, alias relation, context/output limits, lifecycle, checksum, and provenance;
- `model_alias_resolution_snapshots` — alias, exact resolved version, provider evidence, observed time, compatibility/evaluation effect, expiry, and checksum;
- `model_inference_profile_registry` — bounded generation/reasoning/structured-output/tool/streaming parameters, supported model families, risk class, version, and status;
- `model_compatibility_certifications` — exact model/version/endpoint/inference profile compatibility with capability, task, output, tool, region, and risk contracts.

#### Context policy and optimization authorities

- `model_context_policy_registry` — Platform, Tenant, plan, Brand, Workspace, activity, risk, data, region, audience, environment, and operation policy identity, priority, validity, and version;
- `model_context_policy_rules` — typed allow/deny/require/restrict rules over provider/model/endpoint/capability/evaluation/readiness/fallback/commercial dimensions;
- `model_optimization_profile_registry` — registered quality-first, balanced, cost-first, latency-first, privacy-first, local-only, reliability-first, or future compatible profile with risk applicability and status;
- `model_optimization_profile_metrics` — metric key, weight, normalization/version, floor/ceiling, confidence treatment, freshness, missing-evidence behavior, and tie-break priority;
- `principal_model_preferences` — user or delegated scoped preference selecting only eligible optimization/profile/provider/model/fallback/max-cost/max-latency choices with source authority, validity, and checksum.

#### Evaluation and quality authorities

- `model_evaluation_suite_registry` — stable suite family, capability/task/risk/locale/modality/domain applicability, owner, lifecycle, and status;
- `model_evaluation_suite_versions` — immutable rubric, evaluator policy, validators, sample requirements, thresholds, zero-tolerance failures, confidence, freshness, and checksum;
- `model_evaluation_dataset_refs` — provenance-linked bounded dataset reference, version, sensitivity, audience, license, residency, retention, and access policy without unrestricted raw payload;
- `model_evaluation_metric_registry` — typed metric semantics, direction, scale, aggregation, confidence, comparability, and explanation;
- `model_evaluation_thresholds` — suite/version/context metric floor/ceiling, zero-tolerance flag, risk behavior, and validity;
- `model_evaluation_runs` — exact candidate, suite/dataset/prompt/tool/workflow versions, environment, region, status, evidence, and reproducibility checksum;
- `model_evaluation_results` — per-case/per-metric result, validator/human/model-judge provenance, confidence, failure class, and evidence reference;
- `model_quality_scorecards` — current bounded evaluation summary, samples, metrics/confidence, failures, latency/reliability/error/cost observations, regions/endpoints, validity, drift state, and checksum.

#### Readiness, selection, and fallback authorities

- `model_readiness_snapshots` — exact provider endpoint/model feature readiness, credential-presence flag without value, contract/certification, quota/capacity, rate limit, circuit breaker, recent success/error/timeout/latency, incident, observed time, expiry, and state;
- `model_selection_decisions` — immutable Tenant/principal/context/operation, task/capability, candidate-universe snapshot, selected candidate, optimization profile, fallback set, commercial refs, epoch, expiry, explanation, and checksum;
- `model_selection_candidate_evidence` — one row per candidate and gate/metric with eligibility, exclusion reason, policy/evaluation/readiness/commercial sources, normalized value, weight, rank, confidence, and freshness;
- `model_fallback_sets` — immutable ordered fallback identity, task/capability/risk scope, safe-boundary policy, lifecycle, and checksum;
- `model_fallback_candidates` — exact independently eligible candidate, order, equivalence certification, estimate/reservation requirements, and activation conditions.

#### Drift, incidents, lifecycle, and invalidation

- `model_drift_events` — candidate/metric/corpus/window, expected/observed delta, confidence, severity, affected contexts, action, and status;
- `model_incident_restrictions` — provider/endpoint/model/version scope, security/privacy/safety/contract reason, restrict/revoke action, authority, effective period, and evidence;
- `model_deprecation_runs` — impacted assets/Agents/workflows/profiles/manifests, replacements, deadline, shadow/canary evidence, rollback/exception, progress, and completion readback;
- `model_governance_epochs` — invalidation after task/capability, policy, model lifecycle, alias resolution, evaluation, scorecard, readiness, incident, fallback, preference, or commercial compatibility change.

#### Candidate identity and separation

The exact candidate identity is provider + endpoint/deployment + model version + inference profile + region + data-processing profile + commercial price profile. Floating aliases are recorded through resolution snapshots.

Hard eligibility evidence, contextual ranking, provider/internal cost, customer charge, estimate/reservation, provider dispatch, and outcome evidence remain distinct and reconstructable.

Database policy may select only allowlisted provider adapters and bounded semantics. It cannot store or execute arbitrary URLs, headers, SQL, JavaScript, shell, model code, or credential values.

### Deterministic durable Workflow and Effect Commit authorities

The approved DFR-006 model is fully registry-driven, append-only, deterministic at the Workflow-decision layer, at-least-once at the Activity-delivery layer, and explicit about Effect uncertainty. Existing jobs, queues, execution plans/steps/events, workflow/step runs, approval holds, surface Outboxes, execution logs, and adapter retry behavior remain compatibility inputs until certified family cutover.

#### Dynamic semantic registries

- `runtime_workflow_type_registry` — stable Workflow type key, owner, risk class, default definition/policies, applicable contexts, lifecycle, and version;
- `runtime_workflow_definition_versions` — immutable deterministic definition, compatible engine version, allowed commands/events/Activities, replay compatibility, validity, and checksum;
- `runtime_workflow_state_registry` — lifecycle/outcome/effect/verification state semantics, terminality, allowed audiences, and status;
- `runtime_workflow_event_type_registry` — event schema, source authority, causation requirements, redaction class, replay semantics, and version;
- `runtime_workflow_transition_registry` — source state, event/condition, target state, required evidence, approvals, side-effect prohibition/allowance, and handler semantic key;
- `runtime_workflow_signal_type_registry` — typed signal schema, sender authority, idempotency, expiry, duplicate behavior, and target Workflow types;
- `runtime_workflow_timer_type_registry` — durable timer class, scheduling rule, deadline interaction, missed-timer behavior, and compatible transitions;
- `runtime_activity_type_registry` — Activity key, handler key, supported Effect classes, default policies, input/output schemas, risk, and lifecycle;
- `runtime_activity_handler_registry` — allowlisted code handler identity, package/build digest, capabilities, compatibility, certification, and status without executable payload;
- `runtime_activity_policy_versions` — timeout, retry, lease, cancellation, verification, concurrency, queue, and evidence requirements;
- `runtime_effect_type_registry` — stable Effect type, effect class, sensitivity, commit-boundary family, verification/reconciliation/compensation requirements, and status;
- `runtime_effect_contract_versions` — exact target semantics, preparation, dispatch, idempotency, commit boundaries, provider reference, verification, reconciliation, cancellation, compensation, retention, and checksum;
- `runtime_effect_commit_state_registry` — `not_started`, `prepared`, `dispatching`, `accepted`, `committed`, `verified`, `confirmed_no_effect`, `outcome_unknown`, `compensating`, `compensated`, and failure semantics;
- `runtime_effect_verification_policy_registry` — authoritative validators/readback sources, quorum, evidence freshness, confidence, and failure behavior;
- `runtime_effect_reconciliation_policy_registry` — lookup/readback strategies, polling windows, terminal outcomes, manual-review thresholds, and retry eligibility;
- `runtime_retry_class_registry` — `never_retry`, immediate, backoff, dependency, approval, reconcile-before-retry, and manual-only semantics;
- `runtime_retry_policy_versions` — attempts, elapsed/deadline budgets, backoff/jitter, `Retry-After`, circuit breaker, reservation/quota behavior, and recovery action;
- `runtime_error_class_registry` — stable error classification, retry class, effect uncertainty, severity, disclosure, and operator action;
- `runtime_cancellation_policy_registry` — before-dispatch, cooperative-boundary, compensate, non-cancellable-after-commit, or manual-only behavior;
- `runtime_compensation_policy_registry` — eligible Effect classes, handler key, dependency ordering, deadline, approvals, verification, and recovery behavior;
- `runtime_checkpoint_policy_registry` — checkpoint schema, verified-state requirements, allowed context/effect references, retention, and resume/replay compatibility;
- `runtime_replay_policy_registry` — eligibility, required preview/approval, new identity, source checkpoint, current-policy validation, and duplicate-effect protections;
- `runtime_recovery_reason_registry` — retry exhaustion, outcome unknown, compensation failure, schema incompatibility, authority/manifest change, manual decision, and owner/SLA defaults;
- `runtime_queue_service_class_registry` — interactive, standard, batch, recovery, system-critical, and future registered classes with bounded priority behavior;
- `runtime_concurrency_policy_registry` — Tenant/account/resource/provider/type/service-class concurrency key, limit, lease behavior, and admission result;
- `runtime_fairness_policy_registry` — bounded weights, priority aging, reserved recovery capacity, starvation prevention, and backpressure behavior;
- `runtime_dead_letter_reason_registry` — transport-specific reasons, retry/redrive constraints, owner, retention, and disclosure;
- `runtime_operation_reason_code_registry` — stable cancellation, compensation, replay, recovery, and manual-intervention reasons;
- `runtime_governance_epoch_sources` — contributing authority families that advance Workflow invalidation epochs.

#### Durable Workflow history

- `runtime_workflows` — Workflow/root/parent/operation identity, Tenant/principal/context, type/definition version, manifest, idempotency, service class, priority, deadlines, policies, concurrency key, commercial/model/data/runtime epochs, lifecycle/outcome projections, and checksum;
- `runtime_workflow_events` — immutable ordered sequence, event type/schema version, source, causation/correlation IDs, policy/version vector, payload/evidence checksum, and observed/recorded time;
- `runtime_workflow_snapshots` — rebuildable acceleration snapshot with history sequence/checksum, definition version, and projection checksum;
- `runtime_workflow_timers` — timer type, scheduled/expiry times, state, firing event, missed behavior, and lease/fencing evidence;
- `runtime_workflow_signals` — signal type/version, sender authority, idempotency/checksum, received/processed state, expiry, and resulting event;
- `runtime_workflow_dependencies` — parent/child or Workflow/Activity dependency, required/optional/quorum semantics, deadline, status, and evidence.

#### Activities and attempts

- `runtime_activities` — Workflow step/Activity identity, type/policy versions, input checksum, target/effect refs, deadline, queue/service class, retry/cancellation/concurrency policy, lifecycle, and output checksum;
- `runtime_activity_attempts` — immutable attempt number, Worker identity, lease/fencing refs, start/dispatch/ack/verify timestamps, error/retry class, result/evidence checksum, and terminal classification;
- `runtime_activity_leases` — Activity/concurrency key, owner, issued/expires/heartbeat, monotonic fencing token, status, and revocation reason;
- `runtime_activity_results` — immutable structured result, required/optional outputs, warnings, effect refs, verification state, and checksum.

#### Effect Ledger and evidence

- `runtime_effects` — stable logical Effect ID/key, Workflow/Activity, type/contract version, target resource/provider, expected checksum, provider idempotency key, current effect/verification/compensation state, retention, and no-secret metadata;
- `runtime_effect_dispatches` — attempt-specific preparation/transmission/acceptance/provider-reference evidence, commit boundary, timestamps, response checksum, and uncertainty classification;
- `runtime_effect_verification_runs` — policy/version, validators/readback sources, evidence, result, confidence, freshness, and checksum;
- `runtime_effect_reconciliation_runs` — strategy/policy, stable lookup keys, attempts, evidence, outcome (`confirmed_effect`, `confirmed_no_effect`, `still_unknown`, `conflicting_evidence`, `manual_review_required`), and next action;
- `runtime_effect_compensation_runs` — source Effect, compensation Activity/Effect, policy, approvals, dependency order, result, verification, unresolved state, and checksum.

#### Messaging and transport durability

- `runtime_outbox` — transactionally emitted event identity, Workflow/event refs, schema version, payload checksum, availability, delivery attempts, lease/fencing, state, and destination class;
- `runtime_inbox` — consumer/event unique identity, payload checksum, processing state, result checksum, first/last observed times, and conflict evidence;
- `runtime_transport_dead_letters` — Outbox/Inbox/queue/callback/notification source, failure class, attempts, payload checksum/ref, owner, retention, redrive eligibility, and recovery evidence.

#### Checkpoints, replay, and recovery

- `runtime_checkpoints` — Workflow/history sequence, verified state checksum, committed Effect refs, remaining-work summary, authority/manifest/version vector, sensitivity, expiry, and compatible replay policy;
- `runtime_recovery_cases` — Workflow/effect scope, reason, severity, unresolved/committed effects, reconciliation/compensation evidence, owner, SLA, allowed actions, review/expiry, and checksum;
- `runtime_manual_interventions` — recovery case, requested action, authority/approval, operator evidence, outcome, and readback;
- `runtime_replay_runs` — source/new Workflow, reason, preview/checkpoint checksum, new idempotency, current manifest/policies, approvals, result, and evidence.

#### Queue, concurrency, and rate authorities

- `runtime_task_queues` — queue key, service class, compatible Activity types, capacity, ownership, environment/region, lifecycle, and health policy;
- `runtime_queue_assignments` — Activity/queue binding, reason, priority/age evidence, admission state, and version;
- `runtime_rate_limit_buckets` — scoped token/leaky bucket state for Tenant/account/resource/provider/type with policy/version and rebuild evidence;
- `runtime_concurrency_leases` — scoped concurrency key, holder Workflow/Activity, fencing token, expiry, and release evidence;
- `runtime_governance_epochs` — invalidation after Workflow/Activity/Effect definition, policy, handler, manifest, authority, data, model, commercial, retry, cancellation, compensation, reconciliation, or recovery change.

#### Determinism and execution safety

Workflow history is authoritative. Snapshots, queue state, and projections are rebuildable. Lifecycle, outcome, Effect, and verification states remain distinct. All executable handlers/adapters are allowlisted code; registry rows select only supported semantic keys and bounded parameters. Business recovery is distinct from transport dead letters, and replay creates a new linked Workflow rather than rewriting history.

### Artifact and knowledge provenance

Existing `output_artifacts`, JSON assets, graph evidence, and runtime verification remain sources.

- `artifact_versions` — immutable schema version, content checksum, manifest, source run, sensitivity, audience, license, freshness, and verification;
- `artifact_provenance_edges` — derived-from, cites, transforms, supersedes, corrects, or retracts;
- `artifact_verification_runs` — validators, results, confidence, and evidence;
- `knowledge_index_versions` — source set, chunking/embedding model, retrieval policy, and invalidation state;
- `artifact_data_disposition_runs` — retention, export, correction, retraction, and erasure propagation.

### Temporal, environment, region, and jurisdiction

- `context_time_schedules` — scheduled profile, policy, variant, grant, or connection changes;
- `environment_registry` — local, development, staging, production, managed, and dedicated environments;
- `environment_resource_bindings` — environment-scoped connection, credential, asset, model, and approval eligibility;
- `region_jurisdiction_registry` — region, jurisdiction, residency, provider, and data constraints;
- manifests include `as_of`, environment, region, jurisdiction, and clock/version evidence.

### Supply chain and compatibility

Existing plugin, package, version, trust, capability, and certification tables remain sources.

- `publisher_identity_registry` — verified publisher and signing identities;
- `package_supply_chain_manifests` — digest, signature, SBOM, dependency lock, license, requested capabilities, scan evidence;
- `package_update_channels` — staged channels, cohorts, minimum runtime, rollback, and revocation;
- `contract_schema_registry` — API, asset, policy DSL, manifest, prompt/tool, and event schemas;
- `contract_compatibility_rules` — backward/forward/full/breaking policy and deprecation windows;
- `client_capability_profiles` — supported contracts and negotiated behavior.

### Portability and resilience

- `tenant_export_runs` and `tenant_export_manifests` — no-secret portable snapshot, checksums, ownership, and scope;
- `tenant_import_runs` — validation, ID mapping, conflicts, and result evidence;
- `data_subject_export_runs` — user-scoped export and delivery evidence;
- existing backup/restore authorities are extended to profiles, variants, manifests, proposals, experiments, and authority epochs;
- `disaster_mode_runs` — affected region/provider, declared degraded policy, owner, RPO/RTO, and recovery evidence.

### Human operations

- `human_work_queues` — queue scope, owner, service class, and escalation policy;
- `human_work_items` — exact request/approval/review/rollback task and manifest link;
- `approver_availability` — availability, backup approver, timezone, capacity, and validity;
- `managed_service_handoffs` — customer/operator state, SLA timers, and completion evidence.

### Capability ontology and evaluation

- populate/extend asset equivalence into `capability_ontology_registry` and `capability_implementation_bindings`;
- `capability_compatibility_edges` — requires, conflicts, replaces, supersedes, and compatible-with;
- `quality_evaluation_suites` and `quality_evaluation_runs` cover assets, models, workflows, prompts, languages, activities, and risks;
- `recommendation_exposure_ledger` records ranking/exposure for bias and feedback-loop analysis.

## 12. Indexing and integrity

- every tenant-owned row begins with `tenant_id` in lookup indexes;
- principal/context/profile selection indexes support exact scoped resolution;
- variant uniqueness covers tenant + base asset + owner scope + variant key;
- checksums bind base versions, profile versions, and patch content;
- authority epoch invalidates affected cached manifests;
- no cross-tenant foreign or logical reference is accepted;
- JSON fields have bounded schemas and secret-like key rejection;
- high-volume ledgers support time partitioning or retention policies after measured need.

## 12. Migration philosophy

The first migration creates registries and views only. It does not seed one row per shared asset per tenant. Projections are built from canonical registries, and tenant rows are created only for profiles, preferences, variants, experiments, or explicit scoped bindings.
