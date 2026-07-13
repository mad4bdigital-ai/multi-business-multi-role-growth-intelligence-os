# Implementation Plan: Repository-Driven Unified Platform Frontend

## Outcome

Build the frontend as two coupled systems: a governed application shell and a source-driven planning compiler. The compiler keeps the product map synchronized with the repository and emits blocked/ready work packets; the shell consumes approved surface descriptors and live APIs.

## Architecture

- **Discovery**: `scripts/frontend-surface-dispatch.mjs` reads mounted routes, OpenAPI, Resource API, surface policy, and the test manifest.
- **Policy**: `frontend-surface-policy.json` records only explicit UI/API/legacy/deferred decisions.
- **Generated contract**: `frontend-surface-dispatch.generated.json` is deterministic and source-pinned.
- **Runtime catalog**: a later route serves a browser-safe subset of approved descriptors.
- **Application shell**: `/platform` with shared theme, navigation, workspace, loading/error/denied/approval/evidence states.
- **Adapters**: explicit tenant and admin read/action adapters; no generic privileged proxy.

## Authority inputs

See `repo-source-authority-map.md`. Runtime mount topology outranks OpenAPI presence; OpenAPI documents contracts but does not make a route live. Logical Resource API authority outranks raw data discovery. Tests and production evidence remain completion gates.

## Delivery DAG

1. **F0 source baseline**: dynamic discovery, policy, schemas, drift check, generated coverage report.
2. **F1 tenant shell**: identity/workspace bootstrap, overview, resources, connections/devices, agents, support, settings.
3. **F2 Admin BFF**: session ledger, HttpOnly exchange, CSRF/origin, expiry/revoke/audit.
4. **F3 admin workspaces**: operations, activation, tenants, resources, authority, agents, plugins, infrastructure, verification, support, governance, release.
5. **F4 Local Manager**: devices, routes, capabilities, backups, repair, settings, compatibility parity.
6. **F5 developer/evidence**: jobs, workflows, sessions, API, graph, changes, revisions, audit evidence.
7. **F6 cutover**: redirects/deep links, telemetry, visual/accessibility/performance gates, staging and production parity.

## Dynamic dispatch algorithm

For each mounted builder, collect literal operations and source digest; normalize signatures; join OpenAPI, resource and test evidence; infer scope conservatively; apply explicit surface policy; score risk; attach dependencies; and emit `ready` only when all hard blockers are absent. A changed authority digest moves work back through discovery.

## Planned runtime structure

```text
http-generic-api/
  frontend-surface-policy.json
  frontend-surface-dispatch.generated.json
  scripts/frontend-surface-dispatch.mjs
  routes/platformFrontendRoutes.js
  public/platform/
    tokens.css
    shell.css
    shell.js
```

## Security boundary

- The generator is read-only and no-secret.
- Tenant data remains server-scoped by membership/workspace.
- Admin APIs are never called directly with a browser-held service key.
- Admin adapters are explicit allowlisted operations behind the BFF session.
- Mutations require preflight, approval decision, same-cycle readback, evidence, and rollback metadata.
- Compatibility routes remain mounted until verified replacement.

## Validation

- unit fixture for mount/OpenAPI/policy/test discovery and deterministic drift;
- generated-plan schema validation;
- route/OpenAPI and Resource API coverage audits;
- Spec Kit completion gate;
- Connect and Local Manager regressions;
- Admin BFF threat model and auth tests;
- WCAG 2.2 AA, responsive, theme, performance, and production parity evidence.

## Branch strategy

The specification/foundation PR contains F0 only. Runtime UI waves follow as bounded PRs referenced by `completion.json`. Before each wave, regenerate on current `main`; do not dispatch from the original specification baseline.
