# Architecture

## Core model

Reachability is not a single boolean. It is the composition of four independently observable layers:

```text
identity binding -> route registration -> tunnel/host reachability -> local service health
```

A route can be configured but not registered. A tunnel can be reachable while the local service is down. A break-glass host can fail while auth-host routing remains healthy. These states must be represented independently.

## Route channels

### tenant_auth_host

- Host: `auth.mad4b.com`.
- Scope: tenant/user actions, target device selection, status, auto-install, capability installer.
- Auth barrier: user JWT or fresh Local Manager device token, depending on action risk.
- Cannot execute admin recovery actions.

### admin_break_glass

- Host: `connector.mad4b.com`.
- Scope: admin diagnostics, emergency repair, tunnel/host forensics.
- Auth barrier: admin break-glass connector authority.
- Cannot be selected by tenant action dispatch.

## State machine

```text
provisioned -> paired -> registered -> healthy
      |           |          |        |
      v           v          v        v
reprovision_required <- stale <- degraded <- failure_after_success
      |
      v
revoked
```

State meanings:

- `provisioned`: config exists but no device proof yet.
- `paired`: device has paired but has no live runtime route.
- `registered`: runtime has registered a route in the current generation.
- `healthy`: latest probe and heartbeat are within freshness limits.
- `degraded`: partial path failure; at least one required probe failed.
- `stale`: heartbeat or probe freshness expired.
- `unreachable`: probes confirm transport failure.
- `reprovision_required`: route cannot be repaired without relink/reinstall.
- `revoked`: route is blocked and cannot be used.

## Data flow

### Normal status read

1. Client calls auth-host with tenant/user/device selector.
2. Auth-host resolves canonical device from profile and registry.
3. Route lifecycle service loads route records and heartbeat evidence.
4. Probe summary is merged without making long-running live calls by default.
5. Response returns route states, selected target, and recovery recommendations.

### Active repair preview

1. Client requests recovery plan preview.
2. Auth-host evaluates current route states and user authorization.
3. Planner returns candidate actions: retry, relink, reinstall, replace, revoke, break-glass diagnostics.
4. No installer token or secret is generated in preview.

### Privileged installer generation

1. Client selects canonical device and recovery reason.
2. Auth-host requires fresh authorization.
3. Installer token is scoped to tenant/user/device/channel/reason.
4. Generated artifact never includes plaintext long-lived secrets.
5. Same-cycle readback verifies route or records `pending_relink`.

## Components

- `RouteLifecycleService`: resolves profile-aware target and route state.
- `RouteRegistryRepository`: reads and writes route records.
- `HeartbeatIngestService`: validates and stores runtime heartbeat.
- `ProbeOrchestrator`: schedules and records probe evidence.
- `RecoveryPlanner`: converts state evidence to next actions.
- `InstallerAuthorityService`: issues scoped installer requests after fresh authorization.
- `BreakGlassAdapter`: admin-only diagnostics for connector.mad4b.com.

## Invariants

- Config presence is not health.
- Provider acknowledgement is not verified reachability.
- Break-glass does not grant tenant authority.
- Recovered requires same-cycle readback.
- Device aliases do not override canonical device identity.
- All recovery decisions must be auditable and reproducible from evidence.
