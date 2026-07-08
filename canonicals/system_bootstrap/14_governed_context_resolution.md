# Governed Context Resolution — Logic / Business Activity / Brand

## Required runtime order

Every HTTP client execution that may touch a brand, business activity, or functional Logic must resolve context in this order:

1. Business Activity Type Registry
2. Brand Registry and Brand Core surfaces
3. Logic Canonical Pointer Registry
4. Logic Knowledge Profiles
5. Task Routes
6. Workflow Registry
7. Actions Registry and API Actions Endpoint Registry

## Business activity rule

If a request declares `business_activity_type_key`, `business_activity_type`, `activity_type_key`, or equivalent structured context, the runtime treats it as governed context. Business activity resolution must precede business-type knowledge, brand specialization, workflow selection, and engine compatibility interpretation.

## Platform resource context rule

Any intent that names or implies a Brand, Workspace, Asset, CMS Site, or Connection must resolve through `platform_resource_context_resolve` before requesting internal identifiers or selecting downstream tools. The resolver may start from any supported resource type and may return an optional Brand context; Brand or Workspace is not a mandatory entry point.

Use helper surfaces by purpose:

- `platform_resource_context_catalog` for authorized discovery and paginated selectors.
- `platform_resource_context_related` when a canonical resource type and key are already known.
- `platform_resource_context_diagnostic_handoff` before provider-specific diagnostics.
- `platform_resource_context_readiness_smoke` for Admin descriptor/schema readiness.

When direct matching fails, `resource_reference_interpreter_v1` may generate bounded `candidate_refs` from the authorized catalog only. Candidate generation is never authority; deterministic matching, ambiguity checks, signed principal scope, and effective grants remain mandatory.

The older `brand_workspace_context_resolve` tool is a backward-compatibility surface, not the primary route for new generic context requests.

## Brand rule

Brand-targeted execution must resolve through Brand Registry before execution. Target-resolved endpoints, WordPress endpoints, and endpoints with `brand_resolution_source` require resolved brand context. Brand Core remains required for brand outputs and live brand operations, but it is not required merely to resolve a standalone Workspace, Asset, Site, or Connection.

## Logic rule

Functional Logic resolution is pointer-first. Legacy external Logic identifiers are lineage evidence only and must not become runtime authority. Requests using legacy Logic identifiers must be blocked unless explicitly marked as lineage lookup only.

## Runtime outcome

The HTTP client backend must emit a governed context snapshot containing business activity, brand, Logic, action/endpoint, resolution order, and gates. This snapshot is evidence; it does not bypass existing endpoint, workflow, mutation, approval, or readback gates.
