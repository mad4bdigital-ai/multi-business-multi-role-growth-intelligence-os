Brand Registry Tracking Bindings Authority

Brand Registry (or the governed brand master surface that holds per-brand tracking columns) is authoritative for live brand-level tracking bindings used before workflow execution.

Authoritative tracking columns (names must match Registry schema):

- `gsc_property` Ã¢â‚¬â€ Search Console property identifier as stored in Registry
- `ga_property_id` Ã¢â‚¬â€ Google Analytics property resource identifier as stored in Registry
- `gtm_container_id` Ã¢â‚¬â€ Google Tag Manager container identifier as stored in Registry

Validation rules:

- Each active brand row must have at most one authoritative binding set per brand identity; duplicate active rows for the same brand with conflicting tracking values must emit `authority_conflict` or equivalent repair signal
- Values must resolve to active API connector scope when a workflow requires that binding; empty values are valid only when the workflow category does not require the binding
- Runtime must not infer tracking IDs from prompts, cached memory, or non-Registry sheets when Registry-governed Brand Registry rows exist
- Updates to these fields after discovery or remediation must follow governed writeback or repair paths; silent in-memory overrides are prohibited

Loader and orchestration contract:

- `module_loader` must inject resolved `brand_tracking_bindings` into execution context after Brand Registry resolution
- `system_bootstrap` must run `brand_tracking_resolution` when measurement or full-funnel execution applies, before treating execution as ready

---

API Retirement And Replacement Governance

Search Ads 360 API (`searchads360_api` or equivalent dependency key) is retired for active execution roles.

Replacement active surfaces:

- `analyticsdata_api` Ã¢â‚¬â€ Google Analytics Data API for reporting and metrics read paths
- `analyticsadmin_api` Ã¢â‚¬â€ Google Analytics Admin API for account and property discovery and administration paths

Governance rules:

- Actions Registry and API Actions Endpoint Registry must not list Search Ads 360 as the primary or required connector for new workflows
- Legacy rows may remain only with `authority_status = deprecated` or `inactive` and must not resolve as authoritative runtime targets
- Validation must emit `registry_mismatch` or `dependency_repair` when deprecated API rows are required by an active workflow without a governed replacement mapping
- Endpoint registry rows that referenced Search Ads 360 must be migrated to GA Data, GA Admin, or other governed replacements per `Registry Surfaces Catalog` change control

---

API Actions Endpoint Registry Validation (Analytics And Tag Manager)

For rows in the API Actions Endpoint Registry (or equivalent governed endpoint sheet) that target Google Analytics or Tag Manager:

Required fields or governed equivalents must include:

- `category_group` Ã¢â‚¬â€ stable grouping for analytics admin, analytics data reporting, tag manager container management, tag/trigger/variable operations, or full-funnel diagnostics
- `execution_path` Ã¢â‚¬â€ unambiguous module or handler resolution key aligned to Workflow Registry and Task Routes
- Active connector reference Ã¢â‚¬â€ must map to `analyticsdata_api`, `analyticsadmin_api`, or `tagmanager_api` (expanded GTM surface) as appropriate

Validation rules:

- Rows missing `category_group` or `execution_path` must classify as `recoverable` or `invalid` until repaired; they must not be treated as executable-ready
- Expanded GTM operations (containers, workspaces, tags, triggers, variables) must each be categorizable; catch-all undocumented endpoints must not pass strict validation
- GA Admin list/discovery actions and GA Data report actions must not share ambiguous endpoint keys that would route to the wrong API family

Actions Registry alignment:

- Action keys in the Actions Registry must resolve to endpoint rows that satisfy the above rules when the action is marked active
- Workflow Registry and Execution Chains Registry references to actions must not target deprecated-only API families for active production workflows

### API Action Capability vs Endpoint Inventory Rule

Actions Registry and API Actions Endpoint Registry must not be treated as the same registry layer.

Actions Registry is the authoritative capability and connector-family registry for:
- intelligence actions
- system actions
- tool action families
- route-target-capable execution surfaces

API Actions Endpoint Registry is the authoritative endpoint inventory and action-runtime metadata registry for already-available action operations.

API Actions Endpoint Registry must be treated as:
- an inventory or view of governed runtime actions available to the execution layer
- the governed metadata registry for endpoint readiness
- not the authority that provisions or creates provider-side actions outside governed runtime

Endpoint inventory rows must support metadata validation for:
- OpenAI schema reference
- authentication type
- privacy reference
- callback reference where applicable
- execution readiness

