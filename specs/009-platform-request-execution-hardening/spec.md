# Platform Request Execution Hardening

## Status

Implemented in pull request #2551 and pending final review and merge.

The pull request contains runtime changes, OpenAPI contracts, tests, and three additive database migrations. The migrations are included but have not been applied. No provider write, production deployment, force-push, or merge is part of this delivery step.

## Objective

Move execution complexity from Agents into governed, high-level platform operations across Admin and Tenant User surfaces.

## Scope

The implemented slice covers repository operations, operation context, capability lifecycle, generated-artifact reconciliation, managed Git workers, typed catalogs, observability, bounded responses, structured errors, persistent operation ownership, and safe resume behavior.

The wider architecture remains applicable to activation, connections, credentials, providers, Growth Intelligence, deployment, local-device operations, and operational intelligence. Those surfaces must adopt the same operation contract, authority, budget, evidence, and readback rules when implemented.

## Problem

Low-level tool composition causes repeated discovery, unnecessary registry and SQL inspection, delayed authorization failures, inconsistent retries, raw upstream errors, fragile branch reconciliation, oversized responses, and excessive latency. Tenant workflows also require early object-level authorization so one tenant cannot inspect or resume another tenant's operation.

## Implemented architecture

### Operation-level interface

Agents invoke stable application operations instead of dynamically composing low-level tools. Implemented repository and lifecycle operations include:

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

Admin operations require explicit platform or selected-tenant authority. Tenant users are restricted to authorized tenant, workspace, brand, repository, connection, and resource bindings. Authentication is resolved centrally; route-level handlers consume the trusted principal context and separately enforce membership and object-level authorization.

### Unified operation context

A bounded operation snapshot resolves principal, authority, repository state, relevant registry surfaces, capability readiness, dependencies, fallbacks, blockers, risk, and budget. Normal operations do not expose `information_schema`, capability ledgers, secrets, or raw provider payloads to Agents.

### Repository orchestration

`repo_change_execute` coordinates authorization, capability lifecycle, context resolution, base synchronization, typed repository inspection, change generation, generated-artifact reconciliation, validation, CI diagnosis, readback, and evidence response.

Repository mutations remain branch-pinned, idempotent, bounded, approval-aware, and protected against force updates to protected branches.

### Managed ephemeral Git worker

Git tree operations run through an isolated managed worker with short-lived authority. The worker supports head pinning, atomic leases, tenant isolation, virtual Git tree checkout, cleanup, expiry, final-head readback, and reconciliation without dependence on Local Connector.

### Capability lifecycle

Operation-scoped capability envelopes are created when absent, renewed when expired, bound to principal/resource/intent, and consumed or revoked at terminal state. A newly created or renewed envelope does not receive approval automatically; approval requirements remain governed and may block execution with a structured conflict response.

### Generated artifacts

Generated artifacts are governed by registry metadata that declares source authority, generator, merge policy, edit policy, and regeneration timing. Generated files are regenerated after source reconciliation rather than manually merged when a generator is authoritative.

### Typed catalogs and observability

Tenant-safe typed catalog projections and operation observability are implemented. Observability remains aggregate and bounded, and does not expose tenant SQL, secrets, capability payloads, or raw provider data.

### Errors, response bounds, and resume

Failures use stable JSON envelopes. Upstream HTML or unstructured failures are normalized. Responses support bounded modes and durable detail references. Operation state is persisted across `requested`, `context_loaded`, `preflight_passed`, `executing`, `validating`, and terminal states. Resume reuses completed context and checkpoints rather than rediscovering them.

## Database changes

The pull request includes three additive, forward-only migrations:

1. `20260713_operation_run_ownership.sql`
2. `20260714_operation_generated_artifacts.sql`
3. `20260715_operation_managed_git_worker_leases.sql`

They are included for review but have not been applied. Production migration execution, rollback validation, deployment, and post-merge verification require separate governed operations and approvals.

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
3. Simple operations remain within declared internal-dispatch budgets.
4. Responses cannot exceed declared bounds.
5. Upstream failures are normalized into structured JSON.
6. Mutations require idempotency and same-cycle readback.
7. Admin and Tenant projections pass isolation contract tests.
8. Repository workflows do not require Local Connector.
9. Resume does not rediscover completed context.
10. CI gates enforce syntax, architecture, execution resolution, regression behavior, response bounds, and tenant isolation.
11. OpenAPI contracts remain synchronized with runtime behavior.
12. Migrations and production deployment are not executed as part of PR review or merge preparation.

## Delivery state

The implementation branch is synchronized with `main`, and the required CI checks passed on the reconciled implementation head recorded in `completion.json`. Final review, merge, migration application, deployment, production verification, and post-merge audit remain separate governed steps.
