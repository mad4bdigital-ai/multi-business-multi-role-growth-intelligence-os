# Implementation and Rollout Plan

## Phase 0 — Reconciliation

- Reconcile open Spec 004/005 dependencies.
- Inventory current workflow, agent, asset, connector, approval, execution-log, and memory surfaces.
- Map legacy states and execution classes without granting new authority.

## Phase 1 — Domain and persistence

- Add typed containers and relationships.
- Add asset definitions, immutable versions, publication, installation, overrides, extensions, forks, and upgrades.
- Add workflow definitions, versions, steps, edges, compiled plans, and validation.
- Use additive reversible migrations.

## Phase 2 — Authority and settings

- Implement principal/resource authority resolver.
- Implement sparse settings resolver and merge operators.
- Persist immutable snapshots and evidence.
- Add platform-principal path without fake tenant ownership.

## Phase 3 — Runtime core

- Implement compare-and-set run and step state machines.
- Add claims, leases, idempotency, approvals, callbacks, retries, compensation, and transactional outbox.
- Separate principal authority from execution class.

## Phase 4 — Adapters

- Implement platform-native first.
- Add n8n webhook/API, Make MCP, generic MCP, HTTP action, and agent runtime behind certification.
- Require readiness and readback.

## Phase 5 — Tenant asset lifecycle

- Catalog discovery and installation.
- Bounded overrides and extensions.
- Governed forks and tenant-authored assets.
- Upgrade preview, compatibility, pinning, and approval.

## Phase 6 — Rollout

1. Dark-deploy schemas and flags.
2. Shadow authority/settings resolution.
3. Pilot platform-native internal workflows.
4. Publish selected low-risk templates to selected tenants.
5. Enable one certified external adapter at a time.
6. Enable tenant authoring by cohort.
7. Remove legacy paths only after parity and rollback evidence.

## Rollback

- Disable feature flags and adapter certifications.
- Stop new claims while preserving reconciliation.
- Retain immutable run and transition evidence.
- Never delete tenant forks or installations.
- Revert readers only after compatibility checks.

## Required production gates

- tenant-isolation and object-authorization tests pass;
- state/idempotency stress tests pass;
- migration rollback rehearsal passes;
- readback coverage meets policy;
- security review has no unresolved critical findings;
- runbook, dashboards, and explicit production approval exist.
