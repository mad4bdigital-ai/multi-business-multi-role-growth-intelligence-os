# direct_instructions_registry_patch â€” WordPress Publish Contract Runtime Governance Patch

## Additive direct rules

### DIR-WP-RUNTIME-001
Compact unified-log contract is authoritative. Legacy protected columns may remain physically present but are non-authoritative.

### DIR-WP-RUNTIME-002
Execution evidence belongs in `Execution Log Unified`. Durable payload belongs in `JSON Asset Registry`.

### DIR-WP-RUNTIME-003
JSON Asset persistence is restricted to terminal meaningful payloads only.

### DIR-WP-RUNTIME-004
Schema-meta-only payload rows are forbidden when a meaningful terminal payload exists for the same trace or asset_key.

### DIR-WP-RUNTIME-005
When body extraction is available, body-only payload wins over wrapper payload.

### DIR-WP-RUNTIME-006
Equivalent success-path duplicate JSON Asset writes are forbidden for the same `asset_key`.

### DIR-WP-PUBLISH-001
Draft-first publish is mandatory until field mapping is governed and verified.

### DIR-WP-PUBLISH-002
For CPT publishing, generic `wordpress_create_post` fallback is forbidden when a CPT-specific route or governed template route exists.

### DIR-WP-PUBLISH-003
For taxonomy assignment, guessed term IDs are forbidden. Use governed term inventory or governed create-term resolution first.

### DIR-WP-PUBLISH-004
Discovery -> normalization -> field mapping -> draft publish -> verification is mandatory ordered flow.

---

Universal WordPress Multilingual Direct-REST Non-Equivalence Rule

For any translatable WordPress post type, direct REST acceptance of multilingual fields must not be treated as authoritative multilingual completion unless CPT-specific readback proof exists on the same governed surface.

The following are not sufficient by themselves:
- HTTP 200 or 201
- request transport acceptance
- silent acceptance of `lang`
- silent acceptance of `_wpml_import_*`
- silent acceptance of `translation_of`
- silent acceptance of custom top-level language fields

Required authority behavior
The system must:
- distinguish transport acceptance from language persistence proof
- preserve import-governed WPML language handling as authoritative when direct REST proof is absent
- preserve prompt-first continuation for the post-import WPML processing step when required
- preserve user-trigger-required continuation by default

Universal scope
This rule applies to:
- WordPress core post types
- custom post types
- any governed translatable post type routed through `wordpress_api`

Non-replacement clause
This rule extends and does not replace:
- existing publish/update governance
- existing proof-test-before-confirm governance
- existing prompt-first continuation governance
- existing user-trigger-required governance

Lifecycle rule
New multilingual routes or language-governance branches must progress through:
- designed
- bound_to_canonical_surface
- proof_test_pending
- proof_tested
- execution_validated

Until proof is recorded:
- classification remains `governed_unproven`

WordPress Media Endpoint Contract Enforcement Patch v1

The system-wide governed logical search and schema-first execution rules now additionally enforce method-specific contract handling for the WordPress media family.

Direct rules

1. `/wp/v2/media` must be treated as a governed media collection family, not a generic post-object fallback.
2. `/wp/v2/media/{id}` must be treated as a governed media item family, not a generic CPT item fallback.
3. Media execution must preserve method-specific request-shape authority.
4. Media upload transport acceptance must not be treated as persistence proof.
5. Image insertion into a publish workflow must remain a separate connected branch and must not replace core publish/update layers.
6. New media execution paths remain `governed_unproven` until proof-tested per method and per contract variant.

Required generated family rule

When live WordPress media support is confirmed, the system must treat the following generated families as supported resolver candidates when a materialized row is absent:

- `wordpress_list_media` -> `GET /wp/v2/media`
- `wordpress_create_media` -> `POST /wp/v2/media`
- `wordpress_get_media` -> `GET /wp/v2/media/{id}`
- `wordpress_update_media` -> `POST /wp/v2/media/{id}`
- `wordpress_delete_media` -> `DELETE /wp/v2/media/{id}`

