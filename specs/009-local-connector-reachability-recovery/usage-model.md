# Optimal Usage Model

This document defines the intended way to use Local Connector reachability, recovery, auto-install, and break-glass surfaces after the full design is implemented.

## Principles

1. **Select the target first.** Every user-visible action starts by resolving the intended canonical device.
2. **Read before repair.** Show route lifecycle and health evidence before offering repair.
3. **Separate status from recovery.** A status read must not create installers, rotate tokens, or mutate routes.
4. **Use tenant path for user work.** Tenant users operate through `auth.mad4b.com` only.
5. **Use break-glass for admin diagnostics only.** `connector.mad4b.com` is never a tenant action fallback.
6. **Require fresh authorization for privileged recovery.** Saved device-token identity may show status but cannot create privileged installers when stale.
7. **Verify before declaring success.** Installer launch, service start, or provider acknowledgement is not recovery.

## User journey: normal status check

Best path:

```text
User opens Local Manager
-> Local Manager reads saved identity source
-> Auth-host lists eligible devices
-> User selects target device if more than one exists
-> Auth-host returns route_lifecycle + target_selection + current health
-> UI shows Connected / Needs attention / Relink required / Admin repair required
```

Expected UI language:

- `Connected`: heartbeat and selected route are fresh.
- `Needs attention`: partial failure or stale evidence.
- `Relink required`: old generation, missing route registration, reinstall/format likely.
- `Admin repair required`: host/tunnel/break-glass infrastructure issue.

Do not show:

- Raw tokens.
- Full signed URLs.
- Internal stack traces.
- Break-glass controls to tenant users.

## User journey: multiple devices

Best path:

```text
Auth-host resolves user devices
-> If exactly one active device: preselect but still show device summary
-> If multiple devices: require explicit user selection
-> Show canonical device ID, display label, hostname alias, last seen, route status
-> User confirms target before repair or install
```

Rules:

- Hostname is not authority.
- Alias is not authority.
- Last seen device is not authority for state-changing actions.
- `tenant_id + user_id + canonical_device_id` is the authority key.

## User journey: repair same device

Use when:

- Device is same physical machine.
- Windows install appears unchanged.
- Route is stale or service is stopped.

Best path:

```text
Status read
-> Recovery preview: repair_connection
-> User confirms repair
-> Fresh authorization check
-> Installer/repair request generated for selected canonical device
-> Runtime registers route generation
-> Same-cycle health readback
-> UI shows Connected only after verification
```

Failure handling:

- If installer launched but no heartbeat arrives, status is `repair_dispatched_unverified`.
- If local service starts but route probe fails, status is `local_service_running_route_unreachable`.
- If repeated attempts fail, require cooldown/manual review.

## User journey: Windows reinstall or format

Use when:

- Device hostname may be same but install instance changed.
- Local token/config was lost.
- Old route no longer registers.

Best path:

```text
User selects old device
-> Chooses Reinstalled Windows / formatted device
-> Auth-host creates recovery preview: relink_same_device
-> Fresh authorization required
-> Old generation marked stale, not deleted
-> New pairing/install flow creates incremented generation
-> Old route revoked only after replacement readback
```

Rules:

- Do not silently reuse old trust.
- Do not auto-revoke old route before replacement readback unless risk requires admin action.
- Device history remains visible for audit.

## User journey: replace device

Use when:

- User moved to a different machine.
- Old machine should no longer be trusted.

Best path:

```text
User chooses Replace device
-> Auth-host shows old device summary and new device pairing flow
-> Fresh authorization required
-> New canonical device is created
-> Old device status becomes replaced_pending_revoke
-> After new device readback, old device routes are revoked
```

Rules:

- Replacement creates a new canonical device by default.
- Alias reuse is allowed only as display metadata.
- Old device token cannot register a new active route after revocation.

## User journey: auto-install

Auto-install is appropriate only when:

- Target device is explicit.
- Fresh authorization is present.
- Route lifecycle profile allows auto-install for the tenant/user/device.
- Attempt counters and cooldowns allow another attempt.

Best path:

```text
Recovery preview
-> Installer eligibility check
-> Fresh authorization
-> Generate scoped installer token
-> Launch installer or provide download
-> Runtime registers
-> Same-cycle readback
```

Installer token must be scoped to:

- tenant_id
- user_id
- canonical_device_id
- device_generation
- route_channel
- recovery_reason
- expiry
- nonce/idempotency key

## Admin journey: break-glass diagnostics

Use when:

- Tenant auth-host path fails.
- Host/tunnel status is ambiguous.
- Route registry reports no runtime route.
- A recovery action requires infrastructure inspection.

Best path:

```text
Admin opens diagnostics
-> Reads device config and route registry
-> Probes tenant auth-host path
-> Probes break-glass path
-> Probes tunnel/host provider where allowed
-> Produces recovery classification
-> Mutations require separate typed approval and expected IDs
```

Rules:

- Break-glass cannot perform tenant user actions.
- Break-glass mutation must include route ID, device ID, tunnel ID or host ID, expected state, typed confirmation, and readback.
- If break-glass host is down, do not infer local device failure.

## Recommended public UI states

| UI state | Technical basis | Allowed next action |
|---|---|---|
| Connected | fresh heartbeat + healthy selected route | status/details only |
| Needs attention | stale heartbeat or partial probe failure | repair preview |
| Relink required | no registration, generation mismatch, reinstall evidence | relink/reinstall flow |
| Choose device | multiple active devices | explicit target selection |
| Admin repair required | host/tunnel/break-glass infrastructure failure | admin diagnostics |
| Verification pending | installer/repair dispatched but no readback | wait/retry/cancel |
| Recovery failed | readback failed after action | show reason and next safe action |

## Anti-patterns

Do not implement these behaviors:

- Automatically use last-seen device for installer generation.
- Treat 502 as a single failure class.
- Treat installer launch as success.
- Treat service process running as route healthy.
- Show break-glass options to tenant users.
- Retry UAC/installer prompts indefinitely.
- Delete old routes immediately during reinstall before replacement readback.
- Allow DB profile overrides to weaken global security floors.

## Minimum user-facing copy requirements

- Explain identity source: interactive sign-in, saved device token, or admin context.
- Explain selected target device before repair.
- Explain why fresh authorization is needed.
- Explain whether issue is device, tunnel, host, or authorization.
- Provide one recommended next action, not a list of unsafe options.

## Operational exit criteria

A recovery flow is complete only when:

1. Intended canonical device is selected.
2. Route generation is current.
3. Heartbeat is fresh.
4. Required route channel probe succeeds.
5. Any old route/token revocation is recorded.
6. Audit evidence contains no secrets.
