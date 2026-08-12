# Connection Maps

This document maps the intended connection paths, route channels, failure boundaries, and recovery paths for Local Connector reachability.

## Map 1: normal tenant status path

```mermaid
flowchart LR
  U[Tenant user] --> LM[Local Manager UI]
  LM --> AH[auth.mad4b.com]
  AH --> TS[Target selection service]
  TS --> DB[(Device + route registry)]
  AH --> RP[Route lifecycle resolver]
  RP --> DB
  RP --> UI[Status response]
  UI --> LM
```

Purpose:

- Read-only status.
- Explicit target selection.
- No installer generation.
- No break-glass route.

Failure boundary:

- If auth-host cannot resolve target, stop with structured error.
- If no registered route exists, show relink/repair recommendation, not connected.

## Map 2: tenant action path through auth-host

```mermaid
flowchart LR
  U[Tenant user] --> AH[auth.mad4b.com]
  AH --> AUTHZ[Auth + object authorization]
  AUTHZ --> SEL[Canonical device selector]
  SEL --> RLC[Route lifecycle check]
  RLC --> PROXY[Connector proxy tenant channel]
  PROXY --> TUN[Cloudflare tunnel / device runtime URL]
  TUN --> LC[Local Connector service]
  LC --> RB[Readback]
  RB --> AH
```

Rules:

- Tenant action uses `tenant_auth_host` only.
- The selected route must match tenant/user/device.
- Break-glass is not a fallback.
- Success requires readback.

## Map 3: admin break-glass diagnostics path

```mermaid
flowchart LR
  A[Admin operator] --> BG[connector.mad4b.com]
  A --> AH[auth.mad4b.com admin diagnostics]
  AH --> DB[(Route registry + evidence)]
  BG --> HOST[Break-glass host runtime]
  HOST --> TUN[Cloudflare tunnel or connector admin path]
  TUN --> LC[Local Connector service]
  LC --> EVID[Diagnostic evidence]
  EVID --> AH
```

Rules:

- Admin-only.
- Diagnostic by default.
- Mutations require typed approval, expected IDs, and readback.
- Tenant users never receive this channel as an action route.

## Map 4: runtime registration and heartbeat

```mermaid
sequenceDiagram
  participant LC as Local Connector service
  participant LM as Local Manager
  participant AH as auth.mad4b.com
  participant DB as Device/route registry

  LC->>AH: register route(device_id, generation, channel, capabilities_hash)
  AH->>AH: validate device credential and tenant/user binding
  AH->>DB: upsert route registration
  LM->>AH: heartbeat(process, version, local_port, tunnel_status)
  AH->>DB: store heartbeat evidence
  AH-->>LM: accepted + current route state
```

Failure classification:

- Registration rejected: `route_registration_rejected`.
- Missing heartbeat: `heartbeat_stale`.
- Generation mismatch: `route_generation_mismatch`.
- Credential mismatch: `device_credential_scope_mismatch`.

## Map 5: auto-install / repair flow

```mermaid
flowchart TD
  START[User requests repair] --> STATUS[Read status and route lifecycle]
  STATUS --> TARGET{Target explicit?}
  TARGET -- no --> CHOOSE[Ask user to choose canonical device]
  TARGET -- yes --> AUTH{Fresh authorization?}
  CHOOSE --> AUTH
  AUTH -- no --> REAUTH[Prompt sign-in / reauth]
  AUTH -- yes --> PLAN[Recovery plan preview]
  PLAN --> ELIG{Auto-install eligible by profile?}
  ELIG -- no --> MANUAL[Show manual/admin path]
  ELIG -- yes --> TOKEN[Create scoped installer token]
  TOKEN --> INSTALL[Launch/download installer]
  INSTALL --> REGISTER[Runtime registers route]
  REGISTER --> VERIFY[Same-cycle health readback]
  VERIFY --> DONE{Verified?}
  DONE -- yes --> CONNECTED[Connected]
  DONE -- no --> FAILED[Recovery failed / next safe action]
```

Required token claims:

- tenant_id
- user_id
- canonical_device_id
- device_generation
- route_channel
- recovery_reason
- expiry
- nonce/idempotency key

## Map 6: format / Windows reinstall recovery

