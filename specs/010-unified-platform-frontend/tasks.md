# Tasks: Unified Platform Frontend

## Specification

- [x] T001 Define user scenarios, scopes, requirements, and success criteria.
- [x] T002 Inventory primary Admin, Tenant, Local Manager, developer, and evidence families.
- [x] T003 Define authentication and browser secret boundaries.
- [x] T004 Define delivery waves and backward-compatibility rules.

## F0/F1 foundation implementation

- [x] T010 Add the versioned UI surface catalog.
- [x] T011 Add the responsive `/platform` application shell.
- [x] T012 Add persistent light/dark theme and responsive navigation.
- [x] T013 Add tenant login, session restore, workspace context, and sign-out.
- [x] T014 Bind overview, dashboard, resources, support, connect/device, and Local Manager links to live routes.
- [x] T015 Fail closed for Admin entries without an Admin BFF session.
- [x] T016 Add loading, empty, error, denied, locked, and JSON/table rendering states.
- [x] T017 Mount the frontend before root-level protected routers.
- [x] T018 Add structural/security regression tests and test-manifest registration.

## F2 Admin BFF

- [ ] T100 Add additive Admin UI session/audit persistence.
- [ ] T101 Implement short-lived HttpOnly Admin UI session exchange.
- [ ] T102 Add CSRF and origin binding.
- [ ] T103 Add explicit read-model adapters; do not implement a generic admin proxy.
- [ ] T104 Add admin session expiry, revoke, and readback tests.

## F3 Admin workspaces

- [ ] T120 Implement Operations and Activation workspaces.
- [ ] T121 Implement Tenants, Resources, and Authority workspaces.
- [ ] T122 Implement Agents, Plugins, and Connected Execution workspaces.
- [ ] T123 Implement Infrastructure, Verification, and Release workspaces.
- [ ] T124 Implement Support, Governance, and audit evidence workspaces.

## F4/F5 consolidation

- [ ] T140 Consolidate Local Manager device/routes/backups/settings surfaces.
- [ ] T141 Implement governed repair and capability approval UX.
- [ ] T150 Implement Jobs, Workflows, Sessions, API, Graph, Changes, and Revisions.
- [ ] T151 Add accessibility, performance, and responsive visual regression gates.

## Completion governance

- [x] T200 Set `multi_pr` because Admin session persistence and production verification are required.
- [ ] T201 Record implementation PRs and merge SHAs.
- [ ] T202 Record migration ledger evidence for Admin session persistence.
- [ ] T203 Record staging and production parity evidence.
- [ ] T204 Complete post-merge audit and final closeout PR.
