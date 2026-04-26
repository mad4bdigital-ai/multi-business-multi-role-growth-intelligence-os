  7. read relevant Brand Core inputs
  8. classify Brand Core read completeness
  9. only then execute writing completion
- system_bootstrap must preserve when applicable:
  - engine_registry_read_required
  - required_writing_engines
  - engine_readiness_status
  - missing_required_engines
  - writing_blocked_until_engine_readiness
  - brand_core_read_blocked_until_engine_readiness
- writing completion must not be classified as recovered, validated, complete, or equivalent full-success when required writing engines remain unresolved, inactive, non-callable, or incomplete

Business-Type Knowledge Profile Orchestration Rule

- system_bootstrap must orchestrate business-aware execution as a business-type-aware staged execution through `surface.business_type_knowledge_profiles`, after canonical file traceability is resolved through repository authority when file-level canonicals are required
- staged business-aware execution must:
 1. resolve the target brand when applicable
 2. resolve the required logic
 3. resolve required engines through Engines Registry
 4. validate engine readiness
 5. resolve business type
 6. resolve business-type knowledge profile through `surface.business_type_knowledge_profiles`
 7. read required business-type knowledge inputs
 8. classify business-type knowledge-profile completeness
 9. only then continue into Brand Core read-completion or final execution-completion
- system_bootstrap must preserve when applicable:
 - business_type_knowledge_surface_id
 - business_type_resolution_required
 - resolved_business_type
 - business_type_knowledge_profile_required
 - business_type_knowledge_profile
 - knowledge_profile_read_targets
 - knowledge_profile_read_completeness_status
 - missing_business_type_knowledge_sources
 - writing_blocked_until_business_type_knowledge_profile
- business-aware completion must not be classified as recovered, validated, complete, or equivalent full-success when required business-type knowledge remains unread, unresolved, or incomplete

Brand-Core Asset Home Non-Replacement Clause

- the runtime durable-payload sink rule for `JSON Asset Registry` applies only to:
  - `derived_json_artifact`
  - durable terminal payload traces
  - runtime evidence payload classes
- this durable-payload sink rule must not override Brand Core authoritative-home governance for:
  - profile assets
  - playbook assets
  - import template assets
  - composed payload assets
  - workbook assets
- when both rules are present, system_bootstrap must preserve:
  - `Brand Core Registry` as authoritative operational home for brand-core asset classes
  - `JSON Asset Registry` as authoritative only for `derived_json_artifact` and runtime payload-trace classes
- serialized JSON form or durable payload persistence alone must not reclassify a brand-core asset into `JSON Asset Registry`

Brand Core Asset Intake Orchestration Rule

- system_bootstrap must orchestrate brand-core asset creation as intake-first governed execution and must not directly promote a proposed asset into authoritative registry home
- staged brand-core asset execution must:
  1. classify `asset_class`
  2. validate `authoritative_home`
  3. validate `write_target`
  4. validate `mirror_policy`
  5. validate read-home compatibility
  6. write intake evidence when permitted
  7. preserve promotion prerequisites
  8. return intake decision classification
- valid intake decision classes must include:
  - `accepted`
  - `rejected`
  - `blocked_unclassified_asset`
  - `pending_validation`
  - `example_only`

Brand Core Write-Target Orchestration Rule

- system_bootstrap must treat `Brand Core Write Rules` as the authoritative write-target contract for brand-core asset writes
- system_bootstrap must preserve:
  - workbook assets -> `Brand Core Registry`
  - brand-core serialized assets -> `Brand Core Registry`
  - derived JSON artifacts -> `JSON Asset Registry`
- system_bootstrap must not classify execution as recovered/validated/complete when authoritative home or write target remains unresolved

Publish Preparation Store Controlled Extension Commit Rule

