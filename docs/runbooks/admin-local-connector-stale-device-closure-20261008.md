# MAD4B App Control — Stale Local Connector Device Closure (2026-10-08)

## Affected scope
MAD4B App Control in `multi-business-multi-role-growth-intelligence-os`, not Remote Desktop Commander.

`mohammedlap` is a historical device identifier. A May 2026 document mapped `mohammedlap -> essam-pc`, but that is historical alias evidence and **does not prove which device is connected now**. Treat the actual device as UNKNOWN until identity, heartbeat, authentication and routing are verified on the same live runtime.

## Code contract
1. `GET /admin/cli/local-connector/devices` is read-only and scoped by signed identity or explicit authorized user/tenant. It exposes lifecycle/heartbeat metadata but no credential values.
2. Install Bundle and Self Repair use a canonical device record from `local_connector_user_configs`, not a hostname default, fuzzy `LIKE` search or a remembered tunnel.
3. Without a requested `device_id`, the resolver selects only if **exactly one** fresh active device exists for the exact user/tenant. Zero, multiple, unknown, revoked, archived, disabled and stale devices fail closed.
4. Historical aliases from `local_connector_device_aliases` cannot silently redirect privileged operations. A canonical ID must be explicitly selected.
5. Secrets are fetched only after a second read using exact `config_id + user_id + tenant_id + device_id` and lifecycle checks. `CLOUDFLARE_TUNNEL_TOKEN` and `BACKEND_API_KEY` are not substitutes for device-owned credentials. Neither status nor self-repair may refill DB tokens opportunistically.
6. Denials return a code and safe message; database/SQL failures are not exposed as raw errors.

## Live acceptance checklist — not satisfied by GitHub tests alone
- Establish latest deployed Staging commit and exact schema readiness. Required fields: `lifecycle_state`, `revoked_at`, `archived_at`, `last_health_at`, plus `local_connector_device_aliases`.
- Inspect the real tenant/user device inventory, verify its canonical ID with a fresh authenticated **device-owned** attestation and check that no duplicate active config or stale alias remains effective.
- Verify scoped inventory returns zero secrets. Evaluate one-active, multi-active, stale, archived, revoked, mismatched tenant/user, alias, DB denial and schema-missing cases.
- Test installer JSON mode and protected BAT mode separately. No secret-bearing public link, no plain credentials in logs, and no installer for an unauthenticated or stale target.
- Test healthy connector readback, authorization-degraded response, Cloudflare 1033/530 bounded retries and missing scoped tunnel token continuation without platform-wide token fallback.
- Run the forward catalog migration through governed planning, independently authorized apply, and same-cycle readback. **Do not** re-run older seed migrations 032/036/054.
- Rebuild/check canonical OpenAPI and generated variants, exact commit artifact/CI parity, then Staging browser acceptance.
- Do not promote Production until specific Production grants, runtime schema, source identity and independent approval are established.

## Expected risk cases
| Scenario | Required behavior |
|---|---|
| No selected device, exactly one fresh active | Resolve that canonical config |
| No selected device, zero/multiple eligible | 409; no dispatch |
| Explicit historical alias (e.g. mohammedlap) | 409; never silently alias to another device |
| Explicit stale/revoked/archived/disabled | 409; no installer |
| Tenant/user mismatch | 403 or scoped no-match |
| Device DB identity/credential/route missing | 409 or verified scoped no-match; no global fallback |
| DB unavailable/schema unready | Fail closed; no fallback or mutation |
| New/replaced PC | Governed re-enrollment, fresh device authentication, duplicate containment and separate authorization |

## Change boundaries
This PR changes GitHub source and forward migration text only. It does **not** execute a migration, enroll/disconnect any physical device, rotate credentials, deploy Staging, or mutate Production.
