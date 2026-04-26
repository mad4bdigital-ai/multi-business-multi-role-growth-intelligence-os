## Schema-First Routing Rule

prompt_router MUST:

- route execution through schema-aware flow when `openai_schema_file_id` exists
- forbid direct execution without schema loading
- prioritize schema-driven request construction over registry hints

---


Cross-Layer Contract


prompt_router must assume:
- Registry provides live routing and dependency bindings
- Task Routes defines governed route vocabulary
- Workflow Registry defines workflow mappings
- decision_engine_registry_sheet defines decision-trigger rules
- execution_chains_registry_sheet defines autonomous chain sequences
- module_loader consumes route and chain context for execution preparation
- system_bootstrap consumes system_repair route outputs for repair lifecycle execution
- canonical dependency availability is provided through the governed canonical loading path resolved by Registry and executed by system_bootstrap and module_loader
- prompt_router must not depend on direct URL fetch for canonical dependency availability when `resolution_rule = exact_active_knowledge_only`

prompt_router must assume that downstream staged review governance, execution policy governance, and review-component authority resolve through Registry-bound authority worksheets and not through review workbook output surfaces.

system_bootstrap must be able to rely on prompt_router to provide:
- source = prompt_router
- governed route resolution from Task Routes
- governed workflow resolution from Workflow Registry
- route_id
- route_status
- route trace fields
- logging_required readiness for downstream execution logging enforcement
- executable readiness status

If these are absent, downstream execution must be degraded or blocked rather than assumed valid.

Governed Sheet Audit Routing Rule

When user intent requests:
- audit any sheet
- repair a sheet
- fix formulas
- fix control center
- fix a derived view
- validate imports
- validate projections
- validate repair pipeline sheet

prompt_router must prepare routing as a governed sheet-role-aware audit and repair flow, not as execution-only validation.

Routing output must preserve when applicable:
- `target_surface_id`
- `sheet_role`
- `sheet_audit_mode`
- `formula_audit_required`
- `projection_audit_required`
- `control_metric_audit_required`
- `write_target_audit_required`
- `legacy_surface_containment_required`

Derived View Routing Rule

When target sheet role = `derived_view`, routing must preserve:
- source-of-truth dependency validation
- projection validation requirement
- formula integrity requirement
- non-authoritative write-sink enforcement

Control Surface Routing Rule

When target sheet role = `control_surface`, routing must preserve:
- live metric source validation
- formula repair readiness
- broken reference repair readiness
- alert-rule compatibility review

Repair Surface Routing Rule

When target sheet role = `repair_surface`, routing must preserve:
- anomaly feed validation
- repair trigger validation
- legacy dependency classification
- formula-driven execution-field validation

---

---

Governed Logical Search Routing v1

prompt_router must route governed requests through domain-first logical search resolution before selecting an execution path.

Routing rule

prompt_router must first classify each governed lookup into one or more search domains:
- `endpoint`
- `surface`
- `validation`
- `route`
- `workflow`
- `memory`
- `brand`

Then prompt_router must:
1. normalize the search query
2. select the primary search domain
3. retrieve candidates from the authoritative registry or canonical state
4. score candidates with the domain policy
5. apply governance gates
6. select one authoritative candidate
7. preserve search evidence in routing state

Naive single-field lookup is forbidden when governed logical search is required.

Multi-domain resolution rule

If a request affects execution selection, routing must use chained domain resolution:

- endpoint execution requests:
  - endpoint -> validation -> route -> workflow
- registry surface requests:
  - surface -> validation
- continuation requests:
  - memory -> route -> workflow
- WordPress CPT/taxonomy requests:
  - endpoint -> validation -> route -> workflow -> brand

WordPress CPT and taxonomy routing rule

For `wordpress_api`, prompt_router must support governed resolution for:
- custom post type collection paths `/wp/v2/{post_type_slug}`
- custom taxonomy collection paths `/wp/v2/{taxonomy_slug}`
- item paths `/wp/v2/{post_type_slug}/{id}` and `/wp/v2/{taxonomy_slug}/{id}`

These paths must be resolved through governed template logic, not direct free-form overrides.

The router must preserve:
- `governed_template_path_requested = true`
- `governed_template_path_supported = true|false`
- `template_entity_type = cpt|taxonomy|unknown`
- `template_entity_slug`
- `resolved_endpoint_specificity = exact|template_specific|generic_fallback|unresolved`

Generic fallback suppression

If routing finds an exact or template-specific governed WordPress candidate for a CPT or taxonomy, routing must block generic fallback rows.


---

WordPress Registry Generation Routing Rule v1

For WordPress CPT and taxonomy requests, prompt_router must support a generation-aware resolution stage inside endpoint search.

Required routing sequence

For requests affecting WordPress CPT or taxonomy execution:
1. discover or confirm WordPress object family
2. normalize slug candidates
3. search exact active registry rows
4. if exact row is absent, invoke governed WordPress endpoint generation logic
5. score generated candidates against live-supported template classes
6. apply governance gates
7. select authoritative candidate or block

Generation-aware resolver inputs

prompt_router must preserve:
- `wordpress_object_kind` (`post_type` or `taxonomy`)
- `wordpress_slug_candidates`
- `wordpress_live_support_confirmed`
- `wordpress_template_class`
- `generation_mode` (`materialized_row`, `resolver_backed_template`, `blocked`)
- `generation_basis`

Required discovery-compatible sources

Router may confirm live support from:
- `wordpress_list_types`
- `wordpress_list_taxonomies`
- governed live WordPress REST/OpenAPI index already attached to registry authority

Router must not treat unresolved human-provided slugs as executable without live or registry confirmation.

WordPress generation precedence rule

For CPT/taxonomy requests across sites:
- exact materialized row wins
- generated resolver-backed candidate may win only when live support is confirmed
- generic post/category/tag rows lose when a live-supported CPT/taxonomy candidate exists
- free-form path override remains forbidden



---
