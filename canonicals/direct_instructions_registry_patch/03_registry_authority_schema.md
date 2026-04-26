Source of Truth Rule


The Registry Workbook is the single source of truth for all live dependency bindings.


Registry authority includes:
- route definitions
- workflow bindings
- dependency locations
- file and sheet bindings
- active production dependency references

For strict-mode execution, route definitions must be runtime-resolvable through Task Routes and must not remain conceptual-only.

If Registry authority cannot be validated:
- the system must trigger registry_repair
- execution must degrade or block based on safety
- authority must not be overridden by fallback assumptions

Duplicate Header Blocking Rule

Duplicate header names on authoritative governed sheets are forbidden when those
sheets determine:
- capability authority
- endpoint authority
- execution policy authority
- transport readiness
- auth-path readiness

If duplicate headers are detected on an execution-critical governed surface:
- execution must block or degrade
- silent last-column-wins behavior is forbidden
- repair-aware handling must remain available
- recovered classification is forbidden until duplicate-header state is removed

Dynamic Provider-Domain Placeholder Authority Rule

When an authoritative endpoint row declares a placeholder `provider_domain`
such as `target_resolved`, the placeholder must be treated as governed runtime
resolution state rather than literal provider-domain authority.

Placeholder provider-domain resolution must:
- be enabled by active policy
- preserve source traceability
- use only governed allowed resolution sources
- remain subordinate to parent action authority, endpoint authority, and auth-path routing authority

Unresolved placeholder provider-domain state must block or degrade execution.

---

Registry Activation Canonical Structure

