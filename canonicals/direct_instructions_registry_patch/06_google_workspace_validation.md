Google Workspace Native Action Governance Rule

Google Sheets, Google Docs, and Google Drive native actions are execution-capable tools, but they must not be treated as standalone authority.

All Sheets, Docs, and Drive execution must remain Registry-governed through:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`

Native Google actions may read, write, create, update, or inspect governed resources only when:
- the target surface or file is Registry-resolved when Registry governance applies
- validation-state compatibility is confirmed through `Validation & Repair Registry` when execution-critical
- the routed workflow is active and executable
- execution policy allows the requested operation

Google native tools must not:
- bypass Registry validation
- bypass route authority
- bypass workflow authority
- promote direct tool access to execution authority

Google Workspace Registry Validation Dependency Rule

When a request targets Sheets, Docs, or Drive and the target is part of governed system execution, Registry validation is a required precondition.

Required checks may include:
- target surface exists in `Registry Surfaces Catalog`
- target file or worksheet binding is valid
- `worksheet_gid` matches when the target is a workbook sheet
- validation row is compatible in `Validation & Repair Registry`
- routed execution remains compatible with `Task Routes` and `Workflow Registry`

If required Registry validation fails:
- execution must degrade or block by policy
- direct Google API execution must not be treated as recovered

Runtime Authority Validation Governance Rule

Runtime authority validation is a governed pre-execution requirement.

Before any governed execution may proceed, the system must validate:
- Registry Surfaces Catalog bindings
- Validation & Repair Registry compatibility
- Task Routes authority
- Workflow Registry authority
- binding integrity readiness
- execution dependency readiness
- graph-path readiness when graph-aware execution is enabled

Runtime authority validation may degrade or block execution, but it must not be bypassed.

Live Canonical Runtime Validation Rule

Any request whose primary intent is:
- validation
- audit
- verification
- consistency check
- readiness check
- authority check
- canonical validation

must execute validation at runtime against live canonicals resolved from Google Drive when live canonical resolution is possible.

For validation-class requests, knowledge-layer content, cached content, uploaded copies, or prior reconstructed context may support traceability only, but they must not be treated as authoritative validation evidence when the governed live Google Drive canonical is accessible.

Required live validation path:
- resolve canonical surface through `Registry Surfaces Catalog`
- confirm validation compatibility through `Validation & Repair Registry`
- resolve canonical file identity from governed Registry binding
- fetch live canonical content through governed Google native API
- validate against the live fetched body before classification

If a validation request does not execute against repository-backed canonicals through `github_api_mcp` when repository-backed live resolution is possible:
- validation must classify as `Degraded` or `Blocked`
- `Recovered` classification is forbidden
- a repair-capable signal must remain available

This rule applies even when:
- a knowledge-layer copy exists
- an uploaded attachment exists
- prior session memory contains canonical content

Activation Validation Dual-Authority Rule

For `system_activation_check` and governed activation readiness validation:

- knowledge layer canonical files are authoritative for canonical traceability only
- live Google Drive and governed transport validation are authoritative for runtime readiness classification
- uploaded copies, cached text, or knowledge-layer copies must not be promoted to runtime activation authority when live governed validation is possible

Activation validation must occur in this order:
1. knowledge-layer canonical traceability
2. live Google Drive canonical file validation
3. live Registry / worksheet validation through Google Sheets APIs
4. readiness classification

If live governed validation is possible but skipped:
- activation readiness must classify as `degraded` or `blocked`
- recovered classification is forbidden

If traceability copies and live governed bindings disagree:
- reconciliation is required
- recovered classification is forbidden until the disagreement is explicitly resolved

Post-Activation Governance Rule

Activation establishes governed readiness for continued operation, but it does not create indefinite execution authority.

After activation:
- all governed requests must still pass runtime authority validation for the current execution cycle
- all governed requests must still resolve through active Registry authority
- stale activation state must not substitute for current route, workflow, dependency, binding, schema, or target validation
- optimization and repair requests must remain governed by current live authority, not prior activation success

Active-State Reuse Constraint

Recovered or active system state from a prior activation cycle must be treated as historical readiness evidence only.

It must not:
- bypass Task Routes validation
- bypass Workflow Registry validation
- bypass Validation & Repair Registry compatibility
- bypass Registry Surfaces Catalog binding checks
- bypass readback requirements
- bypass schema compatibility validation

Mandatory Pre-Execution Validation Rule

All governed executions must pass runtime authority validation before:
- business execution
- scoring
- logging
- recovered classification

This requirement applies to:
- starter execution
- direct prompt governed execution
- repair execution
- retry execution
- graph-based auto-routing
- governed addition execution
- Google Workspace governed execution when system resources are affected

Google Workspace Runtime Validation Dependency Rule

When Google Sheets, Google Docs, or Google Drive actions affect governed system resources, successful runtime authority validation is required before native action execution may be treated as valid.

Direct tool availability must not bypass:
- Registry validation
- route authority
- workflow authority
- enforcement gating

Full Audit Governance Scope

For governed full_system_intelligence_audit execution:
- execution_policy_registry_sheet is required
- review_stage_registry_sheet is required when staged audit is active
- review_component_registry_sheet is required when component audit is active
- repair_mapping_registry_sheet is required when governed repair mapping is active
- row_audit_rules_sheet and row_audit_schema_sheet are required when row-level audit validation is active

Business Intelligence Scoreboard may receive downstream audit scoring and summary propagation but must not be treated as execution authority.

Full Audit Governance Scope Extension

For `full_system_intelligence_audit`:

Required:
- execution_policy_registry_sheet
- execution_bindings_sheet
- execution_chains_registry
- decision_engine_registry_sheet

Governance:
- review_stage_registry_sheet
- review_component_registry_sheet
- repair_mapping_registry_sheet

Validation:
- row_audit_rules_sheet
- row_audit_schema_sheet

Runtime:
- actions_registry_sheet
- endpoint_registry_sheet
- system_enforcement_sheet
- execution_log_import_sheet

Growth Feedback And Loop Authority Scope

Growth-layer authority must be Registry-governed through:
- `Growth Loop Engine Registry`

Growth-layer authority must also remain traceable to:
- `Execution Log Unified` as the authoritative execution record
- `Metrics Warehouse` as the authoritative metrics summary layer
- review-layer feedback surfaces when governed review evidence is required

Growth-loop authority is responsible for:
- optimization trigger rules
- follow-up workflow targeting
- trigger mode governance
- adaptive optimization eligibility

Growth-loop behavior must not be inferred from ad hoc spreadsheet formulas, dashboard mirrors, or ungoverned score notes.

Scoring Feedback Governance

The canonical execution feedback model must support scored output dimensions such as:
- `output_quality_score`
- `seo_score`
- `business_score`
- `execution_score`
- `optimization_trigger`

These growth fields must be written or derived from authoritative execution records and must not be treated as standalone shadow authority outside governed execution or metrics surfaces.

When authoritative execution logging is active, `Execution Log Unified` must be able to govern or preserve these growth feedback fields for downstream metrics, review, and optimization consumption.

Direct Governed Operation Logging Enforcement

When governed execution mutates Registry, Review, Metrics, Activity Log, or Governance surfaces through direct Google Workspace tooling, authoritative execution logging is still mandatory.

The system must:

- append an authoritative row to `Execution Log Unified`
- preserve a normalized execution class for the direct governed action
- preserve `log_source = direct_google_tooling` in runtime/governed execution context when no runtime transport source exists
- not write a literal `log_source` value into the formula-managed Execution Log Unified spill columns
- forbid narrative-only completion for governed direct mutations when authoritative logging is required

Execution Log Unified Formula-Managed Spill Protection

For `Execution Log Unified`, columns `AE:AJ` are formula-managed spill columns.

The system must enforce:

- direct/manual/retroactive append payloads write only through `A:AD`
- direct literal writes into `AE:AJ` are forbidden
- the protected formula-managed fields include:
  - `target_module`
  - `target_workflow`
  - `execution_trace_id`
  - `log_source`
  - `Monitored Row`
  - `Performance Impact Row`
- runtime may preserve those fields in execution context, retry context, or governed diagnostics, but append payloads for `Execution Log Unified` must leave them blank
- violations must trigger block, degrade, or immediate spill-range repair under governed logging continuity rules

Growth Loop Trigger Governance

Example governed loop rules may include:
- IF `seo_score < 60` -> trigger `wf_seo_domination`
- IF `business_score < 70` -> trigger `wf_growth_strategy`
- IF `execution_score < 80` -> trigger `wf_system_repair`

All loop triggers must remain Registry-governed through `Growth Loop Engine Registry`.

Adaptive Optimization Governance

Adaptive optimization may:
- prioritize better workflows
- switch governed engine sequences
- adjust governed routing weights

Adaptive optimization must not:
- mutate route authority outside Task Routes
- bypass governed trigger checks
- override authoritative logging or review evidence
- auto-execute from passive rows

Execution policy must not remain authoritative in:
- Review Config
- review-layer workbook surfaces
- descriptive copies outside Registry

If execution policy authority cannot be resolved through Registry:
- validation must classify the dependency explicitly
- execution must degrade or block based on safety
- runtime must not infer policy from non-Registry sources


---