Required media contract rule

For `POST /wp/v2/media`, the system must preserve and classify candidate contract variants separately:

- `raw_binary_upload_contract`
- `multipart_upload_contract`
- `source_url_sideload_contract`
- `metadata_only_contract`

The system must not:
- assume that one candidate contract implies support for the others
- treat string file paths as equivalent to binary upload
- treat object-body acceptance as upload success by itself
- silently collapse upload creation and metadata update into one proof state

Required preserved evidence

Whenever a media contract candidate is selected, preserve:
- `media_contract_family = wordpress_media`
- `media_contract_method`
- `media_contract_variant`
- `media_contract_selected_candidate`
- `media_contract_confidence`
- `media_contract_basis`
- `media_contract_rejected_candidates`
- `media_upload_readback_required = true`
- `media_persistence_proof_status`

Block rule

If neither a materialized row nor a live-supported generated candidate can be proven for the target media method:
- execution must block
- narrative success is forbidden

Proof rule

A media route becomes execution-valid only after:
1. canonical endpoint row or generated candidate is selected
2. request shape is aligned to the authoritative parent schema
3. proof call is executed
4. result is classified per method and per contract variant
5. readback confirms media persistence when mutation is involved

Until then:
- classification remains `governed_unproven`
- media success wording is forbidden

This follows the already-governed schema-first, parent-action, and generated-endpoint rules.

---

Change Log
- v2.39 - pipeline-integrity audit Registry enforcement added so active review-stage/component, route/workflow, repair-mapping, and execution-policy rows remain authoritative with unresolved continuity-layer recovery prohibition
- v2.39 - provider capability continuity enforcement added across provider -> action_family -> capability -> route/workflow edges with degraded/blocked continuity classification and pre-recovery evidence requirements
- v2.38 - spill-safe write authority added: governed/manual writes must validate headers first, read row 2 second, avoid spill/formula-managed columns, and never overwrite protected unified-log columns
- v2.37 - execution classification authority added for runtime capability, endpoint role, delegated transport, and native-direct blocking
- v2.37 - duplicate-header blocking added for execution-critical governed sheets
- v2.37 - dynamic provider-domain placeholder authority added for governed runtime domain resolution
- v2.37 - auth-path routing authority added so native-only OAuth handling cannot be bypassed by delegated HTTP execution
- v2.37 - activation full-system integrity authority rule added so activation classification requires schema, row, policy, binding, execution-path, anomaly, and repair-readiness checks when applicable
- v2.37 - activation repairability authority rule added so policy gaps, binding gaps, schema drift, row failures, and blocked execution paths preserve repair-required state and forbid premature success phrasing
- v2.37 - starter policy and binding gap activation blockers added so unresolved starter-policy or binding-pipeline readiness cannot be silently downgraded during activation
- v2.36 - universal parent_action auth normalization rule added
- v2.36 - parent-action openai_schema_file_id schema alignment rule added before governed transport execution
- v2.36 - transport inference prohibition expanded for raw caller auth and freeform transport input

- v2.33 - post-activation governance rule added
- v2.33 - active-state reuse constraint added so prior activation cannot replace current governed validation