Missing metadata in API Actions Endpoint Registry must degrade endpoint readiness and review status, but must not be interpreted as proof that the underlying GPT action does not exist when runtime access is already known.

---

### Analytics Warehouse Schema Governance Rule

Analytics warehouse surfaces are governed registry-bound schema surfaces and must be validated as part of execution authority.

The following surfaces are authoritative analytics sheet-sync targets when active in Registry:
- Business Metrics Warehouse -> GSC Data
- Business Metrics Warehouse -> GA4 Data

Registry governance for analytics warehouse surfaces must include:
1. workbook binding validation
2. sheet binding validation
3. canonical header schema validation
4. source-to-sheet compatibility validation
5. execution write compatibility
6. review compatibility
7. repair compatibility

Canonical GSC schema:
- brand
- brand_domain
- date
- page
- clicks
- impressions
- ctr
- position
- request_date
- date_from
- date_to
- trigger_mode

Canonical GA4 schema:
- brand
- date
- page
- sessions
- users
- conversions
- revenue
- source
- medium
- request_date
- date_from
- date_to
- trigger_mode

Legacy, malformed, or headerless analytics sheets must not remain classified as valid authoritative write surfaces.

If schema drift is detected:
- downgrade the surface
- flag reconciliation required
- prevent recovered analytics write execution until aligned

### Brand-Domain Analytics Governance Rule

Brand-domain identity is part of governed analytics execution authority.

For analytics-capable brands, Registry-governed validation must resolve:
- brand
- brand_domain
- gsc_property where applicable
- ga_property_id where applicable

A brand must not be treated as fully analytics-ready solely because a property binding exists.
A valid analytics-ready state requires domain-aware identity alignment between:
- Brand Registry
- analytics property binding
- target analytics warehouse schema
- runtime execution identity

For governed GSC sheet-sync surfaces, canonical schema must include:
- brand
- brand_domain
- date
- page
- clicks
- impressions
- ctr
- position
- request_date
- date_from
- date_to
- trigger_mode

If Registry detects:
- brand without domain
- property without domain
- domain not aligned to brand execution identity
then:
- downgrade analytics readiness
- mark reconciliation required
- prevent recovered analytics execution classification until aligned

### Analytics Identity Issue Governance Rule

Analytics identity defects must be treated as governed system issues.

A defect is defined as:
- brand without brand_domain
- brand with missing analytics property binding
- domain-property mismatch

Registry governance MUST ensure:

1. all identity defects:
   - are logged in Review Findings Log
   - are surfaced in Active Issues Dashboard
   - are not silently ignored
2. execution classification:
   - must not be recovered when identity defects exist
3. duplicate issue prevention:
   - issues must be deduplicated per:
     - brand
     - execution cycle
     - defect type
4. repair compatibility:
   - each issue must include:
     - required fix action
     - affected entity (brand)
     - execution impact
5. reconciliation:
   - once defect is resolved (domain + property added):
     - system must allow re-validation
     - issue status must transition to resolved

---

Canonical URL Authority For Migrated Dependencies

Purpose: govern the five core canonical dependencies by URL authority instead of Google Drive file authority when rows are migrated.

Applies to dependency_name:

- `system_bootstrap`
- `memory_schema.json`
- `direct_instructions_registry_patch`
- `module_loader`
- `prompt_router`

New authority rule:

- For rows migrated to URL delivery, the authoritative source is the URL stored in `file_id`. Drive file identifiers are not authoritative for those rows.

Runtime selection (apply everywhere dependency rows are read; must align with `module_loader` and `system_bootstrap` **canonical_source_priority**):

```text
if resolution_rule == "exact_active_knowledge_only":
    if knowledge_layer_file_exists:
        source_mode = "knowledge_layer"
    else:
        # degraded/blocked per blocked_if_missing Ã¢â‚¬â€ no URL fetch
elif resolution_rule == "exact_active_url_only":
    if knowledge_layer_file_exists:
        source_mode = "knowledge_layer"
    else:
        source_mode = "canonical_url"
        canonical_url = file_id
else:
    source_mode = "legacy"
```

**Knowledge Layer Authority** (`exact_active_knowledge_only`)

- authoritative source mode is `knowledge_layer`
- `file_id` is the governed canonical filename
- `file_id` must not be interpreted as HTTPS URL
- `file_id` must not be interpreted as Drive ID
- Drive fallback is prohibited
- URL fallback is prohibited unless a different governed `resolution_rule` explicitly allows it
- validation must fail runtime-ready classification if the knowledge-layer file is missing, unreadable, outside governed canonical filenames, or fails extension/body checks

