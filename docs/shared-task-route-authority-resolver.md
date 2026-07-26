# Shared Task Route Authority Resolver

## Purpose

This phase starts replacing hardcoded JavaScript routing decisions with a shared, registry-driven runtime customization layer.

The resolver is intentionally similar in spirit to the Platform Plugin layer:

```text
base platform definition
→ tenant/client context
→ user/team context
→ brand/activity specialization
→ policy and capability checks
→ secret-free runtime candidates
```

## Runtime surface

The resolver depends on the authoritative Task Routes surface:

```text
SURFACE_KEYS.TASK_ROUTES
surface.task_routes_sheet
registry_surfaces_catalog.required_for_execution = TRUE
```

Before reading task routes it runs:

```text
assertSurfaceAuthority(SURFACE_KEYS.TASK_ROUTES, { requireExecution: true })
```

## Resolver

```text
http-generic-api/taskRouteAuthorityResolver.js
resolveTaskRouteCandidates(...)
```

The resolver is read-model only in this phase. It does not execute workflows or tools.

## Supported customization dimensions

It uses existing `task_routes` columns to support platform-wide customization without hardcoded JS branches:

```text
intent_key
task_key
brand_scope
brand_scope_enforced
client_allowed
team_allowed
allowed_actor_roles
allowed_governance_levels
supported_ingress_channels
supported_model_providers
supported_languages
locale_sensitive
translation_step_required
request_type
route_mode
admin_only
memory_required
logging_required
review_required
```

## Candidate model

Each returned candidate is secret-free and includes:

```text
route_id
task_key
intent_key
workflow_key
target_module
route_modules
execution_layer
requirements
constraints
customization.layers
evaluation.allowed
evaluation.score
evaluation.reasons
evaluation.matches
```

## Customization layers

The resolver marks candidate routes with layers such as:

```text
platform_base
brand_specialization
client_specialization
team_specialization
user_context_available
locale_specialization
model_capability_specialization
```

This allows every tenant/user/brand to inherit base platform behavior while specializing behavior through registry rows.

## Future override layers

This phase does not add new override tables yet. It reserves the shape for later platform growth:

```text
tenant_task_route_overrides
user_task_route_preferences
agent_skill_grants
workflow_policy_overrides
```

## Why this matters

The goal is not to remove JavaScript. The goal is to move business/runtime decisions out of hardcoded JS and into governed registries.

JS remains as a generic runtime kernel:

```text
surface authority
registry resolvers
policy evaluation
execution dispatch
evidence logging
readback and repair
```

The platform-specific behavior becomes data-driven and customizable for all platform users.

## Safety

The resolver returns no secrets, credentials, raw notes, or tenant-private payloads. It only returns route metadata, constraints, scoring evidence, and customization evidence.
