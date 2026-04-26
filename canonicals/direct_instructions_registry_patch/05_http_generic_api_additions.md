Starter Intelligence Retry Governance

Starter-derived execution may participate in governed auto-repair and retry only as an execution entry surface.

Starter signals may inform retry suggestions, but they must not authorize retry outside:
- Task Routes
- Workflow Registry
- Execution Policy Registry
- Repair Mapping Registry

HTTP Generic API Governance Rule

The `http_generic_api` capability is a governed transport execution surface.

It must operate under strict registry-aware and validation-aware constraints.

Execution through this capability must:

- treat `provider_domain` as the primary execution server source
- prohibit arbitrary full URL execution in endpoint path fields
- require relative `path` inputs only
- construct final URL using resolved `provider_domain` + relative `path`
- prohibit prompt-supplied `Authorization` headers
- generate authentication headers exclusively from governed credential blocks
- enforce per-endpoint or per-provider credential isolation
- enforce allowed HTTP methods per endpoint
- enforce allowed path semantics per endpoint and schema contract
- block execution when:
  - `provider_domain` is unresolved
  - `parent_action_key` is unresolved
  - `endpoint_key` is unresolved
  - method is not allowed
  - path is not schema-compatible
  - forbidden headers are present

If `provider_domain` for any endpoint is a variable placeholder, agent runtime must resolve it before execution.

For `parent_action_key = wordpress_api`, agent runtime must replace `provider_domain` with Brand Registry `brand.base_url` before execution.

For non-WordPress APIs, `provider_domain` must remain the endpoint-row value unless the endpoint definition explicitly declares a variable placeholder requiring agent-runtime-side resolution.

Adaptive Schema Learning And Drift Detection Rule

When live request or response payload structure diverges from the authoritative YAML / OpenAPI schema:

- system must classify schema drift type:
  - additive
  - missing required field
  - renamed field
  - type mismatch
  - enum mismatch
  - structural mismatch

- system must emit:
  - schema_drift_detected = true
  - schema_drift_type
  - drift_scope (request | response)

- system must generate:
  - candidate-only schema learning output

- system must NOT:
  - auto-update schema
  - override authoritative YAML
  - mark execution as recovered

- recovered classification is forbidden until:
  - governed schema review completes
  - Registry Surfaces Catalog is updated
  - Validation & Repair Registry is updated

Schema Reconciliation Auto-Repair Workflow Rule

When adaptive schema drift is detected and classified:

- system may trigger:
  - wf_schema_reconciliation_repair

The workflow must:
- consume schema drift classification
- evaluate candidate learning output
- update:
  - Registry Surfaces Catalog schema metadata
  - Validation & Repair Registry schema state
- validate downstream compatibility:
  - Task Routes
  - Workflow Registry
  - execution dependencies

Repair workflow must enforce:
- candidate-first promotion
- no direct overwrite of authoritative schema
- readback validation required

Recovered classification allowed only when:
- schema metadata updated
- validation registry updated
- readback validation succeeds
- dependent surfaces remain compatible

Destructive Operation Governance Rule

For `http_generic_api`:
- `DELETE` operations require:
  - explicit `destructive_allowed = true`
  - explicit user intent
- destructive execution must not be inferred from vague prompts
- destructive eligibility must remain target-specific

HTTP Generic API Validation Rule

Execution validation for `http_generic_api` must confirm:
- `provider_domain` exists and is valid
- `parent_action_key` exists and is active
- `endpoint_key` exists and is active
- the parent action row resolves an authoritative `openai_schema_file_id`
- method is compatible with the endpoint row and resolved YAML/OpenAPI contract
- path is compatible with the endpoint row and resolved YAML/OpenAPI contract
- authentication generation succeeds from governed config
- final URL resolution is valid
- if `provider_domain` is variable, agent-runtime-side resolution succeeded before execution

If validation fails:
- execution must be blocked or degraded
- failure must remain traceable
- recovered classification is forbidden

HTTP Generic API Logging Rule

All `http_generic_api` executions must preserve traceable logging-compatible output including:
- `provider_domain`
- `parent_action_key`
- `endpoint_key`
- `method`
- `path`
- execution result
- validation state
- `openai_schema_file_id` when schema-bound execution applies

Parent Action YAML Authority Rule For HTTP Execution

