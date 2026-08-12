# Risk Register: Local Connector Reachability Recovery

This register captures concerns that must be resolved before runtime implementation, migration application, auto-install enablement, or production recovery automation.

Risk scoring uses:

- **Impact:** low, medium, high, critical.
- **Likelihood:** low, medium, high.
- **Decision:** accept, mitigate, block until design change, or defer with explicit owner.

## R1: Config-health confusion

**Concern:** A device config can exist while no runtime route is registered. Treating `connector_auth_configured: true` as connectivity may produce false recovery or trigger actions against a dead route.

**Impact:** high.  
**Likelihood:** high.  
**Decision:** mitigate.

Required controls:
- Separate `config_status`, `registration_status`, `route_status`, `tunnel_status`, and `local_service_status`.
- Never mark a device healthy from config alone.
- `registered_route_count = 0` must produce a distinct recovery reason: `runtime_route_not_registered`.

## R2: False recovery after provider acknowledgement

**Concern:** Cloudflare, GitHub, installer generation, or host API acknowledgement may be mistaken for recovered device connectivity.

**Impact:** critical.  
**Likelihood:** medium.  
**Decision:** block until controls exist.

Required controls:
- `recovered` requires same-cycle readback from the previously failing channel or a verified replacement channel.
- Recovery plans must record `acknowledged`, `dispatched`, `verified`, and `failed_verification` separately.
- UI must not display success until verification passes.

## R3: Tenant route silently escalates to break-glass

**Concern:** When auth-host fails, implementation may route tenant actions through `connector.mad4b.com` because it is available.

**Impact:** critical.  
**Likelihood:** medium.  
**Decision:** block until controls exist.

Required controls:
- `admin_break_glass` is admin-only and never tenant-selectable.
- Recovery planner may recommend admin diagnostics but cannot execute them under tenant authority.
- Route channel must be part of authorization, audit, and installer-token claims.

## R4: Wrong-device action in multi-device accounts

**Concern:** A user can have multiple devices, reused hostnames, legacy aliases, or stale config aliases. Auto-install or repair may target the wrong machine.

**Impact:** critical.  
**Likelihood:** high.  
**Decision:** block until controls exist.

Required controls:
- Resolve state-changing actions by `tenant_id + user_id + canonical_device_id`.
- Reject ambiguous device selectors.
- Use aliases only for display/search assistance.
- Show device generation, last seen, and route channel before repair.

## R5: Device replacement inherits old trust

**Concern:** New hardware or a reinstalled Windows instance may reuse hostname or config ID and inherit old route trust.

**Impact:** high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Track `device_generation` and optional `windows_install_instance_id` evidence.
- Treat reinstall/replacement as a relink event requiring fresh authorization.
- Rotate device tokens and revoke old route generation after replacement readback.

## R6: Stale saved device token triggers privileged installer

**Concern:** Local Manager may know a user from a saved device token and generate a privileged installer without an interactive user present.

**Impact:** critical.  
**Likelihood:** medium.  
**Decision:** already partially mitigated; keep blocking gate.

Required controls:
- Privileged installer generation requires fresh authorization.
- Installer claims include tenant, user, canonical device, route channel, recovery reason, TTL, and generation.
- Stale-token failure must return stable `fresh_authorization_required` or equivalent structured error.

## R7: Token replay after reinstall or route generation change

**Concern:** An installer token or device token can be replayed after reinstall, device replacement, or route revocation.

**Impact:** critical.  
**Likelihood:** medium.  
**Decision:** block until controls exist.

Required controls:
- Token claims must include route/device generation and expiry.
- Server verifies current generation before accepting registration or installer callback.
- Replay after generation mismatch returns `route_generation_mismatch`.

## R8: Break-glass host as a single point of failure

**Concern:** `connector.mad4b.com` failing alongside auth-host leaves no remote repair path.

