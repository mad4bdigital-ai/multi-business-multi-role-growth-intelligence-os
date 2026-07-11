# Feature Specification: Unified Platform Frontend

**Branch**: `gpt/unified-platform-frontend-spec-kit-20260711`  
**Status**: In progress  
**Delivery**: Multi-PR

## Problem

The platform exposes more than one hundred governed routes, but its browser experience is split across an onboarding application, embedded Local Manager HTML pages, and API-only Admin/Tenant surfaces. Users cannot discover what they can do, which workspace is active, which operations are safe, or where evidence is stored from one coherent interface.

## User scenarios

### Scenario 1 — Tenant operator

Given an authenticated tenant user, when the user opens `/platform`, then the application resolves the active workspace, lists only tenant-safe surfaces, loads dashboard/resource/support data from live APIs, and never exposes platform credentials.

### Scenario 2 — Platform administrator

Given a platform administrator with a short-lived server-bound Admin UI session, when the administrator opens the Admin workspace, then the console exposes operational, activation, resource, agent, plugin, infrastructure, support, verification, governance, and release surfaces according to registry authority.

### Scenario 3 — Local device operator

Given a tenant-owned Local Manager device, when the user opens the Devices area, then the application displays device identity, reachability, routes, backups, capabilities, repair guidance, and explicit approval states without returning connector secrets.

### Scenario 4 — Developer and auditor

Given an authorized developer or auditor, when the user opens a technical surface, then route contracts, jobs, sessions, evidence, changes, revisions, and readback are available through read-only governed views.

## Functional requirements

- **FR-001**: The platform MUST serve one responsive application shell at `/platform`.
- **FR-002**: The shell MUST support light/dark themes, system preference, keyboard navigation, loading, empty, degraded, denied, approval-required, error, and success states.
- **FR-003**: The shell MUST resolve principal, workspace, membership, and surface scope before loading data.
- **FR-004**: The server MUST publish a versioned, no-secret UI surface catalog.
- **FR-005**: Surface catalog entries MUST declare scope, group, read route, mutation class, evidence route, status, and fallback.
- **FR-006**: Tenant calls MUST use the signed user JWT and server-derived tenant scope.
- **FR-007**: Admin APIs MUST NOT receive `BACKEND_API_KEY` from browser code or browser storage.
- **FR-008**: Admin UI access MUST use a short-lived, HttpOnly, same-site, server-bound session with CSRF protection and explicit admin authority.
- **FR-009**: Every state-changing control MUST show preflight, approval requirement, expected effect, readback, and rollback metadata before dispatch.
- **FR-010**: The resource explorer MUST use logical Resource API descriptors rather than raw table names.
- **FR-011**: Local Manager views MUST preserve device ownership, reachability freshness, local consent, and one-device/one-route constraints.
- **FR-012**: Evidence views MUST redact secrets and distinguish pass, deny, not-applicable, and not-evaluated.
- **FR-013**: Existing `/connect` and Local Manager URLs MUST remain backward-compatible during consolidation.
- **FR-014**: The frontend MUST remain dependency-light and deploy with the existing Node runtime.
- **FR-015**: Every delivered surface MUST have deterministic contract tests and be registered in the explicit test manifest.

## Scope model

| Scope | Authentication | Browser secret policy | Mutation policy |
|---|---|---|---|
| Public | None | No secrets | None |
| Tenant | User JWT + membership | JWT only | Capability/approval governed |
| Workspace owner | User JWT + owner role | JWT only | Workspace lifecycle policy |
| Admin | HttpOnly server-bound session | No backend key in browser | Admin approval policy |
| Local device | User JWT + device trust + local consent | No connector secret response | Capability-specific |
| Developer/auditor | Explicit grant | No raw provider credentials | Read-only by default |

## Success criteria

- **SC-001**: `/platform` loads and exposes a versioned surface catalog.
- **SC-002**: Tenant users can navigate dashboard, resources, connections/devices, agents, support, and settings from one shell.
- **SC-003**: No public asset contains `BACKEND_API_KEY`, connector secrets, or credential material.
- **SC-004**: Admin surfaces fail closed until the Admin BFF session is present.
- **SC-005**: Light/dark preference persists and all primary controls remain keyboard accessible.
- **SC-006**: Existing Connect and Local Manager tests remain green.
- **SC-007**: Project-wide surface matrix has an owner and delivery wave for every discovered route family.