```mermaid
stateDiagram-v2
  [*] --> ActiveDevice
  ActiveDevice --> StaleRoute: no heartbeat / no registration
  StaleRoute --> ReinstallDeclared: user selects reinstall or format
  ReinstallDeclared --> FreshAuthRequired
  FreshAuthRequired --> NewGenerationPending: authorization passed
  NewGenerationPending --> NewRuntimeRegistered
  NewRuntimeRegistered --> ReplacementVerified: route health readback success
  ReplacementVerified --> OldGenerationRevoked
  OldGenerationRevoked --> [*]

  FreshAuthRequired --> Blocked: authorization missing or stale
  NewRuntimeRegistered --> VerificationFailed: no readback
  VerificationFailed --> ManualReview
```

Rules:

- Old route is marked stale before replacement.
- Old route is revoked only after successful replacement readback or explicit admin decision.
- Reinstall does not silently inherit old device trust.

## Map 7: device replacement recovery

```mermaid
flowchart LR
  OLD[Old canonical device] --> MARK[Mark replaced_pending_revoke]
  NEW[New physical device] --> PAIR[Fresh pairing]
  PAIR --> NEWID[Create new canonical device]
  NEWID --> ROUTE[Register new route generation]
  ROUTE --> VERIFY[Verify new device route]
  VERIFY --> REVOKE[Revoke old device routes]
  REVOKE --> AUDIT[Audit replacement evidence]
```

Decision rule:

- Same physical device + same install evidence: relink same canonical device.
- New physical device or uncertain identity: create new canonical device.
- Old hostname reuse is display metadata only.

## Map 8: failure-classification matrix

| Auth-host path | Break-glass path | Tunnel probe | Local heartbeat | Likely classification | Recommended next action |
|---|---|---|---|---|---|
| success | success | success | fresh | healthy | no repair |
| success | skipped | unknown | stale | heartbeat_stale | repair preview |
| failure 502 | success | success | fresh | auth_host_proxy_failure | auth-host/proxy repair |
| success | failure 502 | success | fresh | break_glass_host_failure | admin host repair, tenant path still usable |
| failure 502 | failure 502 | failure | stale | tunnel_or_host_dependency_unreachable | admin infrastructure diagnostics |
| success | success | success | missing | local_service_unregistered | relink/reinstall flow |
| timeout | timeout | unknown | missing | unknown_reachability | no mutation; collect diagnostics |

## Map 9: trust boundaries

```mermaid
flowchart TB
  subgraph Tenant Boundary
    U[Tenant user]
    LM[Local Manager]
  end

  subgraph Auth Host Boundary
    AH[auth.mad4b.com]
    AUTHZ[Authorization]
    DB[(DB profiles + routes)]
  end

  subgraph Admin Boundary
    BG[connector.mad4b.com]
    ADMIN[Admin operator]
  end

  subgraph Device Boundary
    LC[Local Connector]
    WIN[Windows service/process]
  end

  U --> LM --> AH
  AH --> AUTHZ --> DB
  ADMIN --> BG
  AH -.tenant route.-> LC
  BG -.admin diagnostics.-> LC
  LC --> WIN
```

Boundary rules:

- Tenant authority and admin authority are never merged.
- Device claims are untrusted until validated against DB binding.
- Local process evidence is diagnostic, not sufficient for route success.
- DB profile overlays cannot weaken global security floors.

## Map 10: data write paths

```mermaid
flowchart LR
  REG[Runtime registration] --> ROUTES[(local_connector_routes)]
  HB[Heartbeat ingest] --> HEART[(local_connector_heartbeats)]
  PROBE[Probe orchestrator] --> PR[(local_connector_probe_results)]
  PLAN[Recovery planner] --> REC[(local_connector_recovery_plans)]
  PROFILE[Admin profile config] --> PROF[(local_connector_route_lifecycle_profiles)]
```

Write-path requirements:

- Every write has tenant/user/device/route context where applicable.
- State-changing writes are idempotent or version-checked.
- No plaintext secrets are persisted.
- High-volume heartbeat/probe tables require retention and indexes.

## Map 11: safe operational dashboard

```text
Device: <display label>
Canonical ID: <canonical_device_id>
Aliases: <hostname, legacy config id>
Identity source: interactive sign-in | saved device token | admin
Selected route: tenant_auth_host | admin_break_glass
Registration: registered | not registered
Heartbeat: fresh | stale | missing
Auth-host path: healthy | degraded | unreachable
Break-glass path: healthy | degraded | unreachable | admin-only
Tunnel: connected | disconnected | unknown
Local service: running | stopped | unknown
Recommended action: status only | repair | relink | reinstall | replace | admin diagnostics
Verification: pending | verified | failed
```

Dashboard rule:

- Public tenant dashboard hides admin-only controls and sensitive route internals.
- Admin dashboard may show route IDs and sanitized endpoint hosts but not secrets.
