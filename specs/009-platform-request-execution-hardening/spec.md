# Platform Request Execution Hardening

## Status
Proposed — design-only implementation specification.

## Objective
Move execution complexity from Agents into governed, high-level platform operations across both Admin and Tenant User surfaces.

## Scope
Applies to activation, repository work, connections, credentials, providers, Growth Intelligence, deployment, local-device operations, and operational intelligence.

## Problem
The platform currently exposes low-level tools and requires the Agent to discover and compose execution paths. This creates repeated tool discovery, SQL inspection, chunk handling, delayed authorization failures, inconsistent retries, raw HTML upstream errors, fragile branch reconciliation, and excessive latency.

## Required architecture

### Operation-level interface
Agents invoke stable application operations:
- `operation_context_get`
- `repo_change_preview`
- `repo_change_execute`
- `repo_reconcile_execute`
- `ci_diagnose`
- `operation_status_get`
- `operation_resume`

Canonical intents include `repo.spec.extend`, `repo.branch.reconcile`, `repo.change.validate`, `repo.pr.finalize`, `platform.surface.inspect`, and `brand.connection.create|update|delete`.

### Admin and Tenant authority
Every operation contract declares principal scope, tenant/workspace/resource authority, permissions, redaction, approvals, provider-write boundaries, idempotency, readback, and execution budget.

Admin operations require explicit platform or selected-tenant authority. Tenant users are always restricted to authorized tenant, workspace, brand, repository, connection, and resource bindings.

### Unified operation context
A bounded operation snapshot resolves principal, authority, repository state, relevant registry surfaces, capability readiness, dependencies, fallbacks, blockers, risk, and budget. Normal operations must not query `information_schema` or capability ledgers.

### Repo Change Orchestrator
`repo_change_execute` performs:
authorization → capability issuance → context snapshot → base synchronization → typed repository/catalog inspection → change generation → generated-artifact reconciliation → validation → CI diagnosis → readback → evidence response.

### Managed Ephemeral Git Worker
Git tree operations run in an isolated worker with short-lived GitHub credentials. It supports large PRs, real merge/rebase operations, generated files, validation, no-force branch updates, and no dependency on Local Connector.

### Capability lifecycle
Operation-scoped envelopes are issued automatically, bound to operation/principal/resource/intent, renewed while active, hidden from Agents except diagnostics, and consumed or revoked at terminal state.

### Generated artifacts
A registry declares path pattern, generator, source authority, merge policy, edit policy, and regeneration timing. Generated files are regenerated after source reconciliation instead of manually merged.

### CI diagnosis
`ci_diagnose` returns failing check, step, command, exit code, structured reason, affected paths, root cause, recommended safe action, and retry eligibility.

### Errors and responses
All failures use stable JSON envelopes. HTML upstream bodies are normalized. Large responses support `summary`, `relevant`, and `full`; composite operations consume internal chunks and return completeness plus durable detail references.

### Operation lifecycle
`requested → context_loaded → preflight_passed → executing → validating → completed`
or `blocked|failed|cancelled`, with persisted checkpoints and safe resume.

### Execution budgets
Every operation defines maximum internal calls, discovery calls, retries, elapsed time, and response size. Authorization failures terminate before catalog or provider calls.

## Admin/Tenant matrix

| Concern | Admin | Tenant User |
|---|---|---|
| Scope | Explicit platform or selected tenant | Authorized tenant/workspace only |
| Catalog | Governed full catalog | Tenant-safe projections |
| SQL | Infrastructure-only | Never exposed |
| Connections | Platform or tenant-owned by authority | Tenant-owned only |
| Repository mutation | Governed platform repositories | Explicitly delegated repositories |
| Credentials | No secret payload exposure | No secret payload exposure |
| Approvals | Policy plus typed confirmation | Role/ownership plus typed confirmation |
| Readback | Required | Required and tenant-filtered |
| Audit | Platform audit | Bounded tenant-visible audit |

## Acceptance criteria
1. Known operations perform no text-based tool discovery.
2. Authorization failures occur before provider or broad catalog calls.
3. Simple operations use at most three internal dispatches.
4. Responses cannot exceed declared bounds.
5. Upstream failures are normalized JSON.
6. Mutations require idempotency and same-cycle readback.
7. Admin/Tenant projections pass isolation contract tests.
8. Repository workflows do not require Local Connector.
9. Resume does not rediscover completed context.
10. CI gates enforce schema, latency, response size, internal-call count, and tenant isolation.
