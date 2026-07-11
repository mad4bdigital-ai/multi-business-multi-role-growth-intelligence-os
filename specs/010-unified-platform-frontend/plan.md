# Implementation Plan: Unified Platform Frontend

## Summary

Create a governed browser shell inside `http-generic-api`, reuse the current MAD4B design tokens, and progressively consolidate Tenant, Admin, Local Manager, developer, and evidence experiences. The frontend consumes existing APIs; new BFF routes are added only where browser-safe authorization is missing.

## Architecture impact

- **Interface**: `/platform`, static assets, versioned surface catalog.
- **Application**: role/workspace bootstrap, surface resolution, read-model adapters, mutation preflight.
- **Domain**: UI surface descriptor, view state, action state, evidence state.
- **Infrastructure**: existing Resource API, dashboard, support, activation, device, graph, verification, and operations services.
- **Database**: no schema change in foundation PR; later Admin session ledger is additive.
- **OpenAPI**: document BFF endpoints when introduced; static HTML/assets remain outside execution contracts.
- **Canonicals**: update only when authorization or runtime behavior changes.

## Delivery waves

1. **F0 — Inventory and design system**: surface matrix, tokens, shell contract.
2. **F1 — Tenant shell**: authentication, workspace switch, overview, resources, connections/devices, agents, support, settings.
3. **F2 — Admin BFF**: HttpOnly short-lived session, CSRF, admin surface adapters, audit.
4. **F3 — Admin workspaces**: operations, activation, tenants, resources, agents, plugins, infrastructure, verification, support, governance, release.
5. **F4 — Local Manager consolidation**: devices, routes, backups, settings, repair, capabilities.
6. **F5 — Developer/evidence**: jobs, workflows, sessions, API contracts, graph, changes, revisions, audit evidence.
7. **F6 — Cutover**: deep links, legacy redirects, telemetry, production parity, accessibility audit.

## Frontend structure

```text
public/platform/
  platform-shell.css
  platform-shell.js
routes/platformFrontendRoutes.js
```

The first implementation is framework-free to avoid adding a second build system to the runtime. Components are rendered from surface descriptors and live JSON contracts. A future framework migration requires a separate ADR.

## Safety and rollout

- Browser code never accepts or persists `BACKEND_API_KEY`.
- Tenant JWT remains consistent with `/connect` during foundation.
- Admin entries remain visible but locked until a BFF session is available.
- Mutations are not generically proxied.
- New routes mount before root-level protected routers.
- Legacy UI remains available throughout rollout.
- Rollback removes the new route registration without affecting APIs.

## Validation

- structural route/static asset tests;
- surface catalog scope and secret-redaction assertions;
- tenant endpoint template assertions;
- theme/accessibility smoke assertions;
- existing Connect and Local Manager regression tests;
- changed-scope resource coverage and Spec Kit completion gates.
