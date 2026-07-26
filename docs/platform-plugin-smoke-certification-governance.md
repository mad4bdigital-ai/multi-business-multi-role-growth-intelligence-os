# Platform Plugin smoke certification governance

## Purpose

This document is the canonical operator-facing map for Platform Plugin guarded dispatch, provider smoke tests, and smoke certification. It reflects the current runtime state through Phase 44.

The goal is to ensure that plugin actions do not become dispatch-ready or promotion-ready just because an integration row exists. A plugin action must have evidence that the exact current transport path can complete a safe read-only provider smoke test without exposing secrets.

## Current implementation checkpoint

As of 2026-05-28:

- Guarded public REST dispatch is implemented through `platform_plugin_dispatch_rest`.
- Execution readiness is enforced before REST dispatch.
- Provider smoke mode is explicit and origin-guarded.
- A reusable platform-owned mock provider harness exists under `/platform/mock-providers`.
- Smoke certification is mandatory before dispatch readiness and promotion.
- Certification expiry and drift checks are enforced.
- Recertification queue and bounded batch automation are live.
- Recertification policy registry, audit evidence, history, and rollback surfaces are live.

Live proof target:

```text
plugin_key: tenant.nagy_sample_crm_20260525
action_key: crm.contact.list
mock_provider: crm
mock_resource: contacts
smoke target: /platform/mock-providers/crm/contacts
last verified: dispatch success with HTTP 200 and secrets_included=false
```

## Runtime dispatch chain

A Platform Plugin REST action must pass the following chain before a real fetch:

```text
action / endpoint registry
→ execution readiness dry-run
→ action manifest guard
→ plugin resolver
→ credential / connection resolution
→ skill resolution
→ action grant / preview policy
→ smoke certification gate
→ URL/method drift guard
→ provider_smoke guard when requested
→ HTTPS/private-network guard
→ fetch
→ execution_log evidence
```

The public dispatcher is implemented in:

```text
http-generic-api/platformPluginRestDispatch.js
```

The plugin resolver is implemented in:

```text
http-generic-api/platformPluginResolver.js
```

## Provider smoke mode

Provider smoke is a restricted execution mode. It exists to prove safe transport readiness, not to run arbitrary provider actions.

When `provider_smoke=true`, the dispatch request must satisfy:

```text
provider_smoke_expected_origin == resolved URL origin
method == GET
body_template == null
HTTPS only
private / localhost networks blocked
secrets_included=false
```

Provider smoke may be run through the normal dispatch tool:

```text
platform_plugin_dispatch_rest
```

The smoke response is written to `execution_log` with bounded response preview only.

## Mock provider harness

The platform-owned mock provider harness is used to certify plugin action wiring before connecting real external providers.

Routes:

```text
GET /platform/mock-providers
GET /platform/mock-providers/:provider/:resource
GET /platform/mock-crm/contacts   # legacy alias
```

Current mock resources:

```text
crm / contacts
analytics / summary
```

All mock resources must remain:

```text
smoke_read_only
will_mutate=false
secrets_included=false
```

Implementation:

```text
http-generic-api/routes/platformSmokeRoutes.js
```

## Smoke certification registry

Smoke certifications are stored in:

```text
platform_plugin_smoke_certifications
```

A certification row is valid only when it proves:

```text
certification_status = certified
last_smoke_status = success
last_response_ok = 1
last_response_status = 200
secrets_included = 0
certification_expires_at > current time
```

Key fields:

```text
plugin_key
action_key
endpoint_key
tenant_id
user_id
connection_id
mock_provider
mock_resource
expected_origin
url_origin
url_path
http_method
last_smoke_execution_log_id
certification_expires_at
last_recertification_required_at
recertification_reason
```

Certification is written by:

```text
platform_plugin_smoke_certify
POST /platform/plugins/smoke-certifications/certify
```

Certification status is read by:

```text
platform_plugin_smoke_certification_status
POST /platform/plugins/smoke-certifications/status
```

## Dispatch and promotion gates

Dispatch readiness requires a valid smoke certification for the requested `plugin_key + action_key`.

If missing:

```text
allowed=false
mode=preview_only
reason includes smoke_certification_required
execution.will_execute=false
```

If expired:

```text
allowed=false
mode=preview_only
reason includes smoke_certification_expired
execution.will_execute=false
```

Promotion also requires every contribution action binding to have a valid smoke certification before it can be promoted to Platform Base.

Promotion failure code:

```text
smoke_certification_required
```

Promotion implementation:

```text
http-generic-api/platformPluginPromotion.js
```

## Drift guard

Even if a certification exists, dispatch compares the current resolved URL/method against the certified evidence before any fetch.

Blocked drift reasons:

```text
smoke_certification_origin_drift
smoke_certification_path_drift
smoke_certification_method_drift
smoke_certification_expired
```

If drift is detected:

```text
dispatched=false
reason=smoke_certification_recertification_required
```

This prevents a connection, endpoint, path, method, or origin change from reusing stale smoke evidence.

## Recertification mode

Recertification mode is a bounded exception that allows an expired certificate to be used only for the purpose of re-running the same provider smoke proof.

It does not bypass drift.

Allowed only when:

```text
provider_smoke=true
recertificationMode=true
origin/path/method still match certification evidence
expected_origin exists
```

This mode is used by the bounded recertification batch runner.

## Required operator behavior

When adding or changing a Platform Plugin action:

1. Register or verify the action and endpoint rows.
2. Ensure the connection has an HTTPS `api_base_url`.
3. Run dispatch dry-run first.
4. Run `provider_smoke=true` with explicit `provider_smoke_expected_origin`.
5. Certify the successful smoke execution log.
6. Confirm `platform_plugin_resolve` returns `dispatch_ready`.
7. Only then promote or enable broader use.

Do not manually insert certification rows unless recovering from a documented migration or a governed repair. Prefer the `platform_plugin_smoke_certify` tool so evidence validation runs.

## Related docs

- `docs/platform-plugin-recertification-policy-governance.md`
- `docs/platform-plugin-governance-roadmap-2026-05-28.md`
- `docs/platform-plugin-promotion.md`
- `docs/platform-plugin-private-rest-dispatch.md`
- `docs/platform-plugin-contribution-intake.md`