**Impact:** high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Separate host-level health from device-level health.
- Add runbook for break-glass host outage: DNS, Cloudflare tunnel, process, service manager, deployment state.
- Do not conclude local device failure when the break-glass host itself is unavailable.

## R9: Cloudflare tunnel status ambiguity

**Concern:** A 502 may mean host process failure, tunnel disconnect, DNS/proxy issue, firewall, or local service failure. Treating all 502s the same leads to wrong repair action.

**Impact:** high.  
**Likelihood:** high.  
**Decision:** mitigate.

Required controls:
- Probe host, tunnel, and local service independently.
- Preserve provider error code and sanitized message.
- Map failure to `host_unreachable`, `tunnel_unreachable`, `local_service_unreachable`, or `proxy_upstream_bad_gateway`.

## R10: Route registry split-brain

**Concern:** Two runtime processes or two devices may register the same canonical device or config route concurrently.

**Impact:** high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Route registration uses generation and idempotency key.
- Active route uniqueness is enforced per `device_id + route_channel + generation`.
- Conflicting registration creates `route_binding_conflict` and blocks state-changing actions.

## R11: Heartbeat spoofing

**Concern:** A malicious client submits heartbeat records for another device.

**Impact:** critical.  
**Likelihood:** low-to-medium.  
**Decision:** block until controls exist.

Required controls:
- Heartbeat is signed by scoped device credential.
- Object-level authorization verifies tenant/user/device binding.
- Heartbeat cannot change canonical ownership.
- Suspicious heartbeat creates alert but not healthy state.

## R12: Diagnostics leak secrets or sensitive machine identifiers

**Concern:** Rich diagnostics may expose tokens, signed URLs, connector secrets, machine GUIDs, local paths, or internal stack traces.

**Impact:** critical.  
**Likelihood:** medium.  
**Decision:** block until redaction contract exists.

Required controls:
- Store hashes for machine identifiers.
- Return endpoint host and route ID, not signed URLs.
- Redact local filesystem paths unless explicitly safe.
- Use structured error envelopes and no stack traces.

## R13: Profile override weakens security

**Concern:** DB-backed route lifecycle profiles may allow tenant/user/device overrides that weaken global security requirements.

**Impact:** critical.  
**Likelihood:** medium.  
**Decision:** block until precedence controls exist.

Required controls:
- Profile overlays can only narrow privileges unless admin-approved exception exists.
- Global security floors cannot be disabled by tenant/user/device profile.
- Profile provenance must be returned in readback via `applied_profiles`.

## R14: Auto-install loops or repeated UAC prompts

**Concern:** Failed auto-install can repeatedly prompt UAC or launch installers without improving state.

**Impact:** medium-to-high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Add attempt counters and cooldowns per device/recovery reason.
- Require manual confirmation after repeated failure.
- Mark recovery plan `failed_verification` instead of retrying forever.

## R15: User confusion between relink, reinstall, repair, and replace

**Concern:** A user may pick the wrong recovery action and break an otherwise recoverable route.

**Impact:** medium.  
**Likelihood:** high.  
**Decision:** mitigate.

Required controls:
- UI labels map to safe recovery reasons: repair connection, relink same device, reinstall after Windows change, replace device.
- Dangerous actions show old/new device identity summary.
- Revoke/replace requires explicit confirmation.

## R16: Migration performance and table growth

**Concern:** Heartbeats and probes can grow quickly and cause slow diagnostics or large storage cost.

**Impact:** medium.  
**Likelihood:** high.  
**Decision:** mitigate.

Required controls:
- Index by tenant/user/device/route/status/time.
- Use bounded retention and aggregation.
- Keep diagnostics queries paginated or latest-state based.
- Avoid N+1 route/probe lookups.

## R17: Backward compatibility for existing Local Manager versions

**Concern:** Existing clients may not understand new route lifecycle fields, states, or error codes.

**Impact:** medium.  
**Likelihood:** high.  
**Decision:** mitigate.

