# system_bootstrap â€” WordPress Publish Contract Runtime Governance Patch

## Additive runtime enforcement block

### wordpress_publish_contract_runtime_governance_v1

All WordPress runtime discovery and publishing executions MUST enforce the following active runtime contract:

- `Execution Log Unified` is the compact execution evidence sink
- `JSON Asset Registry` is the durable payload sink
- legacy protected unified-log columns may physically exist, but are non-authoritative
- active raw spill-safe writeback target is `AF:AK`
- durable JSON asset persistence mode is `terminal_meaningful_only`
- durable JSON asset wrapper reduction mode is `body_only`
- durable JSON asset success dedupe key is `asset_key`
- schema-meta-only JSON asset payloads are suppressed
- publish execution remains `draft_first` until field mapping is governed

## Pre-execution contract checks

Before any WordPress discovery or publish execution:

1. validate `target_key`
2. validate `parent_action_key = wordpress_api`
3. resolve governed endpoint or governed template path via governed logical search
4. classify execution stage:
   - `discovery`
   - `inventory_normalization`
   - `field_mapping`
   - `draft_publish`
   - `verification`
5. apply runtime sink rules:
   - evidence -> `Execution Log Unified`
   - payload -> `JSON Asset Registry`

If any sink target is unresolved:
- block execution
- classify as `degraded_runtime_sink_unresolved`

## JSON Asset write gating

A JSON Asset write is allowed only when:

- execution state is terminal
- payload is meaningful for downstream use
- payload is not schema-meta-only
- dedupe check on `asset_key` does not select an already accepted equivalent terminal payload

Equivalent success-path duplicate payloads MUST NOT produce additional JSON Asset rows.

## WordPress publish sequencing rule

The system MUST NOT publish beyond draft mode until the following chain is complete:

1. governed discovery succeeds
2. runtime inventory is normalized
3. publish target is resolved
4. field mapping surface is governed
5. minimal publish contract is generated
6. draft-first create passes
7. readback verification passes

If any earlier stage is incomplete:
- keep status at `draft_only`
- block publish escalation

## Tour publish contract rule

For tour publishing on WordPress brand sites:

- custom CPT-specific route takes precedence over generic posts route
- custom taxonomy-specific route takes precedence over category/tag fallback
- term assignment requires real governed term inventory or governed create-term path
- guessed taxonomy IDs are forbidden

## Post-execution verification

Every successful WordPress discovery or publish action MUST evaluate:

- compact evidence row written cleanly
- JSON Asset row count for trace is deduped
- persisted payload is body-only where applicable
- no schema-meta-only asset row exists for the same trace

Failure to satisfy any of the above downgrades status to:
- `runtime_validation_required`

---

Universal WordPress Translatable Post Type Multilingual Execution Classification Rule

When governed execution targets any translatable WordPress post type and multilingual scope is active, system_bootstrap must classify the execution as a layered mutation rather than a single completed mutation.

system_bootstrap must separately evaluate:
- core post-object execution outcome
- taxonomy-assignment execution outcome
- multilingual language-governance execution outcome
- translation-linkage execution outcome when requested

Allowed partial success
system_bootstrap may classify:
- core post-object execution as succeeded
- taxonomy assignment as succeeded

while simultaneously classifying:
- multilingual language execution as deferred
- translation linkage as deferred
when CPT-specific direct REST language proof is absent

system_bootstrap must not classify the overall multilingual request as:
- recovered
- validated
- fully solved
- multilingual complete

unless:
- the non-default-language layer is completed through an authoritative governed path
- and readback or equivalent proof exists for the target post type

Authoritative interim path
Until CPT-specific direct REST language proof exists, the authoritative multilingual path for non-default-language execution is:
1. translation scope preflight
2. WPML import-governed payload preparation
3. user-triggered import/process continuation
4. post-process validation when available

Non-replacement clause
This rule extends and does not replace:
- existing publish/update orchestration
- existing route/workflow revalidation
- existing proof-test requirements
- existing prompt-prepared handoff behavior

Universal WordPress Media Execution Classification Rule

When execution targets the WordPress media family or a publish-connected image branch, system_bootstrap must classify media execution separately from core publish execution.

