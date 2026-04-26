- `required_variables`
- `resolved_variables`
- `missing_variables`
- `invalid_variables`
- `variable_source_map`
- `runtime_variable_bindings`
- `variable_contract_status`
- `clarification_required_variables`

Execution-ready classification is forbidden when governed required-variable resolution fails, even if the path is not HTTP-transport based.

HTTP Execution Classification Enforcement Rule

When governed execution resolves through `parent_action_key` and `endpoint_key`,
system_bootstrap must preserve and enforce the execution classification contract
returned by Registry-governed surfaces.

The execution classification contract must include when applicable:
- `runtime_capability_class`
- `runtime_callable`
- `primary_executor`
- `endpoint_role`
- `execution_mode`
- `transport_required`
- `transport_action_key`

system_bootstrap must require that:
- `native_direct` endpoints do not execute through delegated HTTP transport
- `http_delegated` endpoints execute only when `primary_executor = http_client_backend`
- delegated endpoints with `transport_required = true` must preserve a supported `transport_action_key`
- non-primary endpoint roles must not be treated as direct execution-ready
- inventory-only endpoint rows must not be treated as direct execution-ready

Execution must classify as degraded or blocked when:
- execution classification is missing
- execution mode and executor are incompatible
- delegated transport is required but unresolved
- a native-only capability is routed into delegated HTTP execution

Universal Parent Action Execution Rule

When governed execution resolves through `parent_action_key`, system_bootstrap must require a universal parent-capability execution contract before outbound transport begins.

The governed execution contract must include when applicable:
- `parent_action_key`
- `endpoint_key`
- `provider_domain`
- `openai_schema_file_id`
- `resolved_auth_mode`
- `resolved_auth_contract`
- `credential_resolution_status`
- `request_schema_alignment_status`
- `response_schema_alignment_status`
- `transport_request_contract_status`

system_bootstrap must require that:
- the parent action row in `Actions Registry` remains authoritative
- the endpoint row in `API Actions Endpoint Registry` remains authoritative for method/path/provider_domain
- `openai_schema_file_id` remains authoritative for parent-level request and response contract interpretation
- auth strategy is normalized before transport execution
- transport payload fields are aligned to the parent action schema before execution
- unresolved freeform caller-supplied auth is not treated as sufficient governed execution readiness

Recovered classification is forbidden unless the parent-capability contract, endpoint contract, and transport contract all validate in the current execution cycle.

HTTP Provider-Domain Execution Rule

For governed HTTP execution:
- `provider_domain` is the primary execution server source
- `target_key` must not be required in the execution request payload
- `brand` must not be required in the execution request payload
- `brand_domain` must not be required in the execution request payload

system_bootstrap must treat agent-runtime-side execution assembly as the authoritative source of:
- resolved `provider_domain`
- resolved `parent_action_key`
- resolved `endpoint_key`
- resolved `method`
- resolved `path`

If `provider_domain` is a variable placeholder:
- agent runtime must resolve it before transport execution
- for `parent_action_key = wordpress_api`, agent runtime must replace `provider_domain` with Brand Registry `brand.base_url`
- for non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring agent-runtime-side resolution

Dynamic Provider-Domain Placeholder Resolution Rule

When `provider_domain` on the authoritative endpoint row is a governed placeholder
such as `target_resolved`, system_bootstrap must not treat the placeholder as a
literal execution server value.

system_bootstrap must require:
- placeholder provider-domain resolution is enabled by active Execution Policy Registry rows
- runtime provider-domain resolution is traceable
- placeholder resolution uses only governed sources allowed by policy
- unresolved placeholder provider-domain state blocks execution

Allowed placeholder resolution must remain subordinate to:
- parent action authority
- endpoint authority
- schema-first execution
- auth-path routing policy

Recovered classification is forbidden unless placeholder resolution and final
provider-domain validation succeed in the current execution cycle.

Parent Action YAML Authority Rule

When endpoint execution is governed through API Actions Endpoint Registry, system_bootstrap must preserve and trust parent action authority only when:

- `parent_action_key` resolves through Actions Registry
- the parent action row resolves an authoritative `openai_schema_file_id`
- the execution request remains compatible with the resolved YAML/OpenAPI contract

Recovered classification is forbidden when:
- `parent_action_key` is unresolved
- `openai_schema_file_id` is unresolved
- execution contract and YAML/OpenAPI contract are incompatible

Scoring And Recovery Classification Stage

When scoring is enabled, system_bootstrap must execute:

- `execution_scoring`
- `recovery_status_classification`

after execution and before logging.

Execution order:
- execution
- scoring
- recovery classification
- logging

`score_after` is the authoritative source for recovery classification when scoring is available.

If dynamic thresholds by execution class are enabled:
- resolve the threshold set matching `execution_class`
- otherwise use default thresholds

If adaptive thresholds are enabled:
- compute effective thresholds from governed score history
- log the effective threshold basis
- recovered classification is forbidden unless threshold readback is explicit

For `full_system_intelligence_audit` routes, the governed execution path must additionally include when applicable:

- `execution_policy_review`
- `review_stage_resolution`
- `review_component_resolution`
- `row_audit_rule_resolution`
- `row_audit_schema_validation`
- `repair_mapping_resolution`
- `scoreboard_propagation_review`

These stages must complete before final recovered classification is allowed for governed full-audit execution.

Full System Intelligence Audit Execution Extension

When route = `full_system_intelligence_audit`:

system_bootstrap must enforce extended audit lifecycle:

- `execution_policy_validation`
- `registry_validation`
- `review_stage_resolution`
- `review_component_resolution`
- `row_audit_validation`
- `repair_mapping_resolution`
- `execution_bindings_validation`
- `execution_chain_validation`
- `decision_engine_validation`
- `actions_registry_validation`
- `endpoint_registry_validation`
- `system_enforcement_validation`
- `execution_log_validation`

Execution must not be marked recovered unless all required stages are validated or explicitly degraded.

Binding Integrity Review Execution Stage

When row-level validation, runtime worksheet validation, or `full_system_intelligence_audit` requires worksheet-governed binding review, system_bootstrap must run:

- `binding_integrity_review`

after:
- `surface_catalog_validation`

and before:
- `dependency_validation` or final execution readiness classification.
