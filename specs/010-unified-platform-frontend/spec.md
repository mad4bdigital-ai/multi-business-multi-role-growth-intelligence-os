# Feature Specification: Repository-Driven Unified Platform Frontend

**Branch**: `gpt/repo-driven-frontend-dispatch-20260713`  
**Status**: In progress  
**Delivery**: Multi-PR  
**Specification PR**: current

## Problem

The platform exposes a large, fast-changing governed route surface while browser experiences are split across Connect, Local Manager, onboarding, and API-only Admin/Tenant capabilities. A static screen list becomes incomplete as the repository evolves. The frontend program therefore needs one shell and a repository-derived coverage/dispatch system that continuously finds new work and fails closed on authority, security, contract, or verification gaps.

## User scenarios

### Tenant operator

An authenticated tenant user opens `/platform`, resolves an active workspace, and sees only tenant-safe capabilities derived from live repository contracts. Read and action states preserve membership, approval, evidence, and readback rules.

### Platform administrator

An administrator uses a short-lived server-bound Admin UI session. Admin screens are generated from explicit adapters and authority maps; browser code never receives the backend service key.

### Local device operator

A tenant-owned Local Manager device is shown with identity, reachability freshness, routes, backups, capabilities, repair guidance, trust, and local consent. Existing Local Manager URLs remain available until parity is proven.

### Developer or auditor

An explicitly granted user explores contracts, jobs, workflows, sessions, graph, changes, revisions, and redacted evidence through read-only defaults.

### Frontend planner

When routes, OpenAPI, resources, migrations, browser assets, or tests change, the planner regenerates a source-pinned DAG. New families appear automatically; risky or incomplete families are blocked with exact remediation rather than silently omitted.

## Functional requirements

- **FR-001**: Serve one responsive application shell at `/platform`.
- **FR-002**: Support light, dark, and system themes using the established MAD4B Connect token language.
- **FR-003**: Resolve principal, membership, workspace, scope, and surface policy before data loading.
- **FR-004**: Publish a versioned, no-secret UI surface catalog.
- **FR-005**: Catalog entries declare scope, group, read route, mutation class, auth mode, evidence/readback route, state, owner, and fallback.
- **FR-006**: Tenant calls use signed user JWT and server-derived tenant/workspace scope.
- **FR-007**: Browser code and storage never receive `BACKEND_API_KEY`.
- **FR-008**: Admin UI uses a short-lived HttpOnly same-site session with CSRF, origin binding, explicit admin authority, expiry, revoke, and audit.
- **FR-009**: State-changing controls expose preflight, approval, expected effect, same-cycle readback, evidence, and rollback before dispatch.
- **FR-010**: Resource views consume logical Resource API descriptors and never derive browser authority from raw table names.
- **FR-011**: Local Manager preserves ownership, reachability freshness, trust, local consent, and one-device/one-route rules.
- **FR-012**: Evidence is redacted and distinguishes pass, deny, not-applicable, not-evaluated, pending, and stale.
- **FR-013**: Connect and Local Manager deep links remain backward compatible until verified cutover.
- **FR-014**: The foundation remains dependency-light and compatible with the existing Node runtime.
- **FR-015**: Every delivered family has deterministic tests registered in the explicit test manifest.
- **FR-016**: The planner discovers only route builders mounted by `routes/index.js`; unmounted contracts are reported separately.
- **FR-017**: Express and OpenAPI operations are normalized into a stable method/path signature.
- **FR-018**: Each dispatch plan pins the baseline ref and SHA-256 of authority inputs.
- **FR-019**: Authority drift invalidates affected tasks and requires regeneration.
- **FR-020**: Missing scope, auth, OpenAPI, surface policy, test ownership, or mutation readback blocks dispatch.
- **FR-021**: Manual decisions live only in a versioned repository policy with owner and rationale.
- **FR-022**: Manual policy cannot hide mounted routes, relax authentication, waive secret rules, or mark tests/evidence complete.
- **FR-023**: The planner assigns dependency-aware waves for tenant, Admin BFF, admin, Local Manager, developer/evidence, and cutover work.
- **FR-024**: Tasks without dependency edges and with disjoint source ownership may be executed in parallel.
- **FR-025**: The generated report includes ready/blocked counts and exact blockers for every family.
- **FR-026**: Coverage completion uses conjunctive gates; navigation presence alone is never completion.
- **FR-027**: Removed route families require deprecation, redirect, and production-readback evidence.
- **FR-028**: Generation performs no provider call, database write, external send, deployment, approval, or secret read.
- **FR-029**: Current embedded UI is compatibility evidence, not proof of unified UI parity.
- **FR-030**: Generated dispatch output is deterministic for identical repository inputs.

## Scope model

| Scope | Authentication | Browser secret policy | Mutation policy |
|---|---|---|---|
| Public | none | no secrets | none by default |
| Tenant | user JWT + membership | JWT only | capability/approval governed |
| Workspace owner | user JWT + owner role | JWT only | workspace lifecycle policy |
| Admin | HttpOnly Admin BFF session | no backend key | explicit adapter and admin approval |
| Local device | user JWT + device trust + local consent | no connector secret response | capability-specific |
| Developer/auditor | explicit grant | no raw provider credentials | read-only by default |

## Success criteria

- **SC-001**: The generator inventories every mounted route family with source digest and mount order.
- **SC-002**: Every family has an explicit scope, policy decision, wave, owner/test mapping, or a visible blocker.
- **SC-003**: A source change makes `--check` fail until the plan is regenerated.
- **SC-004**: No generated artifact or public asset contains backend keys or credential material.
- **SC-005**: Admin families depend on the F2 Admin BFF boundary.
- **SC-006**: Mutating families without readback remain blocked.
- **SC-007**: Tenant users navigate dashboard, resources, connections/devices, agents, support, and settings from one shell after F1.
- **SC-008**: Existing Connect and Local Manager tests remain green through cutover.
- **SC-009**: Light/dark preference persists and primary flows meet WCAG 2.2 AA.
- **SC-010**: Completion requires CI, migration evidence where applicable, staging/production parity, and post-merge audit.
