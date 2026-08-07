# Platform Plugin Contract Migration Guide

## Scope

This guide covers the Sprint 69 Platform Plugin resolve contract for:

- `POST /platform/plugins/resolve`
- `POST /tenant/platform/plugins/resolve`

The resolve routes are preview/readiness surfaces only. They do not execute providers, dispatch tools, decrypt credentials, mutate tenant policy, or return secrets.

## One-selector request contract

Clients must send exactly one selector.

Admin/service preview example:

```json
{
  "plugin_key": "github",
  "action_key": "github.repo.read"
}
```

Tenant resolve is workspace-bound and must also send the exact authenticated tenant workspace:

```json
{
  "plugin_key": "github",
  "workspace_id": "workspace-123",
  "action_key": "github.repo.read"
}
```

or:

```json
{
  "plugin_key": "github",
  "workspace_id": "workspace-123",
  "tool_key": "credential_effective_status"
}
```

Do not send both `action_key` and `tool_key`.

For `POST /tenant/platform/plugins/resolve`, `workspace_id` is a required security context, not an authority grant. The runtime binds it to the authenticated `tenant_id` and `user_id` and resolves connection ownership through the Context Kernel. Caller-supplied tenant/user/Brand identity fields remain rejected.

Stable request errors:

- `MISSING_CAPABILITY_SELECTOR`: neither selector was provided.
- `AMBIGUOUS_CAPABILITY_SELECTOR`: both selectors were provided.
- `UNKNOWN_SECURITY_CONTRACT_FIELD`: a rejected field was present at the route boundary.
- `TENANT_WORKSPACE_CONTEXT_REQUIRED`: tenant resolution omitted `workspace_id`.

Legacy camelCase aliases `actionKey`, `toolKey`, and `workspaceId` are accepted temporarily for compatibility. Responses include `compatibility_telemetry.legacy_selector_alias_used=true` for selector aliases and list any accepted legacy aliases in `legacy_fields`. New clients must use snake_case. The workspace-aware tenant contract reports `compatibility_telemetry.contract_version=one-selector-workspace-v2`.

## Connection ownership contract

Tenant credential resolution is fail-closed and workspace-owned:

- Personal Workspace resolves only a `personal_workspace` connection owned by the authenticated user and exposes it as `user_connection`.
- Company Workspace resolves only a `company_workspace` connection for the exact workspace and exposes it as `tenant_connection`; the legacy user who originally connected the provider is not treated as the Company credential owner.
- Brand-owned connections are excluded from this bounded resolver until canonical Brand-management authority is composed. Supplying a Brand identifier cannot widen authority.
- Multiple eligible connections in the resolved ownership scope return `AMBIGUOUS_CONNECTION_SELECTION`; no first-row selection is allowed.
- A caller-requested credential scope that conflicts with canonical workspace ownership returns `CONNECTION_OWNERSHIP_SCOPE_MISMATCH`.
- Unknown, unclassified, cross-workspace, or personal-owner-mismatched ownership fails closed.

The public response may include sanitized `credential_lookup` and `connection_ownership_resolution` evidence. These projections do not include credential payloads, candidate connection identifiers on ambiguity/scope denial, or secrets. `brand_connections_included` remains `false` for this contract.

## Decision trace contract

Resolve responses include a public-safe trace:

- `security_decision_trace_public.schema_version=security_decision_trace.v1`
- ordered `gate_events`
- decision outcome and dispatch readiness
- denied and unevaluated gate counts
- `secrets_included=false`

Admin resolve responses also include `security_decision_trace_admin`, which may expose diagnostic gate reasons, codes, detail key names, denied gate keys, unevaluated required gate keys, and invariant results. Tenant GPT clients must rely on the public projection.

Trace projections never copy raw gate detail payloads. Admin diagnostic detail is still bounded to key names and status metadata.

## Decision metrics

`security_decision.metrics.schema_version=security_decision_metrics.v1` provides:

- denied gate count
- unevaluated required gate count
- invariant violation count
- violated invariant keys
- alert level: `none`, `warning`, or `critical`

`critical` means an invariant violation or unevaluated required gate was detected. It is observability evidence, not an execution grant.

## Migration timeline

- Current compatibility window: snake_case is canonical; camelCase aliases are accepted and reported through compatibility telemetry.
- Tenant client migration requirement: send exact `workspace_id` and remove camelCase selectors, camelCase workspace aliases, and unknown fields before enforcement-only clients are certified.
- Deprecation trigger: after Production rollout stability and telemetry shows no active legacy alias usage, remove camelCase alias support in a follow-up contract PR.
- Brand connection eligibility is a separate authority milestone and must not be enabled by this migration.
- Merge rule: no contract PR is merged until the full hardening plan is complete and CI evidence is green, including exact-head Runtime, OpenAPI generation, E2E, and governance checks.

## Client checklist

- Send `plugin_key`.
- For tenant resolve, send exact `workspace_id`.
- Send exactly one of `action_key` or `tool_key`.
- Treat a 200 response with `allowed=false` as a successful readiness read, not as transport failure.
- Treat ownership scope mismatch or ambiguity as a blocked decision; never choose a connection client-side.
- Use `security_decision_trace_public` for user-facing diagnostics.
- Do not display admin trace detail to tenant users.
- Never infer execution authority from resolve output unless `mode=dispatch_ready`, `security_decision.dispatch_ready=true`, and the subsequent governed dispatch surface independently authorizes execution.