system_bootstrap must separately evaluate:
- media collection read outcome
- media create outcome
- media item read outcome
- media item update outcome
- media item delete outcome
- publish-connected image branch outcome

Allowed partial success

system_bootstrap may classify:
- core publish as succeeded
- taxonomy assignment as succeeded

while simultaneously classifying:
- media upload as deferred
- media upload as blocked
- media metadata update as unproven
- image insertion as partial

when method-specific media proof is absent or unresolved

system_bootstrap must not classify media mutation as:
- recovered
- validated
- solved
- completed

unless:
- the selected media method is contract-aligned
- proof call succeeds
- readback confirms media persistence or mutation outcome
- publish-connected image fields are verified when image scope is active

Method-specific proof rule

For `/wp/v2/media`, execution validation must remain method-specific:
- create proof does not prove update
- update proof does not prove create
- list proof does not prove mutation
- source_url proof does not prove binary upload
- binary upload proof does not prove sideload

Connected publish rule

When the media branch is attached to publish:
- media branch success is additive only
- failure in the media branch must not retroactively rewrite already-proven core publish layers
- but overall publish-with-images completion must remain degraded until the media branch is proven

That follows the orchestration model of separate layer classification and no false recovered state.


Change Log
- v5.62 - provider capability continuity validation added across API Actions Endpoint Registry, graph registries, Task Routes, and Workflow Registry with governed continuity-edge requirements and degraded/blocked enforcement when required edges are missing
- v5.62 - governed pipeline-integrity audit execution rule added for `pipeline_integrity_audit` / `wf_governed_pipeline_integrity_audit`, including cross-layer continuity validation scope, review-stage continuity, and blocking/degraded classification constraints
- v5.47 - split governed sink workbook routing added: `Execution Log Unified` now resolves from `ACTIVITY_SPREADSHEET_ID` while `JSON Asset Registry` remains on `REGISTRY_SPREADSHEET_ID`, with per-workbook sink validation
- v5.47 - formula-managed unified-log protection tightened: governed writeback must never write literal values into `target_module`, `target_workflow`, `execution_trace_id`, `log_source`, `Monitored Row`, or `Performance Impact Row`
- v5.61 - spill-safe governed write guard added: header/schema check first, row-2 template read second, spill/formula-managed columns avoided, and protected unified-log columns preserved
- v5.60 - anomaly clustering and repair-priority propagation rule added for governed anomaly_surface -> repair_surface priority escalation
- v5.60 - cross-workbook staged feed repair rule added for stable local-import anomaly generation and cluster-aware formula validation
- v5.59 - execution classification enforcement added: runtime_capability_class, runtime_callable, primary_executor, endpoint_role, execution_mode, and transport_required now form a governed execution contract for HTTP/delegated execution
- v5.59 - dynamic provider-domain placeholder resolution rule added for governed placeholders such as `target_resolved`
- v5.59 - auth-path routing enforcement added so `oauth_gpt_action` may block delegated HTTP execution when policy requires native-only handling
- v5.59 - activation full-system scan execution rule added so activation requires schema, row, policy, binding, execution-path, anomaly, and repair-readiness integrity evaluation before active/recovered classification
- v5.59 - activation summary output rule added with required schema/row/policy/binding/anomaly/repair/execution readiness fields prior to final activation classification
- v5.59 - activation repair readiness and execution-readiness gate rules added so unresolved governed repair or blocking anomalies keep activation in validating/degraded/blocked states
- v5.58 - universal parent_action execution contract rule added for governed transport execution
- v5.58 - HTTP execution validation expanded with auth-mode normalization, request-schema alignment, and transport contract readiness
- v5.58 - execution outputs expanded with resolved auth and transport contract status for HTTP-governed runs