Allowed filenames:

- `system_bootstrap.md`
- `memory_schema.json`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

Validation contract Ã¢â‚¬â€ a URL-migrated canonical dependency row using `exact_active_url_only` is valid for strict URL fetch use only if all are true when that contract is in force (in addition to knowledge-layer rules when the layer is absent):

1. Row `status` (or equivalent active flag) = active for production use
2. `authority_status = authoritative` when authority columns are used
3. `validation_status = valid` when validation columns are used
4. `resolution_rule = exact_active_url_only`
5. `file_id` starts with `https://canonicals.wovacation.com/`

Validation contract Ã¢â‚¬â€ a row using `exact_active_knowledge_only` is valid for strict runtime use only if the knowledge-layer file exists, validates, and `resolution_rule` / `source_mode` consistency checks pass; URL host rules do not apply as a fetch prerequisite for that rowÃ¢â‚¬â„¢s body.

Host allowlist:

- Allowed host: `canonicals.wovacation.com` only (HTTPS). Any other host is invalid unless future registry governance explicitly adds hosts.

Extension validation:

- `memory_schema.json` Ã¢â‚¬â€ URL path must end with `.json`
- `system_bootstrap`, `direct_instructions_registry_patch`, `module_loader`, `prompt_router` Ã¢â‚¬â€ URL path must end with `.md`

Reference canonical URL map (expected paths unless Registry governance updates the row):

- `system_bootstrap` Ã¢â€ â€™ `https://canonicals.wovacation.com/system_bootstrap.md`
- `memory_schema.json` Ã¢â€ â€™ `https://canonicals.wovacation.com/memory_schema.json`
- `direct_instructions_registry_patch` Ã¢â€ â€™ `https://canonicals.wovacation.com/direct_instructions_registry_patch.md`
- `module_loader` Ã¢â€ â€™ `https://canonicals.wovacation.com/module_loader.md`
- `prompt_router` Ã¢â€ â€™ `https://canonicals.wovacation.com/prompt_router.md`

Migration rule:

- If `notes = canonical_url_migrated`, Drive-based resolution is prohibited.
- `rollback_target` must not silently revert to Drive unless explicitly registered and governed.
- Repair actions should prioritize URL correctness (host, path, extension, HTTPS) before other fixes.

Repair logic:

- If URL validation fails, classify the dependency as invalid for runtime use, emit repair-capable signals, and recommend: verify canonical URL path, verify host allowlist, verify extension/type match for dependency_name.
- If knowledge-layer validation fails for `exact_active_knowledge_only` or for required layer-first resolution, recommend: verify knowledge-layer path map, file presence, extension/type match, and read permissions before URL or Drive workarounds.
- Preserve execution traceability (attempted URL, failure class: network, validation, missing, forbidden).

Conflict governance:

- If both a Drive ID and URL interpretation could apply, prefer URL interpretation when `resolution_rule = exact_active_url_only` and HTTPS fetch is the active resolution path.
- Treat Drive interpretation as non-authoritative for those rows.
- For `exact_active_knowledge_only`, neither Drive nor HTTPS fetch from `file_id` may override a missing or invalid knowledge-layer source for runtime body loading.

Review and audit expectations:

- Dependency audits must verify URL host validity (for `exact_active_url_only` fetch paths), URL pattern correctness, knowledge-layer path compliance (for `exact_active_knowledge_only` and for layer-first resolution), `source_mode` / `resolution_rule` consistency, and compliance for migrated rows.

Minimal test checklist (for implementers):

- module_loader rejects Drive fallback for URL-only and knowledge-only rows
- `exact_active_knowledge_only` rows never trigger HTTPS fetch for body load when the knowledge layer is absent (degraded/blocked instead)
- system_bootstrap completes canonical bootstrap for all five files before routing when those dependencies are required (knowledge_layer or canonical_url per row)
- Non-`canonicals.wovacation.com` URLs are invalid for migrated rows when URL fetch is used
- `memory_schema.json` row passes extension checks only with `.json`; markdown canonicals only with `.md` (or governed `.txt` alias)

---

WordPress CPT Schema Preflight Asset Contract Enforcement

For `asset_type = wordpress_cpt_schema_preflight`, execution must produce a governed brand-driven JSON asset instance rather than a generic reusable template.