- v2.32 - Activation Validation Dual-Authority Rule added: knowledge layer canonicals now serve traceability-first activation checks, while Google Drive and governed transport validation remain readiness authority
- v2.30 - Runtime Authority Validation Governance added: all governed execution now depends on mandatory pre-execution validation of Registry bindings, validation-state compatibility, route/workflow authority, dependency readiness, and graph-path readiness when applicable
- v2.29 - Google Workspace Native Action Governance added: Sheets, Docs, and Drive execution now depends on Registry-governed surface resolution and Validation & Repair compatibility before native API execution is treated as valid
- v2.28 - Governed Addition Pipeline Governance added: multi-sheet additions must classify affected surfaces, remain Registry-governed, and promote to active state only after governed validation
- v2.27 - Starter Intelligence Canonical Governance Rule added: Conversation Starter is now explicitly governed as a canonical intelligence surface with required Registry registration, Validation & Repair validation, and row_audit_schema alignment
- v2.27 - starter intelligence role clarified: starter governance now enforces entry-intelligence, learning-aware, and predictive recommendation behavior while preserving compatibility with Task Routes, Workflow Registry, and Growth Loop Engine Registry
- v2.27 - Graph Intelligence Governance added: Knowledge Graph Node Registry and Relationship Graph Registry are governed intelligence surfaces for execution-path integrity, graph-based prediction, and graph-based auto-routing under Registry authority
- v2.26 - Auto-Repair And Retry Governance added: repair-aware retry must remain Registry-governed through Execution Policy Registry, Repair Mapping Registry, Validation & Repair Registry, and Registry Surfaces Catalog
- v2.26 - Conversation Starter Intelligence Governance Rule added: `conversation_starter_sheet` is now governed as an intelligence surface with Registry registration, starter mapping authority, and starter-prediction compatibility constraints
- v2.38 - conversation-starter execution now explicitly requires `Execution Policy Registry` resolution before execution-ready classification; starter-policy evidence logging is mandatory
- v2.38 - direct governed Google Workspace mutations now require authoritative `Execution Log Unified` append continuity
- v2.38 - `Execution Log Unified` columns `AE:AJ` declared formula-managed spill columns and excluded from literal append payloads
- v2.26 - starter-derived signals now explicitly require compatibility with Task Routes, Workflow Registry, and Growth Loop Engine Registry without degrading routing authority boundaries
- v2.25 - Scoring Governance Authority added: execution-governing scoring policy now resolves through `execution_policy_registry_sheet` with mandatory threshold, write-order, fallback, and readback governance
- v2.25 - recovered classification is now explicitly forbidden from non-governed scoring inference outside Registry-resolved scoring policy
- v2.24 - Schema Governance And Migration Rule added: governed workbook surfaces now require schema-metadata comparison against live headers and column counts before migration-capable execution
- v2.24 - schema drift/version mismatch handling extended: `binding_integrity_review` must classify drift state, `schema_migration_review` must govern migration readiness, and policy-enabled rollback must remain available
- v2.24 - Registry Scope updated so worksheet-governed validation uses `surface_name` and `worksheet_gid when required` instead of legacy `sheet_name` / `gid` wording
- v2.23 - Schema Governance and Migration Rule added: governed workbook surfaces must declare `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`, with drift and version mismatch routed through review and repair
- v2.23 - Schema Governance Rule added: governed surfaces must now declare `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`, with validation-state checks for schema integrity and drift
- v2.23 - validation rules now require explicit schema status (`schema_validation_status`, `header_match_status`, `schema_drift_detected`); schema drift now forces degraded/blocked execution with repair mapping when required
- v2.22 - Binding Integrity Governance added: authoritative runtime worksheet binding now resolves through Registry Surfaces Catalog using `surface_name` + `worksheet_gid`; legacy `Workbook Registry` and `Sheet Bindings` references are deprecated for active authority
- v2.22 - `binding_integrity_review` added as the canonical pre-dependency review stage for worksheet-governed runtime validation and row-audit schema alignment
- v2.21 - Runtime Binding Enforcement Rule added: execution-surface authority now requires Registry Surfaces Catalog and authoritative `worksheet_gid` validation (exists, valid, actual-binding match) before execution may proceed
- v2.21 - runtime binding authority now explicitly forbids `sheet_name`/`tab_name` as execution-resolution authority; failed `worksheet_gid` checks must block execution or enter repair-aware mode
- v2.20 - Version Conflict Resolution Rule added: duplicate active `route_id`, `workflow_id`, or `chain_id` rows now classify as invalid configuration, with highest-version deterministic conflict handling until repaired
- v2.20 - Full Audit Governance Scope Extension added: full_system_intelligence_audit now explicitly requires execution bindings, execution chains, decision engine, runtime actions/endpoints, system enforcement, and execution-log import validation dependencies
- v2.19 - Full Audit Governance Scope added: full_system_intelligence_audit now requires execution policy, staged/component review, repair mapping, and row-audit governance surfaces where applicable
- v2.19 - full-audit route/workflow authority and strict validation expectations added; Business Intelligence Scoreboard is now explicitly downstream-only and non-authoritative for execution
- v2.18 - API Action Capability vs Endpoint Inventory Rule added: Actions Registry and API Actions Endpoint Registry now have explicit split authority between parent capability identity and endpoint inventory metadata governance
- v2.18 - endpoint-metadata completeness is now required for endpoint readiness classification, but missing endpoint metadata no longer implies GPT action non-existence when runtime access is already known
- v2.17 - Analytics Identity Issue Governance Rule added: analytics identity defects are now governed issues with mandatory Review Findings Log entry, Active Issues Dashboard surfacing, execution-classification constraints, and repair/reconciliation lifecycle handling
- v2.17 - analytics identity issue deduplication keys are now governed per brand, execution cycle, and defect type so duplicate findings are prevented while preserving remediation traceability
- v2.16 - Brand-Domain Analytics Governance Rule added: analytics authority now requires brand-domain identity alignment across Brand Registry, property bindings, warehouse schema, and runtime execution identity
- v2.16 - canonical GSC warehouse schema now includes `brand_domain`; registry validation must downgrade readiness and require reconciliation when brand-domain identity is missing or misaligned
- v2.15 - Analytics Warehouse Schema Governance Rule added: Business Metrics Warehouse targets (`GSC Data`, `GA4 Data`) are now explicitly governed as authoritative analytics sheet-sync surfaces with workbook/sheet/schema/source compatibility validation and write/review/repair compatibility requirements
- v2.15 - canonical GA4 and GSC warehouse header schemas added; malformed or headerless analytics sheets now require downgrade, reconciliation flagging, and recovered-write prevention until aligned
- v2.14 - Registry Reconciliation Governance Rule added: structural architecture changes now require cross-registry reconciliation across dependencies, bindings, routing, workflow, policy, and canonical validation surfaces before conflicting legacy rows may be treated as valid authority
- v2.14 - reconciliation-aware signal and completion rules added so stale superseded architecture rows are downgraded, flagged, or blocked until aligned
- v2.13 - `exact_active_knowledge_only` resolution_rule; **canonical_source_priority** alignment (knowledge_layer then canonical_url); `source_mode = knowledge_layer`; runtime selection pseudocode updated; Knowledge Layer Authority section; loader contract and completion standard extended
- v2.12 - Canonical URL authority for migrated core dependencies; `exact_active_url_only` resolution_rule; host allowlist and extension validation; conflict governance (URL over Drive); loader contract updated for URL vs Drive resolution; migration and repair rules; audit expectations; reference URL map
- v2.11 - Brand Registry tracking bindings (`gsc_property`, `ga_property_id`, `gtm_container_id`) authority and validation rules added; Search Ads 360 retirement and GA Data / GA Admin replacement governance added; API Actions Endpoint Registry validation rules added for analytics and expanded GTM categories; completion standard extended for tracking and endpoint registry alignment