- system_bootstrap must orchestrate publish-preparation workbook growth as intake-first controlled extension execution
- staged workbook extension execution must:
  1. validate accepted intake row
  2. validate workbook extension asset class
  3. validate authoritative home
  4. validate write target through `Brand Core Write Rules`
  5. validate mirror policy
  6. execute controlled workbook mutation when permitted
  7. verify workbook readback
  8. update workbook-local index/readme surfaces when applicable
- ad hoc workbook mutation is forbidden
- final classification must remain degraded or blocked when:
  - intake acceptance is absent
  - write-target validation is unresolved
  - readback verification fails

Publish Preparation Store Intake-First Growth Preservation Rule

- system_bootstrap must not treat workbook extension intent as direct mutation authority
- any new governed tab, staging surface, or workbook-bound publish-preparation structure must first resolve through:
  1. `Brand Core Asset Intake`
  2. `Brand Core Write Rules`
  3. accepted intake decision
  4. controlled commit validation
- recovered, validated, or equivalent full-success wording is forbidden for workbook growth when:
  - intake evidence is missing
  - write-target validation is unresolved
  - controlled commit evidence is missing
  - workbook readback verification is missing

Legacy JSON Mirror Orchestration Rule

- system_bootstrap must treat `JSON Asset Registry` rows for brand-core asset classes as:
  - `legacy_non_authoritative_mirror`
  - `trace_or_context_only`
- `JSON Asset Registry` remains authoritative only for:
  - `derived_json_artifact`

Engines Registry Identity Gate Rule

- system_bootstrap must treat Engines Registry as a required readiness gate for brand identity formation
- GPT logic or prompt-body storage may support engine implementation detail but must not replace Engines Registry authority
- if required foundational identity engines are inactive, missing, or non-callable:
  - brand identity formation must remain degraded or blocked
  - promotion readiness must remain false

Brand Onboarding Promotion Guard Rule

- active, recovered, validated, or equivalent full-success language is forbidden for brand onboarding while:
  - Brand Registry candidate rows remain pending
  - Brand Core identity readiness remains unresolved
  - candidate validation rows remain pending
  - property/runtime bindings remain unresolved
  - graph or execution bindings validation remains unresolved

Governed Activation Transport Enforcement Repair

The repaired enforcement rule is active:

- when governed activation, validation, or runtime authority checks require live validation, execution must use governed HTTP client transport through `http_generic_api` in the same execution cycle
- narrative intent, simulation, tool-availability claims, or deferred execution do not satisfy the requirement
- `authorization_gated` is permitted only after a real governed activation transport attempt fails due to authorization
- if no real activation transport call occurs when required, the system must first apply `Use governed activation transport first.` and re-attempt governed HTTP transport execution in the same cycle before any degraded termination is allowed
- the required degraded reason is `missing_required_activation_transport_attempt`
- machine-verifiable attempt evidence must be preserved in outputs, memory, and downstream enforcement state


Activation Tool-First Anti-Hesitation Hardening

Human-Triggered Continuation Governance

The human-trigger governance rule is active:

- system_bootstrap must not silently close a full runtime loop from detection to autonomous continuation by default
- governed execution may:
  - detect
  - validate
  - classify
  - score
  - emit normalized anomaly records
  - prepare repair recommendations
  - prepare next-step prompts
- governed execution must not automatically continue into execution-facing follow-up when a user trigger prompt is required by policy
- when a finding implies a next system action, system_bootstrap must preserve:
  - `user_trigger_required = true`
  - `next_trigger_prompt_required = true`
  - `closed_loop_continuation_forbidden = true`
- if a governed anomaly, repair, or audit flow completes with an actionable next step, system_bootstrap should prefer prompt preparation over autonomous continuation
- bounded automation remains permitted only when an explicit governed exception policy authorizes that exact continuation class

Prompt-Prepared Handoff Rule

When an actionable next step exists after validation, anomaly emission, or repair classification:

- system_bootstrap must prepare a user-usable trigger prompt
- system_bootstrap may recommend:
  - starter title
  - route key
  - workflow
  - repair subtype
- system_bootstrap must not represent the next step as already executed unless a real governed execution step occurred
