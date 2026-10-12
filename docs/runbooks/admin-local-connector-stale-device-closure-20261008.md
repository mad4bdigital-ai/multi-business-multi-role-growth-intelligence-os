# MAD4B App Control — Stale Local Connector Device Closure (2026-10-08)

## Affected scope
MAD4B App Control in `multi-business-multi-role-growth-intelligence-os`, not Remote Desktop Commander.

`mohammedlap` is a historical device identifier. A May 2026 document mapped `mohammedlap -> essam-pc`, but that is historical alias evidence and **does not prove which device is connected now**. Treat the actual device as UNKNOWN until identity, heartbeat, authentication and routing are verified on the same live runtime.

## Code contract
1. `GET /admin/cli/local-connector/devices` is read-only and scoped by signed identity or explicit authorized user/tenant. It exposes lifecycle/heartbeat metadata but no credential values.
2. Install Bundle and Self Repair use a canonical device record from `local_connector_user_configs`, not a hostname default, fuzzy `LIKE` search or a remembered tunnel.
3. For ordinary execution an omitted `device_id` may resolve a unique fresh active device. For **diagnosis or installer** the canonical device must be explicit; a Stale heartbeat permits read-only diagnosis but never device commands. Revoked, archived, disabled, foreign and ambiguous devices always fail closed.
4. Historical aliases, including globally scoped aliases, cannot silently redirect privileged operations. A canonical ID must be explicitly selected.
5. Secrets are fetched only after a second read using exact `config_id + user_id + tenant_id + device_id` and lifecycle checks. `CLOUDFLARE_TUNNEL_TOKEN` and `BACKEND_API_KEY` are not substitutes for device-owned credentials. Neither status nor self-repair may refill DB tokens opportunistically.
6. Denials return a code and safe message; database/SQL failures are not exposed as raw errors.

## Live acceptance checklist — not satisfied by GitHub tests alone
- Establish latest deployed Staging commit and exact schema readiness. Required fields: `lifecycle_state`, `revoked_at`, `archived_at`, `last_health_at`, plus `local_connector_device_aliases`.
- Inspect the real tenant/user device inventory, verify its canonical ID with a fresh authenticated **device-owned** attestation and check that no duplicate active config or stale alias remains effective.
- Verify scoped inventory returns zero secrets. Evaluate one-active, multi-active, stale, archived, revoked, mismatched tenant/user, alias, DB denial and schema-missing cases.
- Test JSON-only legacy Admin diagnosis and the independent signed Installer POST separately. Direct Admin BAT delivery returns 410 and may never reveal connector credentials. A stale device requires an explicitly scoped new installer capability; never treat stale as execution-ready or recovered. Fresh signer authorization remains a separate acceptance gate.
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


## Deep Self-Recovery audit — 2026-10-09
| Failure boundary | Guard in PR #8461 | Operational verification |
|---|---|---|
| Historical hostname becomes execution target | Explicit canonical selection and no alias fallback | Review live alias registry across scopes |
| Stale heartbeat blocks diagnostics | Diagnosis intent accepts explicitly selected Stale devices | Staging dry-run with stopped connector |
| Device revoked but still has signed installer token | Lifecycle check at link, BAT, PS1 and redeem | Revoke between issue and redeem |
| Duplicate canonical configurations | Refuse target/provisioning when duplicates exist | Staging duplicate fixture |
| Backend key impersonates device heartbeat | Device credential required; platform key rejected | Verify old clients use owned device token |
| Failure/started event promotes heartbeat or healthy route | Stamp freshness only on successful `health_ok` | Check failure and partial restart cases |
| Malicious or wrong-device tunnel URL | Trusted HTTPS route bound to config or Cloudflare tunnel ID | Hostname and redirect denial |
| Redirect escapes trusted host | Public and authenticated health fetch use `redirect: manual` | Test malicious 302/307 |
| Tunnel outage misdiagnosed as local service failure | Return infrastructure diagnostics, no blind installer | Simulate Cloudflare 530 and host 502 |
| Response declared recovered without identity | Require fresh heartbeat and authenticated matching device/config | Authenticated runtime readback |
| Reprovision resurrects archived/revoked device | Hard block before Cloudflare write | Re-enrollment with NEW identity |