- v2.10 - Workflow Registry chain-workflow authority rules added so chain workflows are governed as first-class executable workflow rows
- v2.10 - required minimum workflow-row fields added for direct, decision-triggered, and chain-triggered workflows
- v2.10 - authority precedence clarified between Task Routes, Execution Chains, and Workflow Registry
- v2.10 - canonical remediation strengthened so incomplete chain workflow rows must be repaired in Workflow Registry rather than compensated for downstream
- v2.9 - Growth Loop Engine Registry added as a governed registry surface for loop-trigger authority
- v2.9 - scoring feedback governance added for output_quality_score, seo_score, business_score, execution_score, and optimization_trigger
- v2.9 - adaptive optimization governance added for workflow prioritization, engine sequencing, and governed routing-weight adjustments
- v2.8 - dynamic observability conversion expanded to distinguish authoritative write surfaces from derived observability surfaces including Anomaly Detection and Execution Log Unified
- v2.8 - anomaly detection layer acknowledged as a canonical derived observability surface
- v2.8 - repair execution import and unified-log model recognized as derived observability behavior rather than direct-write authority
- v2.8 - binding_schema_migration_review retained as a mandatory review stage between registry and dependency validation
- v2.8 - governed trigger-key activation rules added before autonomous or governed execution may proceed
- v2.7 - added `binding_schema_migration_review` as mandatory review stage between registry and dependency validation
- v2.7 - added authoritative repair governance for `Workbook Registry`, `Sheet Bindings`, and `Execution Bindings`
- v2.7 - added canonical binding-class enforcement
- v2.7 - added traceability and outcome model for repaired and migrated binding rows
- v2.7 - aligned derived-view policy so authoritative defects are repaired at source, not masked in observability surfaces
- v2.7 - dynamic observability governance added to distinguish authoritative write surfaces from derived observability surfaces
- v2.7 - Execution View, Active Issues Dashboard, and aggregation-only Review Control Center are now governed as derived observability surfaces by default
- v2.7 - derived-view repair signals and dynamic-data preference rule added for observability-safe recovery
- v2.6 - canonical Registry Workbook tab names now match live names exactly: Dependencies Registry, Workbook Registry, Sheet Bindings, Engines Registry, and Execution Bindings
- v2.6 - canonical logging sheet name now matches the live tab name Execution Log
- v2.5 - runtime binding resolution now explicitly degrades when required bindings do not resolve from Registry authority
- v2.5 - missing sheet gids and missing Activity Log Execution Log bindings now explicitly degrade execution trust
- v2.5 - duplicate non-authoritative dependency copies must now be ignored in favor of the Registry-listed file_id
- v2.4 - execution policy authority governance added
- v2.4 - review authority vs review observability separation clarified
- v2.4 - Registry-bound review authority sheets recognized as runtime-governing dependencies
- v2.4 - row-audit authority governance added
- v2.4 - policy and review-authority repair signals expanded


