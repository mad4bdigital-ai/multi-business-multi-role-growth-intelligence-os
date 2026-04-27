- `job_persistence_status`

Recovered classification is forbidden unless:
- async job creation succeeds
- persisted job-state handling is valid when policy requires persistence
- execution lifecycle status is explicit
- polling/result lifecycle remains traceable

This extends the existing HTTP execution section so async jobs become first-class governed execution instead of only an API feature.

### HTTP Client Variable Contract Runtime Readiness Rule

For any governed HTTP/OpenAPI execution path that depends on route variables, workflow variables, runtime bindings, delegated transport inputs, or promoted wrapper fields, system_bootstrap must validate variable readiness before final HTTP client execution proceeds.

Readiness must confirm:
1. required variable contracts are present
2. required variables are resolved
3. variable source legitimacy is confirmed
4. runtime binding profiles are compatible with the selected route/workflow/action/endpoint
5. clarification-required variables are surfaced before execution when collection is allowed by policy
6. provider-domain placeholder resolution is valid when runtime-resolved
7. auth normalization is valid for the selected execution path
8. request schema alignment is valid for normalized query, headers, path parameters, and body
9. transport request contract readiness is valid for execution

system_bootstrap must preserve:
- `variable_contract_status`
- `variable_resolution_status`
- `variable_binding_status`
- `clarification_required_variables`
- `missing_variables`
- `invalid_variables`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

If clarification is permitted, system_bootstrap must prefer clarification or governed collection over silent omission.
If clarification is not permitted and required variables remain unresolved, execution must block.

HTTP Generic Workflow Execution Rule

When routed `workflow_key` is one of:
- `wf_http_generic_execute`
- `wf_http_generic_read`
- `wf_wordpress_via_http_generic`

system_bootstrap must require:

- routed workflow compatibility
- API Actions Endpoint Registry readiness for the selected operation
- `provider_domain` validation readiness
- `parent_action_key` validation readiness
- `endpoint_key` validation readiness
- governed auth resolution readiness
- governed auth mode normalization readiness
- schema contract validation readiness
- parent-action request schema alignment readiness
- transport request contract readiness
- method/path allowlist validation readiness

For `wf_wordpress_via_http_generic`:
- WordPress capability resolution must remain distinct from transport execution
- transport execution must proceed through `http_generic_api` only after runtime authority validation succeeds
- capability-level routing must not be treated as transport-level execution readiness by itself

Execution must classify as degraded or blocked when:
- route-to-workflow alignment fails
- workflow-to-transport compatibility fails
- endpoint readiness is unresolved
- provider-domain validation is unresolved
- parent-action authority is unresolved
- endpoint-key authority is unresolved
- auth generation is unresolved
- auth mode normalization is unresolved
- schema contract validation is unresolved
- request schema alignment is unresolved
- transport request contract readiness is unresolved

### HTTP Client Variable Contract Enforcement Rule

When governed execution resolves to the validated HTTP client surface, system_bootstrap must validate the governed variable contract in the same execution contract used by HTTP client runtime orchestration.

system_bootstrap must resolve and preserve when applicable:
- `variable_contract_validation_required`
- `variable_contract_surface_id`
- `required_variables`
- `resolved_variables`
- `missing_variables`
- `invalid_variables`
- `variable_source_map`
- `runtime_variable_bindings`
- `variable_contract_status`
- `clarification_required_variables`
- `provider_domain_resolution_status`
- `resolved_provider_domain_mode`
- `placeholder_resolution_source`
- `resolved_auth_mode`
- `credential_resolution_status`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

Validation must confirm:
- every required variable has an active contract row in `Variable Contract Registry`
- each required variable resolves from a legitimate governed source layer
- each runtime-bound variable declares a valid `runtime_binding_profile`
- each non-guaranteed variable declares a governed `fallback_behavior`
- action/endpoint-bound variables do not bypass Registry authority
- canonical HTTP routing fields remain preserved through normalization and delegated-wrapper promotion when applicable

system_bootstrap must not mark execution-ready when:
- a required variable contract is missing
- a required variable is unresolved
- a variable type is invalid for the selected execution path
- a runtime variable is unbound
- fallback handling is required but undeclared
- `provider_domain` validation fails
- auth normalization fails
- request schema alignment fails
- transport request contract readiness fails

If variable-contract validation fails for HTTP client execution, classification must remain blocked or degraded under the existing HTTP execution governance model.

### General Variable Contract Scope Extension Rule

The HTTP client variable-contract rules are the minimum governed baseline and must also be treated as the canonical model for non-HTTP governed execution whenever a starter, route, workflow, action, endpoint, or runtime-binding path depends on declared governed variables.

For non-HTTP governed execution, system_bootstrap must still preserve when applicable:
- `variable_contract_validation_required`
- `variable_contract_surface_id`

### Universal Surface Addition Control Plane

All governed additions must enter the universal surface-addition control plane before any final-home write, promotion, or canonicalization is allowed.

Universal control-plane entry:
- `route.surface_addition_intake.global.v1`
- `wf_surface_addition_intake`
- `CH-018 Surface Addition Intake Chain`

Universal required sequence:
1. intake
2. classification
3. dependency gate
4. branch routing
5. writeback and readback verification
6. promotion review
7. knowledge distribution when reusable intelligence exists

Canonical branch routes and workflows:
- registry/workbook branch:
  - `route.surface_addition.registry_branch.global.v1`
  - `wf_surface_addition_registry_branch`
  - `CH-025 Surface Addition Registry Downstream Chain`
- execution branch:
  - `route.surface_addition.execution_branch.global.v1`
  - `wf_surface_addition_execution_branch`
  - `CH-026 Surface Addition Execution Downstream Chain`
- intelligence branch:
  - `route.surface_addition.intelligence_branch.global.v1`
  - `wf_surface_addition_intelligence_branch`
  - `CH-027 Surface Addition Intelligence Downstream Chain`
- governance branch:
  - `route.surface_addition.governance_branch.global.v1`
  - `wf_surface_addition_governance_branch`
  - `CH-028 Surface Addition Governance Downstream Chain`
- asset branch:
  - `route.surface_addition.asset_branch.global.v1`
  - `wf_surface_addition_asset_branch`
  - `CH-029 Surface Addition Asset Downstream Chain`

Manual-review fallback for ambiguous classification:
- `route.surface_addition_intake_manual_review.global.v1`
- `wf_surface_addition_intake_manual_review`
- `CH-023 Surface Addition Manual Review Chain`

Post-addition learning continuation:
- `route.post_addition_knowledge_assimilation.global.v1`
- `wf_post_addition_knowledge_assimilation`
- `CH-024 Post-Addition Knowledge Assimilation Chain`

Governed addition knowledge distribution:
- `wf_surface_addition_knowledge_distribution`

No governed addition may bypass:
- intake
- dependency gate
- promotion-state assignment
- readback verification