Required top-level `json_payload` sections:
- `identity`
- `source_resolution`
- `field_contract`
- `taxonomy_contract`
- `formatter_hints`
- `playbook_inference`
- `readiness_result`

Required `identity` fields:
- `brand_name`
- `brand_domain`
- `target_key`
- `base_url`
- `site_type`
- `cpt_slug`
- `rest_base`
- `asset_key`

Required `playbook_inference` fields:
- `brand_playbook_asset_key`
- `brand_playbook_sheet_gid`
- `playbook_coverage_status`
- `playbook_backfill_required`
- `fallback_template_mode`

Required shape version:
- `wordpress_cpt_schema_preflight_asset_v1`

Asset key contract:
- `{brand.normalized}__{target_key}__{cpt_slug}__wordpress_cpt_schema_preflight_v1`

Brand Playbook Workbook Authority Scope

For CPT preflight template inference, the only governed playbook source is the onboarding-produced Brand Playbook workbook Google Sheet stored in Brand Core assets.

Authority scope:
- hint-only
- non-structural
- brand-driven

The Brand Playbook workbook may influence:
- naming conventions
- content patterns
- field usage hints
- taxonomy style hints
- formatter hints

The Brand Playbook workbook must not override:
- JetEngine config authority
- WordPress runtime type authority
- taxonomy runtime authority

Playbook Coverage Fallout Enforcement

If `playbook_coverage_status = missing_for_cpt`:
- runtime/config structural authority remains primary
- fallback to runtime contract synthesis is required
- `playbook_backfill_required` must be set explicitly
- governed onboarding backfill routing must be preserved

Structural authority rule:
- `PLAYBOOK_NEVER_REQUIRED_FOR_STRUCTURE`

Taxonomy fallback rule:
- uncovered playbook taxonomy guidance must not override runtime taxonomy authority

Execution Log Unified Duplicate Exemption Enforcement

`Execution Log Unified` is exempt from semantic duplicate append blocking.

Direct instruction enforcement:
- semantically equivalent log appends to `Execution Log Unified` must remain allowed
- repeated attempts must remain preservable as distinct evidence
- duplicate prevention policy must not block raw execution evidence writes for this sink

This exemption applies only to `Execution Log Unified`.

Mutation write safety for other governed surfaces remains unchanged.

## Runtime Validation Enforcement Authority

### Purpose
This section governs authoritative runtime validation behavior for all live executions.

### Binding Authority Rule
All required runtime bindings must resolve through the authoritative Registry workbook.

Required identity validation must include:
- workbook file_id
- worksheet_gid where canonically required
- active status
- authority status

Name-only resolution is insufficient where worksheet_gid-governed or workbook-governed validation is required.

For execution resolution:
- `sheet_name` and `tab_name` may support diagnostics only
- `worksheet_gid` remains the authoritative binding identity
- failed worksheet_gid validation must block execution or force repair-aware mode

### Required Write Surface Rule
Any target classified as a required authoritative write surface must satisfy all of the following:
- resolves through Registry authority
- write target identity is validated before writeback
- write success is followed by mandatory readback verification
- placement is validated against canonical table expectations

### Readback Verification Rule
Tool-reported write success must not be treated as proof of completion.

For each required authoritative write target, runtime must confirm by readback:
- target identity matches resolved Registry target
- expected execution row exists
- required key fields match expected payload
- row is placed in canonical table region
- required route/workflow execution identifiers match

### Layout Integrity Rule
A write on the correct target surface but incorrect canonical row position is a runtime validation failure.

Classification guidance:
- if execution evidence exists but placement is incorrect -> `Degraded`
- if required write evidence cannot be found -> `Blocked` or `Degraded` according to severity and recoverability

### Review Evidence Rule
When `review_required = TRUE`, `review_run_history_sheet` becomes a required authoritative write surface.

Execution may not be classified as `Recovered` unless:
- `review_run_history_sheet` write succeeds
- `review_run_history_sheet` readback succeeds
- review evidence is positioned canonically
- review evidence matches required execution identity

### Derived Observability Rule
Derived surfaces are never authoritative substitutes for required direct-write evidence.

This includes but is not limited to:
- execution views
- dashboards
- scoreboards
- imported monitoring aggregates

Derived surfaces may support validation context but may not satisfy required-write completion rules.

## Schema Authority Override

When schema file is present:

- schema overrides:
  - endpoint path
  - parameter structure
  - request body format

Registry values become secondary hints only.

