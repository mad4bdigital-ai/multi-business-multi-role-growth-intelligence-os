# Platform Plugin resolver preview notes

## Purpose

`platform_plugin_resolve` is the second step in formalizing Platform Plugins as governed extension units. It evaluates whether a requested plugin action/tool is currently allowed for a tenant/user/agent context, without executing the action.

## Route and tool

- Route: `POST /platform/plugins/resolve`
- Tool key: `platform_plugin_resolve`
- Mode: `preview_only`
- Secrets returned: never

## Inputs

```json
{
  "plugin_key": "github",
  "action_key": "github.repo.read",
  "tenant_id": "tenant-id",
  "user_id": "user-id",
  "agent_id": "agent-id",
  "requested_credential_scope": "user_connection"
}
```

`action_key` or `tool_key` may be provided. If neither is provided, the resolver evaluates the plugin definition and first available binding as a preview.

## Resolution checks

The resolver reads existing authority surfaces:

- `app_integrations`
- `app_integration_action_bindings`
- `app_integration_tool_bindings`
- `tenant_integration_policies`
- `user_app_connections`
- `agent_skills`
- `agent_skill_grants`

It returns an allow/deny envelope containing:

- plugin definition summary
- selected action/tool binding state
- tenant policy overlay
- credential source decision
- skill grant decision
- approval hint
- execution preview

## Non-goals

This preview route does not:

- decrypt or expose secrets
- call a provider
- execute a tool
- mutate tenant policies
- mutate plugin definitions
- promote tenant/user plugins into the platform base

## Next implementation step

Add tenant-safe policy mutation for installing a preset Platform Plugin into a tenant scope. That step should write tenant overlay rows, perform readback, and log the mutation in `execution_log` or the relevant audit surface.
