# local.mad4b.com Gateway Tools Design - 2026-05-18

## Decision

`local.mad4b.com` is the public Hostinger/Auth gateway for tenants, members, and governed local-device usage.

`connector.mad4b.com` remains an admin-only and break-glass recovery tunnel. It may be used as `tunnel_url` only for admin recovery devices or exceptional recovery paths.

## Why a separate table

The existing `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools` tables describe GPT-facing tool surfaces. They are not precise enough to model the public local gateway because the gateway needs its own visibility, policy, service-mode, and audit behavior.

The new gateway needs to answer:

- Which local tools are visible on `local.mad4b.com`?
- Which dispatch tool do they map to internally?
- Which caller types may use them?
- Is device_id required?
- Is tenant context required?
- Is approval required?
- Is the action consequential?
- Which calls were made, by whom, for which tenant/device, and with what result?

## Tables

### `local_gateway_tools`

Registry for tools exposed by the local gateway.

Important fields:

- `tool_key` - public gateway tool key, e.g. `local.connector.health`
- `dispatch_tool_key` - internal governed tool, e.g. `connector_health`
- `public_host` - normally `local.mad4b.com`
- `public_path` - normally `/local/tools/call`
- `dispatch_surface` - `device_tools`, `gpt_tools`, or `auth_route`
- `target_path_template` - internal route such as `/connector/{device_id}/files`
- `risk_class`
- `requires_admin`
- `requires_approval`
- `is_consequential`
- `allowed_caller_types_json`
- `service_modes_json`
- `input_schema`
- `status`

### `local_gateway_tool_call_log`

Append-only call audit table for gateway calls.

Important fields:

- `call_id`
- `tool_key`
- `dispatch_tool_key`
- `public_host`
- `user_id`
- `tenant_id`
- `device_id`
- `config_id`
- `route_id`
- `auth_mode`
- `caller_type`
- `service_mode`
- `request_args_hash`
- `request_args_json`
- `redaction_status`
- `status`
- `http_status`
- `error_code`
- `duration_ms`
- `trace_id`

## Seeded gateway tools

| Gateway tool | Dispatch tool | Status | Risk | Notes |
|---|---|---|---|---|
| `local.connector.health` | `connector_health` | active | low | Tenant-safe health diagnostic. |
| `local.connector.files` | `connector_files` | active | high | Requires approval policy for write/read sensitive paths. |
| `local.connector.shell` | `connector_shell` | active | high | Allowlisted aliases only. |
| `local.connector.apps` | `connector_apps` | active | medium | Interactive local apps. |
| `local.connector.browser` | `connector_browser` | active | medium | HTTP/HTTPS only. |
| `local.connector.n8n` | `connector_n8n` | active | high | Workflow activation/execution should be entitlement and approval gated. |
| `local.connector.dependencies` | `connector_dependencies` | planned | high/admin | Recovery dependency installs are not normal tenant self-serve. |

## Runtime routing model

1. Request enters `local.mad4b.com` on the same Hostinger/Auth app as `auth.mad4b.com`.
2. Auth resolves user, tenant, role, service mode, and entitlement.
3. Gateway resolves the requested `tool_key` from `local_gateway_tools`.
4. Gateway validates device ownership and route policy from DB.
5. Gateway dispatches internally to the mapped device tool or auth route.
6. Gateway writes `local_gateway_tool_call_log` with redacted request evidence and result state.

## DNS and tunnel model

- `local.mad4b.com` must point to the Hostinger/Auth application, not directly to a Windows Cloudflare tunnel.
- Device reachability must be resolved internally from DB.
- `connector.mad4b.com` may remain a direct Cloudflare tunnel only for admin recovery and break-glass.

## Activation status - 2026-05-18

`local.mad4b.com` is now an active public gateway path.

Implemented and validated:

1. `/local/tools` and `/local/tools/call` are mounted on the Auth runtime.
2. `local.mad4b.com` is a Hostinger website/vhost on the same hosting order as `auth.mad4b.com`.
3. Cloudflare DNS for `local.mad4b.com` points to the Hostinger/Auth origin IP `147.93.49.130` with proxy enabled.
4. A Hostinger PHP proxy in `/home/u338416126/domains/local.mad4b.com/public_html` forwards traffic to `https://auth.mad4b.com` while preserving the public local gateway host context.
5. `GET https://local.mad4b.com/health` returns healthy.
6. Unauthenticated `GET https://local.mad4b.com/local/tools` returns `401`, as expected.
7. Authenticated admin `GET https://local.mad4b.com/local/tools` returns 14 gateway tools.
8. Authenticated admin `POST https://local.mad4b.com/local/tools/call` with `local.connector.health` succeeds against device `essam-pc`.
9. Tenant-JWT path lists 6 tenant/member-safe tools and exposes zero `local.admin.*` tools.
10. Tenant-JWT `local.connector.health` succeeds through device-scoped credentials.
11. Calls are written to `local_gateway_tool_call_log` with `public_host = local.mad4b.com` and caller type `admin` or `tenant`.

Validation call IDs:

- Admin path: `db4c929f-d058-43a6-a91f-e7bbcdd31fc6`
- Tenant path: `db23b4f3-1081-42f9-b751-d3e5ba4149c3`

## Remaining promotion blockers

Before treating all high-risk local tools as production-ready tenant/member actions:

1. Add approval/hold integration for `requires_approval = 1` tools.
2. Add entitlement/service-mode enforcement beyond the current registry flags.
3. Add UI-level consent and visible risk labels for consequential local operations.
4. Keep `connector.mad4b.com` out of tenant-facing gateway records except admin recovery configs.
5. Continue using `local_gateway_public_smoke` after route/proxy/credential changes.
