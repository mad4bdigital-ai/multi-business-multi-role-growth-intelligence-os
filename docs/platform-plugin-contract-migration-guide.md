# Platform Plugin Contract Migration Guide

## Scope

This guide covers the Sprint 69 Platform Plugin resolve contract for:

- `POST /platform/plugins/resolve`
- `POST /tenant/platform/plugins/resolve`

The resolve routes are preview/readiness surfaces only. They do not execute providers, dispatch tools, decrypt credentials, mutate tenant policy, or return secrets.

## One-selector request contract

Clients must send exactly one selector:

```json
{
  "plugin_key": "github",
  "action_key": "github.repo.read"
}
```

or:

```json
{
  "plugin_key": "github",
  "tool_key": "credential_effective_status"
}
```

Do not send both `action_key` and `tool_key`.

Stable request errors:

- `MISSING_CAPABILITY_SELECTOR`: neither selector was provided.
- `AMBIGUOUS_CAPABILITY_SELECTOR`: both selectors were provided.
- `UNKNOWN_SECURITY_CONTRACT_FIELD`: a rejected field was present at the route boundary.

Legacy camelCase aliases `actionKey` and `toolKey` are accepted temporarily for compatibility. Responses include `compatibility_telemetry.legacy_selector_alias_used=true` and `legacy_fields` when an alias is used. New clients must use snake_case.

## Decision trace contract

Resolve responses now include a public-safe trace:

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
- Client migration requirement: remove camelCase selectors and unknown fields before enforcement-only clients are certified.
- Deprecation trigger: after Phase 12 production rollout stability and telemetry shows no active legacy selector usage, remove camelCase alias support in a follow-up contract PR.
- Merge rule: no contract PR is merged until the full hardening plan is complete and CI evidence is green.

## Client checklist

- Send `plugin_key`.
- Send exactly one of `action_key` or `tool_key`.
- Treat a 200 response with `allowed=false` as a successful readiness read, not as transport failure.
- Use `security_decision_trace_public` for user-facing diagnostics.
- Do not display admin trace detail to tenant users.
- Never infer execution authority from resolve output unless `mode=dispatch_ready`, `security_decision.dispatch_ready=true`, and the subsequent governed dispatch surface independently authorizes execution.