Required controls:
- Add fields only; do not remove existing fields.
- Preserve current endpoints until clients migrate.
- Return stable optional fields and documented structured errors.
- Gate new behavior by version/profile where needed.

## R18: Over-trusting local process status

**Concern:** Local Manager may report a service running even though the HTTP runtime endpoint is unreachable.

**Impact:** medium.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Process status is only one signal.
- Healthy requires both heartbeat freshness and route/probe success.
- Conflicting signals produce `degraded`, not `healthy`.

## R19: Race between revocation and registration

**Concern:** A stale route can re-register while an admin/user is revoking or replacing it.

**Impact:** high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Route generation and state version are checked on every registration.
- Revoked route credentials cannot create a new active route.
- Use optimistic locking or compare-and-set updates.

## R20: Incomplete observability hides production-only failures

**Concern:** CI and local tests may pass while production host/tunnel/DNS/fleet behavior fails.

**Impact:** high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Add production-safe read-only probes and synthetic diagnostics.
- Record request IDs and route IDs for every probe.
- Add alerting for missing heartbeat, unregistered route, and repeated 502.

## R21: Break-glass repair mutates the wrong infrastructure

**Concern:** Admin recovery may modify the wrong tunnel, DNS record, service, or device binding.

**Impact:** critical.  
**Likelihood:** low-to-medium.  
**Decision:** block until controls exist.

Required controls:
- Break-glass mutations require typed approval, expected IDs, and readback.
- Mutations must be scoped to route ID, tunnel ID, zone ID, and device ID.
- Dry-run and readback are mandatory.

## R22: Privacy and personal-data exposure

**Concern:** Device names, hostnames, machine identifiers, and user emails can become visible in diagnostics or logs.

**Impact:** high.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Use display labels only where needed.
- Hash or redact stable machine identifiers.
- Avoid logging email/device aliases in high-volume logs.
- Keep audit access admin-scoped.

## R23: Local firewall or antivirus blocks service after install

**Concern:** Installer succeeds but local firewall, antivirus, or Windows service permissions block runtime access.

**Impact:** medium.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Recovery plan distinguishes `installer_succeeded_but_service_unreachable`.
- Local Manager should collect safe local diagnostics: service status, port bind status, process exit code.
- Do not mark install success as route success.

## R24: Clock skew affects freshness and token expiry

**Concern:** Device clock skew can break heartbeat freshness, token TTL, or generation validity.

**Impact:** medium.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Server receipt time is authoritative for freshness.
- Device-reported time is diagnostic only.
- Token expiry uses server validation.

## R25: Recovery plan becomes too complex to operate

**Concern:** Too many states and actions can confuse maintainers and users.

**Impact:** medium.  
**Likelihood:** medium.  
**Decision:** mitigate.

Required controls:
- Public UI shows simplified states: connected, needs attention, relink required, admin repair required.
- Admin diagnostics retain detailed state and reason codes.
- Runbooks map every reason code to exactly one next recommended action.

## Minimum blocking concerns before implementation

Implementation PRs must not proceed until these have explicit design answers:

1. R2 false recovery.
2. R3 tenant-to-break-glass escalation.
3. R4 wrong-device action.
4. R6 stale token privileged installer.
5. R7 token replay after generation change.
6. R11 heartbeat spoofing.
7. R12 diagnostics secret leakage.
8. R13 profile override weakening security.
9. R21 wrong-infrastructure break-glass mutation.

## Review questions

- What is the exact canonical device identity source when Windows is reinstalled?
- Which claims are mandatory in runtime registration?
- Which recovery reasons can be user self-service versus admin-only?
- What is the maximum acceptable stale heartbeat age for active devices?
- Which fields are safe to expose to Tenant UI versus Admin diagnostics?
- How many failed recovery attempts trigger cooldown or admin escalation?
- What is the rollback path if new route registry disagrees with existing config rows?