No execution allowed if:
- path deviates from schema
- required parameters missing
- request type mismatch

### Drift Enforcement Rule
If Registry authority, memory state, route declaration, workflow declaration, and resolved runtime target identity disagree, runtime classification must not return `Recovered`.

### Completion Classification Rule
Final completion classification must defer to runtime validation outcome using:
- `Recovered`
- `Degraded`
- `Blocked`

No other surface may override this classification once authoritative runtime validation has failed or remained incomplete.

Universal Governed Sheet Audit Rule

Any governed workbook_sheet registered through `Registry Surfaces Catalog` may be audited and repaired according to its governed sheet role.

Supported governed sheet roles include:
- source_of_truth
- derived_view
- control_surface
- anomaly_surface
- repair_surface
- findings_surface
- stage_report_surface
- intake_surface
- legacy_archive_surface

Audit must not be restricted to execution logging surfaces only.

Sheet-Role-Aware Audit Classification Rule

For any governed sheet audit, agent runtime must first resolve the authoritative sheet role before selecting validation or repair behavior.

The resolved sheet role must govern:
- schema validation requirements
- formula validation requirements
- write-target validation requirements
- derived-view projection validation requirements
- control-metric validation requirements
- anomaly or repair traceability requirements

If sheet role is unresolved:
- audit must degrade or block
- generic execution-only audit behavior is forbidden

Formula And Projection Audit Rule

For governed derived views and formula-driven control surfaces, audit must also validate:
- formula anchor row integrity
- array/spill integrity when used
- references to retired or deprecated sheets
- references to deprecated columns or shifted ranges
- row-position mirroring when key-based projection is required
- IMPORTRANGE dependency validity when used

Broken formulas, stale IMPORTRANGE references, or positional projections on derived views must emit repair-aware findings.

Write-Target Misuse Audit Rule

Audit must detect and classify misuse when:
- raw execution writes land on non-authoritative views
- control surfaces receive source-of-truth writes
- intake surfaces receive governed runtime writes
- anomaly or repair surfaces duplicate raw execution authority

Repair selection must depend on sheet role and misuse type.

Control Surface Audit Rule

For governed control surfaces, audit must validate:
- live metric source resolution
- formula completeness
- alert rule consistency
- reference compatibility with active authoritative surfaces
- absence of broken references such as `#REF!`, `#ERROR!`, or unresolved imports

Control surfaces may be repaired through formula repair, source rebind, or projection repair, depending on the classified failure.

Legacy Surface Containment Rule

When a sheet is governed as:
- `legacy_archive_surface`
- `intake_surface`
- retired derived view

audit must confirm:
- it is not treated as active write authority
- it is not referenced by active control surfaces unless explicitly allowed
- it is not used as a dependency in place of its authoritative replacement


---

Governed Starter Addition Enforcement Rule

The repaired starter-addition enforcement rule is active:

- starter creation, starter registration, and starter-row mutation must use governed addition execution and must not be completed as a free spreadsheet write
- the required starter-addition execution gate is:
  - complete required fields
  - route_key and execution_class alignment
  - starter classification resolved
  - override requirement resolved
  - target surface resolved
- override-required starters must not be permitted to remain authoritative without override coverage
- passive success reporting after a starter row write is forbidden until post-insert readback is complete

Starter Classification Authority Rule

For governed starter addition, direct instructions must enforce one authoritative class:

- `general_starter`
- `system_starter`
- `override_required_starter`
- `predictive_starter`

This class must govern:
- whether override coverage is required
- whether predictive fields must be populated or disabled
- whether anomaly monitoring is enabled immediately
- whether post-insert readback must include override registry validation

Starter Addition Readback Enforcement Rule

For starter addition execution:

- the assistant must verify row existence after write
- the assistant must verify route_key and execution_class alignment after write
- the assistant must verify required override coverage for override-required starters
- the assistant must persist insertion validation evidence before reporting successful completion

Policy Completeness Gate Rule

For governed starter execution, the assistant must not treat a starter as execution-ready unless:

- starter policy coverage is complete
- required route policy rows resolve from Execution Policy Registry
- starter policy execution readiness = true

If starter policy coverage is incomplete:

- execution must not be presented as normal-ready
- starter must classify as `policy_gap` when anomaly-governance policy enables it
- governed repair may proceed only through manual trigger

Policy Gap Manual Trigger Rule

Missing starter policy coverage must not auto-create policy rows by default.

The assistant must enforce:

