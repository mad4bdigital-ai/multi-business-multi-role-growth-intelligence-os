# Decision Tables

These tables convert route, device, and recovery evidence into deterministic outcomes. Implementation PRs must encode these rules in application/domain services, not in route handlers.

## 1. Target device selection

| Evidence | Decision | User-facing state | Allowed next action |
|---|---|---|---|
| zero eligible devices | `no_device_registered` | No device linked | Pair new device |
| one active device, selector omitted | preselect canonical device | Device selected | Status read only; repair still asks confirmation |
| multiple active devices, selector omitted | `target_device_ambiguous` | Choose device | List candidates |
| selector matches alias only | resolve candidate then require canonical confirmation | Confirm target | Status read; repair blocked until confirmed |
| selector cross-tenant | `device_not_found` or `forbidden` | Not available | None |
| selected device revoked | `device_revoked` | Device unavailable | Admin review |
| selected device replaced | `device_replaced` | Device replaced | Show replacement/new device |

## 2. Route health classification

| Config | Registered route | Heartbeat | Auth-host probe | Break-glass probe | Tunnel probe | Local service | Classification |
|---|---|---|---|---|---|---|---|
| missing | n/a | n/a | n/a | n/a | n/a | n/a | `connector_config_missing` |
| present | none | missing | unknown | unknown | unknown | unknown | `runtime_route_not_registered` |
| present | yes | fresh | success | skipped | success | running | `healthy_tenant_route` |
| present | yes | fresh | failure_502 | success | success | running | `auth_host_proxy_failure` |
| present | yes | fresh | success | failure_502 | success | running | `break_glass_host_failure` |
| present | yes | stale | success | success | success | unknown | `heartbeat_stale` |
| present | yes | fresh | timeout | timeout | unknown | unknown | `external_reachability_unknown` |
| present | yes | missing | success | success | success | stopped | `local_service_stopped` |
| present | yes | fresh | failure_502 | failure_502 | failure | unknown | `tunnel_or_host_dependency_unreachable` |
| present | conflict | any | any | any | any | any | `route_binding_conflict` |

## 3. Recovery plan selection

| Classification | Recovery reason | Requires fresh auth | Requires admin | Recommended action |
|---|---|---|---|---|
| `runtime_route_not_registered` | unknown runtime | yes | no | repair/relink preview |
| `heartbeat_stale` | stale runtime evidence | no for status, yes for installer | no | probe then repair preview |
| `local_service_stopped` | local service down | yes | no | repair connector service |
| `auth_host_proxy_failure` | auth-host proxy issue | no | yes if infrastructure mutation | auth-host route diagnostics |
| `break_glass_host_failure` | admin host issue | no | yes | break-glass host repair |
| `tunnel_or_host_dependency_unreachable` | tunnel or host outage | no | yes | infrastructure diagnostics |
| `route_binding_conflict` | split-brain route | yes | yes | block actions and reconcile routes |
| `route_generation_mismatch` | reinstall/replacement | yes | maybe | relink or replace flow |
| `device_revoked` | revoked device | n/a | yes | no tenant action |

## 4. Privileged installer eligibility

| Target explicit | Fresh auth | Profile allows auto-install | Attempts under limit | Route conflict | Decision |
|---|---|---|---|---|---|
| no | any | any | any | any | `target_device_required` |
| yes | no | any | any | any | `fresh_authorization_required` |
| yes | yes | no | any | any | `auto_install_not_allowed_by_profile` |
| yes | yes | yes | no | any | `auto_install_cooldown_required` |
| yes | yes | yes | yes | yes | `route_conflict_blocks_installer` |
| yes | yes | yes | yes | no | `installer_eligible` |

## 5. Break-glass access

| Actor | Requested channel | Intent | Decision |
|---|---|---|---|
| tenant user | `admin_break_glass` | status | `break_glass_admin_only` |
| tenant user | `tenant_auth_host` | status | allowed if object authorized |
| tenant user | `tenant_auth_host` | privileged installer | allowed only with fresh auth and target |
| admin | `admin_break_glass` | diagnostics | allowed with admin scope |
| admin | `admin_break_glass` | mutation | typed approval + expected IDs required |
| admin | `tenant_auth_host` | tenant action impersonation | blocked unless explicit delegated support exists |

## 6. Recovered-state decision

| Action completed | Same-cycle route probe | Heartbeat | Generation matches | Decision |
|---|---|---|---|---|
| installer launched | missing | missing | unknown | `verification_pending` |
| installer launched | failure | missing | unknown | `recovery_verification_failed` |
| service running | missing | fresh | yes | `local_service_running_route_unverified` |
| route probe success | success | stale | yes | `route_healthy_heartbeat_stale` |
| route probe success | success | fresh | yes | `recovered` |
| route probe success | success | fresh | no | `route_generation_mismatch` |

## 7. Public UI simplification

| Internal classification | Public UI state | Copy direction |
|---|---|---|
| `healthy_tenant_route` | Connected | Device is reachable. |
| `heartbeat_stale` | Needs attention | Connection data is stale. |
| `runtime_route_not_registered` | Relink required | Device is linked but no active runtime is registered. |
| `route_generation_mismatch` | Relink required | Device appears reinstalled or replaced. |
| `target_device_ambiguous` | Choose device | Select which device to manage. |
| `break_glass_host_failure` | Admin repair required | Admin recovery route needs attention. |
| `tunnel_or_host_dependency_unreachable` | Admin repair required | Platform route or tunnel needs diagnostics. |
| `recovery_verification_failed` | Recovery failed | Repair was attempted but not verified. |

## 8. Error code requirements

- Error codes are stable and lower snake case.
- Error details include route/channel/device context where safe.
- Error envelopes never include secrets, stack traces, or signed URLs.
- 409 is preferred for state/generation conflicts.
- 403 is preferred for break-glass or object-authorization denial.
- 503 is preferred for temporary dependency outages.
