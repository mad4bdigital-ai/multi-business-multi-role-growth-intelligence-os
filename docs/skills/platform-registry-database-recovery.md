# Platform Registry & Database Recovery Skill

## Purpose

This skill is the general recovery layer for DB-backed platform authority. It applies when a platform operation fails because a registry row, endpoint export, dispatch binding, capability recipe, authority policy, table exposure contract, readback contract, or activation surface mapping is missing or incomplete.

The database remains the canonical runtime registry authority. Provider-specific systems such as GitHub, Cloudflare, Google, n8n, Hostinger, WordPress, or local connector runtimes are adapters above this general skill.

## Runtime rule

The recovery flow is:

```text
symptom
  -> identify missing registry/table layer
  -> DESCRIBE actual table schema
  -> generate narrow idempotent SQL
  -> execute only with authority_context
  -> read back every row
  -> run dry-run/preflight where available
  -> delegate live provider action to an adapter skill only after registry authority is valid
```

## Allowed surfaces

Examples include:

```text
endpoints
admin_platform_endpoint_tools
tenant_platform_endpoint_tools
platform_endpoint_tool_exports
platform_tool_dispatch_bindings
platform_resource_recipes
platform_resource_authority_requirements
capability_apply_authorization_policy_registry
runtime_dispatch_certification_registry
platform_capability_readback_contracts
execution_policies
platform_data_table_registry
skill_manifests
skill_packages
agent_skills
agent_skill_grants
```

## Safety guardrails

This skill must not grant broad bypasses. It must not perform destructive SQL or provider writes without a separate governed mutation path.

Forbidden examples:

```text
DROP TABLE
TRUNCATE TABLE
DELETE without scope
secret reads
raw provider URLs
raw provider methods
force push
direct main writes
unbounded overrides
```

Required for writes:

```text
authority_context
idempotent SQL
bounded scope
same-cycle readback
secrets_included=false
```

## Evidence expectations

A recovery is not considered complete until the relevant runtime/activation/readiness view reports ready or covered and execution evidence is logged. For skill recovery specifically, `v_skill_runtime_coverage` should show:

```text
runtime_binding_status = ready
coverage_status = covered
```

## Related adapter

GitHub repository recovery is implemented as a provider adapter over this general skill. The adapter supplies GitHub-specific endpoint keys, required permissions, expected status codes, CI gates, branch reconciliation rules, and provider readback.