The authoritative Registry Workbook must govern system surface identity through:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`

Legacy Registry Deprecation Rule

The following sheets are deprecated and non-authoritative:
- `Workbook Registry`
- `Sheet Bindings`
- `Dependencies Registry`
- `Canonical Validation Registry`

The authoritative runtime registries are:
- `Registry Surfaces Catalog` for surface-location authority
- `Validation & Repair Registry` for validation-state authority

Runtime Binding Enforcement Rule

All execution surfaces must be resolved using:
- `Registry Surfaces Catalog`
- `worksheet_gid` (authoritative)

Validation must confirm:
- `worksheet_gid` exists
- `worksheet_gid` is valid
- `worksheet_gid` matches actual sheet binding

`sheet_name` and `tab_name` must not be used for execution resolution.

If validation fails:
- execution must block or enter repair-aware mode

Schema Governance Rule

Each governed surface must declare:
- `schema_ref`
- `schema_version`
- `header_signature`
- `expected_column_count`
- `binding_mode`

Validation must verify:
- `schema_validation_status`
- `header_match_status`
- `schema_drift_detected`

Schema drift must trigger:
- degraded or blocked execution
- repair mapping when required

Schema Governance And Migration Rule

Each governed workbook surface must declare:
- `schema_ref`
- `schema_version`
- `header_signature`
- `expected_column_count`
- `binding_mode`

Live validation must compare current headers and column counts against governed schema metadata.

When schema drift or schema version mismatch is detected:
- `binding_integrity_review` must classify the state explicitly
- `schema_migration_review` must determine whether governed repair or migration may proceed
- rollback must remain available when enabled by policy

Schema Feedback Governance Rule

When a governed surface schema changes through column addition, removal, rename, reorder, or header mutation, the system must not treat drift detection alone as sufficient handling.

Approved schema change handling must also update:

- `Registry Surfaces Catalog`
  - `header_signature`
  - `expected_column_count`
  - `schema_version` when applicable

- `Validation & Repair Registry`
  - schema validation state
  - header match state
  - schema drift state
  - review traceability

Dependent route, workflow, write, and validation compatibility must be re-evaluated before recovered classification is allowed.

Silent schema metadata drift is forbidden.

---

Strict Routing Authority Rule

Task Routes is the authoritative Registry-governed routing surface for live route resolution.

For strict-mode routing, the Registry must authoritatively govern:
- route_id
- row_id
- active route eligibility
- intent_key
- brand_scope
- request_type
- route_mode
- target_module
- workflow_key
- lifecycle_mode
- memory_required
- logging_required
- review_required
- priority
- match_rule
- allowed_states
- degraded_action
- blocked_action
- registry_source
- last_validated_at

No live execution may treat route selection as valid unless the active routed record can be resolved through Task Routes.

If Task Routes authority cannot be validated:
- routing must degrade or block based on safety
- direct execution bypass is prohibited
- registry-aware repair signal emission must remain available

Full Audit Route And Workflow Authority

For `full_system_intelligence_audit` route intent:
- `Task Routes` must resolve an active governed route row
- `Workflow Registry` must resolve the executable governed workflow row aligned to that route
- staged and component audit semantics must remain bound to the resolved route/workflow pair
- audit execution must not collapse into lightweight scoring-only behavior unless degraded state is explicitly classified and traceable

Version Conflict Resolution Rule

For identical keys (`route_id`, `workflow_id`, `chain_id`):
- only one active row is allowed
- multiple active rows must be treated as invalid configuration
- highest version identifier must be selected when conflict is detected for deterministic conflict handling, while the configuration remains invalid until repaired

For `system_auto_bootstrap`:
- only one active route row is allowed
- only one active workflow row is allowed
- only one active policy bundle for bootstrap eligibility is allowed
- duplicate active bootstrap authorities must be treated as invalid configuration

---


Registry Scope


Supported dependency types:
- file
- document
- worksheet
- folder


Registry-governed validation surfaces include:
- spreadsheet_id
- surface_name
- worksheet_gid when required
- active_file_id
- dependency key uniqueness
- production status validity
- workbook ownership correctness
- layer-to-workbook alignment
- authority_status
- resolution_rule
- target_scope
- fallback_target when defined
- rollback_target when defined

For worksheet-governed runtime validation, `surface_name` and `worksheet_gid` are the authoritative binding fields. `sheet_name`, `tab_name`, and legacy `gid` wording must not be treated as active execution-binding authority.

Route-binding governance surfaces also include:
- Task Routes
- Workflow Registry

Strict route-binding governance includes:
- route_id uniqueness
- row_id traceability
- active route exclusivity where required
- route-to-workflow alignment
- route-to-module alignment

Graph Intelligence Authority Scope

Governed graph intelligence surfaces include:
- knowledge_graph_node_registry_sheet
- relationship_graph_registry_sheet

These surfaces support:
- execution-path integrity validation
- graph-aware prediction
- graph-aware optimization
- graph-aware auto-routing preparation

They do not replace:
- Task Routes
- Workflow Registry
- Execution Policy Registry

---

Execution Policy Authority Scope

Execution-governing policy must be Registry-governed through:
- execution_policy_registry_sheet

Execution Policy Registry is the authoritative worksheet dependency for:
- stage gating policy
- failure handling policy
- recovery scoring policy
- autopilot escalation policy
- repair loop stop policy
- stable-state policy

HTTP Async and Per-Target Credential Authority Clarification

Execution Policy Registry is also authoritative for:
- async HTTP job lifecycle governance
- timeout ceiling governance
- backend API key enforcement mode
- per-target credential resolution requirements
- Brand Registry to Hosting Account Registry credential-chain enforcement

These policy-governed behaviors must not be implemented as code-only behavior without matching registry-governed policy rows.

Google Workspace Governance Policy Rows

Execution Policy Registry should include active governed rows for native Google action enforcement:
- `Google Workspace Governance | Registry Validation Required For Native Actions | TRUE | TRUE | execution | system_bootstrap|module_loader|prompt_router | TRUE | governed Sheets, Docs, and Drive execution requires Registry validation before native action execution`
- `Google Workspace Governance | Native Action Direct Authority Forbidden | TRUE | TRUE | execution | system_bootstrap|prompt_router | TRUE | tool availability alone must not authorize execution`
- `Google Workspace Governance | Native Action Readback Required | TRUE | TRUE | execution | system_bootstrap | FALSE | governed write operations through Sheets, Docs, or Drive require post-write readback when applicable`
