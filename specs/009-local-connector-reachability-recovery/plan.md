# Implementation Plan

## Delivery mode

Use `multi_pr`. The design touches data model, diagnostics, auth-host contracts, local runtime heartbeat, Local Manager UI, Cloudflare/host recovery, and operational runbooks. A single implementation PR would be too risky.

## Phase 0: Specification only

- Add this Spec Kit as a Draft PR.
- Do not apply migrations or runtime behavior.
- Review the data model, contracts, threat model, and PR sequence.

## Phase 1: Additive storage and read-only diagnostics

- Add governed migrations for route registry, heartbeat, probe evidence, device aliases, and recovery plans.
- Seed no runtime credentials.
- Add read-only APIs for route lifecycle, target candidates, and recovery plan preview.
- Keep existing diagnostics response unchanged except for additive fields.

## Phase 2: Runtime registration and heartbeat

- Implement connector startup registration.
- Add local service heartbeat from Local Manager/Connector to auth-host.
- Track version, process status, local port, tunnel endpoint, and capabilities snapshot hash.
- Fail closed if heartbeat claims do not match tenant/user/device binding.

## Phase 3: Probe orchestration

- Add independent probes for:
  - tenant auth-host proxy path
  - admin break-glass path
  - Cloudflare tunnel endpoint
  - local runtime health endpoint
  - local service process status through Local Manager
- Persist probe evidence with bounded TTL and stable reason codes.

## Phase 4: Target selection and multi-device UX

- Expose target candidates in auth-host.
- Require explicit device selector when multiple devices exist.
- Add Local Manager UI states for canonical device, aliases, route channel, and recovery action.

## Phase 5: Auto-install and disaster recovery

- Add recovery planner for `format`, `windows_reinstall`, `device_replacement`, and `route_repair`.
- Require fresh authorization for privileged installer generation.
- Rotate tokens for reinstall/replacement flows.
- Mark old routes stale/revoked only after readback or explicit admin action.

## Phase 6: Break-glass hardening

- Add admin-only break-glass diagnostics and repair endpoints.
- Ensure tenant requests cannot select break-glass route.
- Audit all break-glass reads and mutations.

## Phase 7: Completion and production verification

- Verify production route lifecycle and heartbeat readback.
- Run same-cycle recovery simulations.
- Update operational runbooks and completion ledger.

## Architectural boundaries

- Route handlers map request/response only.
- Route lifecycle selection lives in application/domain services.
- Persistence is behind repository/adapters.
- External host/tunnel probes are infrastructure adapters with timeouts and structured error mapping.

## Rollback model

- Additive tables can remain inert if feature flags are disabled.
- Probe/heartbeat consumers can be disabled independently.
- Auto-install repair stays disabled until diagnostics and target selection are verified.
- Break-glass mutations remain admin-only and gated by typed approval.