For endpoint execution governed through API Actions Endpoint Registry:
- agent runtime must follow `parent_action_key` authority through the corresponding Actions Registry row
- the Actions Registry row must resolve an authoritative `openai_schema_file_id`
- execution assembly must remain compatible with the resolved YAML/OpenAPI contract

Endpoint selection alone is insufficient execution authority without parent action schema authority.

Security Enforcement Rule For HTTP Generic API

The following must be enforced:
- `header_blacklist`
- system-generated `Authorization` only
- prompt-supplied credentials must not be executed
- credential leakage into prompts, memory, or logs is forbidden unless explicitly redacted and governance-approved

HTTP Generic API Authority Constraint

`http_generic_api` is a transport layer and must not:
- bypass Task Routes
- bypass Workflow Registry
- bypass Validation & Repair Registry
- act as routing authority
- execute outside governed routing and runtime validation

Governed Addition Pipeline Governance Rule

Governed addition of new system items must remain Registry-governed.

The governed addition pipeline may classify and prepare additions for:
- surfaces
- routes
- workflows
- starters
- policies
- repair mappings
- validation rules
- graph nodes
- graph relationships

Governed addition must determine the affected authority, validation, runtime, repair, memory, graph, and observability surfaces before activation.

Governed addition must not:
- append runtime rows without dependency mapping
- activate new items without validation readiness
- bypass Registry Surfaces Catalog
- bypass Validation & Repair Registry
- bypass Task Routes or Workflow Registry when execution behavior is introduced

Governed addition is an orchestration behavior, not a shadow authority surface.

Addition Promotion Rule

Newly added governed items should enter as:
- candidate
- inactive
- pending validation

Promotion to active or authoritative state is allowed only after:
- structural validation
- row/schema validation when applicable
- cross-sheet integrity validation
- graph integrity validation when applicable
- execution-readiness validation when applicable

Starter Intelligence Canonical Governance Rule

Conversation Starter is a governed intelligence surface.

It must:
- be registered in Registry Surfaces Catalog
- be validated in Validation & Repair Registry
- follow row_audit_schema

Starter system must govern:
- starter -> route mapping
- starter -> workflow mapping
- starter -> execution_class propagation
- starter -> goal-family classification
- starter -> prediction signals

Starter system must act as:
- entry intelligence layer
- learning-aware system
- predictive recommendation system

Starter signals must remain compatible with:
- Task Routes
- Workflow Registry
- Growth Loop Engine Registry

Starter governance must also enforce:

- starter -> policy-resolution readiness
- starter -> execution-readiness gating
- starter -> authoritative logging evidence before final success/recovered classification

Conversation Starter therefore acts not only as an intelligence surface, but also as a policy-gated execution entry surface.

Graph Intelligence Governance Rule

Knowledge Graph Node Registry and Relationship Graph Registry are governed intelligence surfaces.

They must be registered in:
- Registry Surfaces Catalog
- Validation & Repair Registry

Graph intelligence must govern:
- node identity
- relationship identity
- execution-path integrity
- starter-to-route mapping
- route-to-workflow mapping
- workflow-to-chain mapping
- decision-to-chain or decision-to-route mapping
- chain-to-engine mapping
- graph-based prediction signals
- graph-based auto-routing eligibility

Graph intelligence may optimize among governed paths but must not:
- invent new routes
- invent new workflows
- bypass Task Routes authority
- bypass Workflow Registry authority
- bypass execution policy
- bypass validation gating

Knowledge Graph Node Registry is the governed node authority surface.
Relationship Graph Registry is the governed relationship authority surface.

Graph Validation Governance Rule

Execution-critical graph validation must verify:
- required node exists
- required relationship exists
- execution-critical relationship is active
- graph path remains compatible with Task Routes and Workflow Registry

Missing or invalid execution-critical graph relationships must:
- degrade or block execution according to governed enforcement policy
- preserve repair-aware traceability when recoverable

Graph Auto-Routing Governance Rule

Graph-based auto-routing may:
- compare valid governed execution paths
- rank valid governed execution paths
- select the best governed execution path by policy

Graph-based auto-routing must not:
- override route authority outside Task Routes
- override workflow authority outside Workflow Registry
- execute an unregistered path
- classify an invalid path as recovered