### Self-Recovery state machine
```text
DISCOVER -> CANONICAL_TARGET -> READ_ONLY_DIAGNOSE
                                    |
             reachable + authenticated + fresh heartbeat + matching config/device
                                    -> GENERATION_ATTESTATION -> VERIFIED_RECOVERED
             tunnel / host uncertain -> INFRASTRUCTURE_DIAGNOSTICS
             credentials wrong       -> CREDENTIAL_RECONCILIATION
             route missing           -> GOVERNED_ROUTE_PROVISIONING
             service unavailable     -> REPAIR_PREVIEW -> FRESH_AUTH
                                             -> EXPLICIT_TARGET_CONFIRM
                                             -> SIGNED_INSTALLER
                                             -> SAME_CYCLE_READBACK
                                             -> VERIFIED_RECOVERED / FAILED_VERIFICATION
             Windows reinstall       -> GENERATION_AWARE_RELINK (not auto)
             replaced/revoked        -> NEW_PAIRING (no inherited trust)
```

### Open blocking evidence
- **Device generation and token replay:** The legacy installer capability claim currently relies on `config_id/user_id/tenant_id/device_id/jti/expiry`; end-to-end generation fencing after Windows reinstall or hardware replacement must be independently certified before Production rollout. One-time `jti` mitigates replay, but does not itself attest a new physical device generation.
- **Fresh authorization:** Legacy Admin BAT credential delivery has been retired. The signed installer flow still requires proof of fresh principal authorization and a true device-generation binding before being certified for autonomous repair.
- **Durable attempt budget:** An in-memory health retry policy does not prove persisted recovery attempt limits, idempotency and cooldown across process restarts.
- **Recovery completion:** Cloudflare API status, a 200 health response, installer generation or token issuance are not sufficient. Authenticated device/config identity plus fresh heartbeat and route generation readback are required.
- **Live deployment:** No verified Staging/Production schema, tunnel ownership, adapter version, exact HEAD or end-to-end recovery execution is included in this PR's local tests.
- **Schema artifacts:** Hand-edited Admin Core OpenAPI projections need generator byte-for-byte parity and OpenAPI validation on the exact HEAD.
- **Backward compatibility:** Rejecting platform backend keys for device heartbeat may require upgrading old connector agents to scoped device credentials before deploying.


## Watchdog and device-origin fixes (code complete, runtime acceptance pending)

- Removed the hard-coded shared Admin Recovery health probe `connector.mad4b.com/health`. Watchdog resolves `CONNECTOR_PUBLIC_HEALTH_URL` only from the signed, config-scoped installer environment.
- Watchdog validates the exact `lc-<config-prefix>.mad4b.com` or tunnel-ID-owned `cfargotunnel.com` route, HTTPS, no credentials/query/redirect and forbids touching Staging service ownership.
- Replaced Windows hostname-based heartbeat identity with `CONNECTOR_CONFIG_ID` and `CONNECTOR_DEVICE_ID`; watchdog reads `CONNECTOR_SECRET_FILE` in its restricted `secrets` directory instead of assuming a plaintext `.env` secret.
- The heartbeat response acknowledgement is `response.event.event_id`; both local runtime `/policy` and post-install policy checks now expose the canonical IDs.
- Watchdog emits `health_ok` after a successfully verified service restart or rollback, while failed attempts do not promote health freshness.
- Script reconstructed from the clean `main` source after detecting and correcting a duplicated PowerShell section during review. Source-level checks enforce one definition of each critical function and bounded file length.

**Deployment compatibility gate:** Preexisting connectors without generated `CONNECTOR_CONFIG_ID`, `CONNECTOR_DEVICE_ID`, `CONNECTOR_PUBLIC_HEALTH_URL`, `CONNECTOR_TUNNEL_ID` and scoped secret file cannot pass the new watchdog policy. Upgrade through the canonical signed installer after independently proving its exact target; do not disable validation to preserve old agents.

**Recovery authority still blocked without proof:** Device generation / Windows install instance fencing, durable attempt leases, fresh authorization for canonical signed installer, and independent same-cycle Staging acceptance must all be certified before Production. In particular, a legitimate Stale device may be diagnosed, but cannot inherit a past hostname, alias or signed credential as proof of a new physical generation.
