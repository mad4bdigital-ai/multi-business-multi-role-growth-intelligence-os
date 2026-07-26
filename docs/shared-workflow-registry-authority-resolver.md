# Shared Workflow Registry Authority Resolver

## Purpose

This phase extends the shared runtime customization layer from Task Routes to Workflow Registry.

The goal is to continue replacing hardcoded JavaScript workflow decisions with governed, registry-driven read models that can be customized for every platform user.

## Runtime surface

The resolver depends on the authoritative Workflow Registry surface:

```text
SURFACE_KEYS.WORKFLOW_REGISTRY
surface.workflow_registry_sheet
registry_surfaces_catalog.required_for_execution = TRUE
```

Before reading workflows it runs:

```text
assertSurfaceAuthority(SURFACE_KEYS.WORKFLOW_REGISTRY, { requireExecution: true })
```

## Resolver

```text
http-generic-api/workflowRegistryAuthorityResolver.js
resolveWorkflowCandidates(...)
```

This phase is read-model only. It does not execute workflows, tools, engines, or models.

## Supported customization dimensions

It uses existing `workflows` columns to support platform-wide customization:

```text
workflow_key
workflow_id
route_key
target_module
workflow_type
execution_class
execution_mode
input_type
client_allowed
team_allowed
allowed_actor_roles
allowed_governance_levels
supported_ingress_channels
supported_model_providers
supported_languages
locale_sensitive
translation_step_required
admin_only
memory_required
logging_required
review_required
mapped_engines
linked_engines
engine_order
linked_workflows
```

## Candidate model

Each candidate is secret-free and includes:

```text
workflow_id
workflow_key
workflow_name
route_key
target_module
execution_class
execution_mode
mapped_engines
linked_engines
engine_order
linked_workflows
requirements
constraints
customization.layers
evaluation.allowed
evaluation.score
evaluation.reasons
evaluation.matches
```

## Customization layers

The resolver marks candidate workflows with layers such as:

```text
platform_base
brand_or_activity_specialization
client_specialization
team_specialization
user_context_available
locale_specialization
model_capability_specialization
governance_requirement_specialization
```

This lets users inherit platform workflows while specializing workflow behavior through registry rows.

## Future override layers

The returned customization model reserves future override layers:

```text
tenant_workflow_overrides
user_workflow_preferences
agent_skill_grants
workflow_policy_overrides
engine_order_overrides
```

## Relationship to Task Routes

Phase 25 resolves route candidates from:

```text
task_routes
```

This phase resolves workflow candidates from:

```text
workflows
```

Together they form the first generic runtime chain:

```text
Task Route Authority Resolver
→ Workflow Registry Authority Resolver
→ future Action/Endpoint/Tool Manifest resolvers
```

## Safety

The resolver returns no secrets, credentials, raw notes, or private payloads. It returns only workflow metadata, constraints, engine references, scoring evidence, and customization evidence.