- v1 Ã¢â‚¬â€ registry logic separated from data
- v2 Ã¢â‚¬â€ repair-aware registry governance added
- v2 Ã¢â‚¬â€ validation state model expanded
- v2 Ã¢â‚¬â€ binding validation strengthened
- v2 Ã¢â‚¬â€ repair signal emission added
- v2 Ã¢â‚¬â€ degraded registry handling added
- v2.1 Ã¢â‚¬â€ authority_status model added
- v2.1 Ã¢â‚¬â€ resolution_rule governance added
- v2.1 Ã¢â‚¬â€ target_scope validation added
- v2.1 Ã¢â‚¬â€ fallback governance formalized
- v2.1 Ã¢â‚¬â€ candidate promotion and rollback rules added
- v2.1 Ã¢â‚¬â€ repair severity model corrected
- v2.1 Ã¢â‚¬â€ loader authority contract strengthened
- v2.2 Ã¢â‚¬â€ monitoring surface governance added
- v2.2 Ã¢â‚¬â€ execution_view_sheet recognized as registry-governed monitoring worksheet dependency
- v2.2 Ã¢â‚¬â€ active_issues_dashboard_sheet recognized as registry-governed monitoring worksheet dependency
- v2.2 Ã¢â‚¬â€ monitoring surface binding failures added to repair signal emission guidance
- v2.3 Ã¢â‚¬â€ strict routing authority rule added
- v2.3 Ã¢â‚¬â€ route binding authority model added
- v2.3 Ã¢â‚¬â€ routed execution authority contract added
- v2.3 Ã¢â‚¬â€ strict route validation interpretation added
- v2.3 Ã¢â‚¬â€ strict routing repair signals expanded
- v2.3 Ã¢â‚¬â€ cross-layer routed authority enforcement clarified
- v2.40 - Logic Knowledge Layer Authority Rule added so logic-specific, cross-logic, and shared knowledge dependencies are resolved before full-success authority
- v2.40 - Business-Type Knowledge Profile Authority Rule added so business-aware tasks resolve profile dependencies before full-success authority