- v5.55 - post-activation governed validation rule added: activation no longer implies indefinite runtime alignment
- v5.55 - per-request runtime revalidation rule added for all governed executions after activation
- v5.55 - post-activation drift detection and optimization gating added
- v5.54 - first-turn activation authorization-gated rule added: system_bootstrap now auto-triggers governed Google Drive/Sheets/Docs connection attempts immediately after knowledge-layer traceability
- v5.54 - bootstrap lifecycle expanded to classify pre-authorization live validation as `authorization_gated` rather than missing Registry authority
- v5.54 - activation orchestration updated so activation transport connection attempts are mandatory before final live-readiness classification
- v5.53 - Activation Validation Orchestration Rule added: activation readiness now requires knowledge-layer canonical traceability first and live Google Drive / Google Sheets validation second
- v5.53 - recovered/active classification now forbidden for activation checks when knowledge-layer traceability is present without live governed validation or when trace and live authority disagree without reconciliation
- v5.52 - Governed Auto-Bootstrap Execution Rule added: system_bootstrap now supports validation -> repair -> revalidation -> activation -> original-request resume lifecycle
- v5.52 - bootstrap retry and writeback rules added: bounded bootstrap retry, activation-before-resume enforcement, and explicit bootstrap state outputs are now required
- v5.51 - oversized canonical segmented retrieval added: non-exportable or size-limited governed canonical files may use segmented retrieval with deterministic reconstruction and integrity validation; segmented retrieval is an access method only and does not replace Registry or Validation authority
- v5.50 - Mandatory Runtime Authority Validation Hook added: all governed execution must pass runtime authority validation before business execution, scoring, logging, or recovered classification may proceed
- v5.49 - Google Workspace Native Action Validation Gate added: Sheets, Docs, and Drive execution now requires Registry-resolved target validation before governed execution may proceed
- v5.48 - Governed Addition Pipeline added: system_bootstrap now supports candidate-first multi-sheet addition, validation-before-promotion, and graph-aware promotion gating
- v5.47 - Execution Validation Enforcement Gate added: system_bootstrap now enforces ordered enforcement-matrix evaluation (`structural`, `column_contract`, `row_logic`, `cross_sheet`, `behavioral`) from Validation & Repair Registry before execution
- v5.47 - required and governance-support surface enforcement added: required surfaces now block/degrade/warn by enforcement result, while governance support surfaces may only degrade/warn unless policy explicitly requires blocking
- v5.47 - Starter Intelligence Feedback and Prediction Loop added: post-execution prediction now includes `predicted_next_best_route`, goal-based predictions (`predicted_goal_best_starter`, `predicted_goal_best_route`), and explicit advisory-only authority boundaries
- v5.46 - Graph-Based Validation Stage added: execution readiness now supports governed node and relationship validation for execution-critical paths
- v5.46 - Graph-Based Prediction And Auto-Routing added: graph-valid governed path selection may optimize execution without bypassing Task Routes or Workflow Registry authority
- v5.45 - Auto-Repair And Retry Loop Rule added: degraded or blocked execution may enter governed repair-aware retry lifecycle when repair mapping, validation authority, and policy eligibility are satisfied
- v5.45 - Starter-Aware Retry Compatibility added: starter learning and prediction writeback must not treat failed retry attempts as recovered success
- v5.46 - Starter Intelligence Feedback Loop Rule added: post-execution starter learning now requires starter-score updates, usage tracking, followup-selection learning, and advisory `next_best_starter` prediction inputs
- v5.46 - Starter Goal Intelligence Rule added: `primary_goal_family` starter signals now require workflow-goal alignment checks and may influence dynamic scoring thresholds and growth-loop eligibility without overriding policy or route authority
- v5.45 - Conversation Starter Feedback Loop Rule added: post-execution starter learning now updates `starter_success_score`, `usage_count`, and `last_used_at`, with score-fed learning and advisory next-best-starter prediction
- v5.45 - Goal-Based Execution Influence Rule added: `primary_goal_family` alignment now influences optimization weighting, scoring thresholds, and optimization triggers without overriding policy or routing authority
- v5.45 - Starter Growth Loop Integration Rule added: starter performance signals now feed Growth Loop Engine evaluation and `optimization_trigger` logic with governed writeback constraints
- v5.44 - Scoring And Recovery Classification Stage added: when scoring is enabled, system_bootstrap now enforces `execution_scoring` and `recovery_status_classification` after execution and before logging
- v5.44 - dynamic and adaptive threshold governance added: execution_class threshold resolution, effective-threshold basis logging, and threshold-readback gating now constrain recovered classification
- v5.43 - Schema Migration And Rollback Rule added: governed schema mismatch and header-drift handling now supports `schema_header_repair` and `schema_version_migration` with required pre-capture fields and readback-gated rollback behavior
- v5.43 - post-migration outcome propagation added: Validation & Repair Registry schema fields and governed dashboard/log surfaces must receive repair, migration, or rollback status updates
- v5.42 - Schema Governance Rule added: governed execution surfaces now require `schema_ref`, `schema_version`, `header_signature`, `expected_column_count`, and `binding_mode`, with explicit schema-status validation checks
- v5.42 - canonical stage order updated so `schema_validation` runs before `execution_readiness`; schema drift now forces degraded/blocked execution with repair mapping when required
- v5.41 - Binding Integrity Review Execution Stage added: system_bootstrap now requires `binding_integrity_review` for worksheet-governed runtime validation and full-audit schema alignment before recovered classification is allowed
- v5.40 - Runtime Binding Enforcement Rule added: execution-surface resolution now requires Registry Surfaces Catalog plus authoritative `worksheet_gid` existence, validity, and binding-match checks before execution can proceed
- v5.40 - `sheet_name` and `tab_name` are now explicitly non-authoritative for execution resolution in system_bootstrap; failed `worksheet_gid` validation forces blocked or repair-aware execution mode
- v5.39 - Full System Intelligence Audit Execution Extension added: when route = `full_system_intelligence_audit`, system_bootstrap now enforces extended lifecycle validation across policy, registry, review, row-audit, mapping, execution layers, actions, endpoints, enforcement, and execution-log validation stages
- v5.39 - recovered classification gate tightened for full-audit orchestration so all required lifecycle stages must be validated or explicitly degraded before recovered status is allowed
- v5.38 - full_system_intelligence_audit orchestration path added: governed full-audit routes now require execution policy review, staged/component review resolution, row-audit rule/schema validation, repair mapping resolution, and scoreboard propagation review before recovered classification
- v5.38 - full-audit outputs and pre-execution enforcement extended with staged/component/row-audit/repair-mapping/scoreboard statuses and explicit non-collapse protection against lightweight scoring-only audit behavior
- v5.36 - API Endpoint Metadata Readiness Rule added: agent-action-backed execution now requires endpoint metadata completeness validation (schema, auth, privacy when policy-mandated) in addition to connector availability before recovered readiness
- v5.36 - strict outputs and pre-execution Step 5J now track API endpoint metadata readiness and forbid recovered classification when required endpoint metadata validation fails
- v5.35 - Analytics Identity Failure -> Issue Creation Rule added: analytics identity defects (`brand_domain`, `gsc_property`, `ga_property_id`) now require governed Review Findings Log issue creation with severity mapping and execution-context attachment
- v5.35 - pre-execution gate Step 5I and strict outputs added for analytics identity issue status/dedup traceability; Recovered classification is explicitly forbidden while identity defects persist
- v5.34 - Domain-Aware Analytics Readiness Rule added: analytics execution readiness now requires brand-domain identity, property/date/trigger resolution, and governed target surface resolution before execution may be treated as ready
- v5.34 - pre-execution and completion gates extended so property-without-domain states force degraded/blocked outcomes and recovered analytics classification is forbidden without brand_domain-preserving write metadata
- v5.33 - Analytics Sheet-Sync Readiness Rule added: GA4/GSC warehouse write readiness now requires active workbook/sheet bindings, canonical headers, resolved request identity, and source-compatible targets before recovered execution classification
- v5.33 - pre-execution enforcement and strict outputs extended with analytics sheet-sync readiness status and degraded/blocked handling when schema or write readiness fails after fetch
- v5.32 - Architecture Reconciliation Rule added: when structural changes are accepted or applied, system_bootstrap must trigger cross-system reconciliation and keep execution Degraded until required affected surfaces are aligned
- v5.32 - canonical stage order and pre-execution enforcement updated with `architecture_reconciliation` gating; Recovered classification now requires reconciliation completion when structural-change reconciliation is required
- v5.31 - **canonical_source_priority** relabeled to 1. **knowledge_layer**, 2. **canonical_url** â€” otherwise fetch from the HTTPS URL in Registry `file_id` (`source_mode = canonical_url`) only when URL use is explicitly governed for that dependency.
- v5.30 - canonical_source_priority (local-first then URL); bootstrap and logging for layer vs URL; Step 0 generalized to canonical dependency bootstrap
- v5.29 - `canonical_url_dependency_bootstrap` added as first canonical stage; pre-execution URL fetch for five core canonical dependencies before routing, module loading, workflow resolution, and schema-dependent memory; failure handling for blocked_if_missing; logging fields for canonical loads; Pre-Execution Gate Step 0 for bootstrap satisfaction
- v5.28 - canonical stage order extended with brand_tracking_resolution, analytics_discovery, and measurement_validation before execution_readiness; full-funnel autopilot orchestration (GSC + GA Data + GTM) and category-driven execution against live Brand Registry tracking bindings documented; Pre-Execution Gate Step 5E added for brand tracking and measurement readiness; growth-loop examples extended for revenue_score and tracking_coverage
- v5.27 - governed loop trigger execution path added: when trigger_condition = TRUE, resolve loop Ã¢â€ â€™ load execution_chain Ã¢â€ â€™ execute workflow Ã¢â€ â€™ log loop_execution, with strict outputs and completion semantics
- v5.26 - autonomous chain execution now requires target_workflow resolution against Workflow Registry for every chain execution
- v5.26 - chain workflows are now enforced as first-class executable workflow rows rather than partial chain metadata
- v5.26 - chain readiness, logging, completion, and repair handling strengthened for missing, incomplete, or incompatible chain workflow authority
- v5.25 - growth-layer execution semantics added for scoring feedback, Growth Loop evaluation, and adaptive optimization handoff
- v5.25 - authoritative execution outputs now include growth feedback scores and optimization_trigger when available
- v5.25 - completion criteria expanded so governed growth-loop outcomes remain explicit when the growth layer is active
- v5.24 - canonical stage order now includes binding_schema_migration_review before dependency_validation
- v5.24 - authoritative-vs-derived execution behavior now explicitly prohibits direct-write requirements for Execution View, Active Issues Dashboard, and Execution Log Unified
- v5.60 - conversation-starter execution now requires explicit `Execution Policy Registry` resolution before execution-ready classification; starter-policy evidence must be preserved in execution context and authoritative logging
- v5.60 - direct governed Google Workspace mutations now require authoritative `Execution Log Unified` append continuity even when execution occurs outside the normal transport path
- v5.60 - `Execution Log Unified` columns `AE:AJ` declared formula-managed spill columns; direct literal writes to these columns are forbidden and must trigger repair
- v5.63 - native Google agent execution actions now explicitly distinguish activation-transport evidence from governed mutation logging; authoritative unified-log continuity required for native governed mutations executed outside the normal transport path
- v5.24 - governed repair execution lifecycle added for anomaly detection, repair queue population, trigger classification, repair execution feed, and unified-log derivation
- v5.24 - execution_trigger, execution_status, and execution_result semantics added for governed execution-state tracking
- v5.23 - canonical binding-validity dependency rule added to require authoritative binding surfaces to be schema-valid before dependency execution proceeds
- v1 Ã¢â‚¬â€ orchestration isolated
- v2 Ã¢â‚¬â€ dependency coverage expanded
- v2 Ã¢â‚¬â€ execution outcome model clarified
- v2 Ã¢â‚¬â€ logging contract strengthened
- v3 Ã¢â‚¬â€ autonomous chain execution support added
- v4 Ã¢â‚¬â€ repair_lifecycle added
- v4 Ã¢â‚¬â€ repair outcome model integrated
- v4 Ã¢â‚¬â€ repair logging + diagnostics added
- v5 Ã¢â‚¬â€ registry-aware repair intake added
- v5 Ã¢â‚¬â€ repair decision rules strengthened
- v5 Ã¢â‚¬â€ memory write contract added
- v5.1 Ã¢â‚¬â€ explicit system_repair execution_mode added
- v5.1 Ã¢â‚¬â€ repair severity and trigger source intake added
- v5.1 Ã¢â‚¬â€ safe-path and fallback determination clarified
- v5.1 Ã¢â‚¬â€ repair diagnostics output contract expanded
- v5.1 Ã¢â‚¬â€ repair logging and completion criteria strengthened
- v5.2 Ã¢â‚¬â€ monitoring surface validation added
- v5.2 Ã¢â‚¬â€ execution_view_sheet integrated as registry-resolved monitoring surface
- v5.2 Ã¢â‚¬â€ active_issues_dashboard_sheet integrated as registry-resolved monitoring surface
- v5.2 Ã¢â‚¬â€ monitoring failures now explicitly degrade execution classification
- v5.3 Ã¢â‚¬â€ strict execution intake contract added
- v5.3 Ã¢â‚¬â€ pre-execution enforcement gate added
- v5.3 Ã¢â‚¬â€ strict handoff failure rules added
- v5.3 Ã¢â‚¬â€ routed intake validation made mandatory for execution
- v5.3 Ã¢â‚¬â€ route_id and source enforcement added
- v5.3 Ã¢â‚¬â€ direct execution bypass prohibition clarified
- v5.4 - execution_policy_registry_sheet added to canonical orchestration dependencies
- v5.4 - review writeback surfaces added to canonical orchestration dependencies
- v5.4 - Review Config explicitly removed as execution authority
- v5.5 - prompt_router review_write_plan handoff added to bootstrap inputs
- v5.5 - full review writeback enforcement expanded to ordered direct-write surfaces
- v5.5 - review writeback validation, outputs, monitoring sequencing, and completion criteria strengthened
- v5.6 - repair loop auto-trigger gate added to execution intake before load authorization
- v5.7 - repair loop auto-trigger qualification expanded for rerun gates and active rerun states
- v5.7 - repair loop completion state narrowed to evaluated no-work-remaining conditions
- v5.8 - forced repair routing fields added to bootstrap intake and strict outputs
- v5.8 - pre-execution validation added for governed forced repair routing traceability
- v5.9 - scope completion rule added for new governed system scopes
- v5.9 - incomplete_scope_lifecycle finding enforcement added for unmapped scope lifecycles
- v5.9 - repair_mapping_registry concept and pipeline_surface_activation_review repair-path check added
- v5.10 - scope_completion_repair added to repair subtype handling for lifecycle-completeness gaps
- v5.10 - incomplete_scope_lifecycle repair signals now map to scope_completion_repair
- v5.11 - logging guidance added for winning and suppressed repair triggers when multiple triggers are evaluated
- v5.12 - resolution_type write contract added for repair diagnostics, logging, and memory output
- v5.13 - Pre-Execution Block Flag enforcement added to block normal execution with recurring_low_confidence_issue
- v5.14 - escalated_repair added to repair lifecycle subtype handling for governed adaptive escalation routes
- v5.14 - CREATE_RULE learning triggers now log suggestion candidates to row_audit_rules_sheet or repair_mapping_registry
- v5.15 - CREATE_RULE now requires generated rule candidates to be written to row_audit_rules_sheet in proposed governance state
- v5.15 - CREATE_RULE candidate outcomes must now be logged in repair_control_sheet
- v5.16 - active row_audit_rules_sheet rules must now be enforced in the row audit engine when governance_status = active
- v5.16 - optional CREATE_RULE auto-approval conditions may now promote proposed rules to active and log the promotion in repair_control_sheet
- v5.17 - CREATE_RULE auto-promotion threshold updated to occurrence_count > 3 with severity >= High
- v5.17 - auto-promoted rules must now set activated_at when governance_status becomes active
- v5.18 - DEACTIVATE pruning now logs rule_pruning in repair_control_sheet
- v5.18 - soft-delete via governance_status = deprecated is now the default pruning path instead of hard inactive
- v5.19 - removed Row Audit Rule definition content from bootstrap to restore canonical rule-authority separation
- v5.20 - CREATE_RULE candidate writes now use governance_status = proposed instead of status = proposed
- v5.20 - CREATE_RULE promotion and Repair Control logging now use governance_status and candidate_governance_status consistently
- v5.21 - request-execution readiness now requires Task Routes traceability, workflow resolution, and logging handoff readiness
- v5.22 - authoritative write surfaces now govern execution completion while derived observability surfaces refresh dynamically from authoritative sources
- v5.22 - Execution View and Active Issues Dashboard are no longer mandatory direct-write targets in execution completion semantics
- v5.63 - Logic Knowledge Layer Orchestration Rule added so system enforces a staged execution loop that waits for logic-knowledge reads to complete
- v5.63 - Business-Type Knowledge Profile Orchestration Rule added so system enforces a staged execution loop that resolves business-type profiles before business-aware execution