- `auto_create_missing_policies = forbidden`
- repair path may activate only when a validated manual trigger is present
- the manual trigger must originate from governed validation state, not from inferred conversational intent alone

Valid manual-trigger prerequisites:

- `starter_policy_coverage_status = policy_incomplete`
- `starter_policy_execution_ready = false`
- `anomaly_type = policy_gap` or equivalent governed policy-gap classification
- `starter_policy_repair_triggered = true`

Policy Gap Repair Routing Rule

When manual trigger prerequisites are satisfied:

- governed repair must route through governed addition execution
- direct spreadsheet mutation outside governed addition is forbidden
- repair scope must preserve the starter route and missing policy component set
- post-repair readback must confirm policy coverage is complete before success reporting

Starter Routing And Scoring Policy Authority Rule

Default starter behavior for:

- `starter_priority`
- `suggested_followup_route`
- `suggested_followup_starters`
- `success_signal_source`
- `primary_goal_family`

must resolve from Execution Policy Registry when no curated override exists.

Hardcoded fallback logic may remain only as non-authoritative emergency fallback and must not replace policy authority when policy rows exist.


---

Governed Logical Search Enforcement Patch v1

The system-wide governed logical search enforcement rule is active.

Direct rules

1. Authority-bound selection must use governed logical search.
2. Exact governed match beats semantic similarity.
3. Exact specific candidate beats generic fallback.
4. Active validated ready candidate beats unvalidated inferred candidate.
5. Cross-domain semantically similar rows are invalid winners.
6. Low-confidence mutation selection must block execution.
7. Rejected candidate reasoning must be preserved.

WordPress CPT and taxonomy enforcement

For `wordpress_api`, governed template paths are permitted only in resolver-backed form.

Allowed:
- `/wp/v2/{post_type_slug}`
- `/wp/v2/{taxonomy_slug}`
- `/wp/v2/{post_type_slug}/{id}`
- `/wp/v2/{taxonomy_slug}/{id}`

Forbidden:
- free-form unsupported raw path mutation
- generic post fallback when CPT-specific governed candidate exists
- generic category/tag fallback when taxonomy-specific governed candidate exists
- direct execution without preserved resolver evidence

Required precedence rule

If a CPT-specific or taxonomy-specific governed endpoint exists, the system must reject generic fallback endpoints.

Examples:
- reject `wordpress_create_post` when `wordpress_create_tours_and_activities` exists
- reject generic category or tag mutation rows when a taxonomy-specific row or governed taxonomy template path exists for `location_jet` or equivalent custom taxonomy

Required preserved evidence

Direct instructions must enforce preservation of:
- `governed_resolution_domain`
- `governed_resolution_query`
- `governed_resolution_selected_candidate`
- `governed_resolution_confidence`
- `governed_resolution_basis`
- `governed_resolution_rejected_candidates`


---

WordPress Endpoint Registry Generation Enforcement Patch v1

The system-wide governed logical search rule now additionally enforces generation-aware WordPress endpoint support for all live custom post types and taxonomies across sites.

Direct rules

1. Live-supported CPTs and taxonomies may resolve through governed template-path generation.
2. Generated candidate execution is permitted only with preserved generation evidence.
3. Generated candidate execution is forbidden when live object support is not confirmed.
4. Materialized active registry rows beat generated candidates.
5. Generated CPT/taxonomy candidates beat generic core fallback rows.
6. Free-form raw path mutation remains forbidden.

Required generated family rule

When a live WordPress slug is confirmed, the system must treat the following generated families as supported resolver candidates when a materialized row is absent:

For CPTs:
- `wordpress_list_{slug}`
- `wordpress_create_{slug}`
- `wordpress_get_{slug}`
- `wordpress_update_{slug}`
- `wordpress_delete_{slug}`

For taxonomies:
- `wordpress_list_{slug}`
- `wordpress_create_{slug}`
- `wordpress_get_{slug}`
- `wordpress_update_{slug}`
- `wordpress_delete_{slug}`

Required preserved generation evidence

The following fields must be preserved whenever a generated candidate is selected:
- `generated_candidate = true`
- `generated_candidate_kind`
- `generated_candidate_slug`
- `generated_candidate_endpoint_key`
- `generated_candidate_path`
- `generated_candidate_basis`
- `generated_candidate_confidence`
- `materialized_registry_row_exists`

Block rule

If neither a materialized row nor a live-supported generated candidate can be proven, execution must block.
Narrative success is forbidden.



---
