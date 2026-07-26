# Specification

## Goals

1. Model platform, tenant, workspace, business activity, brand, agent, user, workflow, and step scopes consistently.
2. Publish platform agents/workflows as canonical assets or templates.
3. Allow tenants to install, override, extend, fork, and author assets without mutating platform canonicals.
4. Keep authority separate from containment, inheritance, execution class, and credential ownership.
5. Make provider runtimes replaceable adapters rather than workflow authorities.
6. Guarantee idempotent, auditable, fail-closed execution with immutable resolution snapshots.

## User stories

### Platform administrator

- Publish a new agent or workflow to selected tenant audiences.
- Set customization and upgrade policies.
- Enforce mandatory security, approval, certification, and readback constraints.
- Retire a version without deleting tenant forks or historical runs.

### Tenant administrator

- Discover tenant-available platform assets.
- Install and bind an asset to a workspace, business activity, or brand.
- Pin, approve, or automatically adopt compatible versions.
- Create bounded overrides, extensions, governed forks, and tenant-authored assets.

### Workflow operator

- Start a run with an idempotency key.
- Inspect resolved settings, selected adapter, approvals, state, and audit evidence.
- Retry, pause, resume, cancel, or compensate only through valid transitions.

## Functional requirements

- **FR-001** Containers MUST use typed identities and typed relationships.
- **FR-002** Platform Scope MUST contain a real Platform Admin Workspace, which MUST contain Platform Brand.
- **FR-003** Tenant workspaces MUST NOT be contained by Platform Admin Workspace.
- **FR-004** Authority MUST resolve from principal, resource binding, grants, constraints, certification, approval, and readback.
- **FR-005** `execution_class` MUST NOT grant authority.
- **FR-006** Platform assets MUST have immutable versions and publication policies.
- **FR-007** Tenant customization MUST support install, override, extend, fork, and tenant-authored modes.
- **FR-008** Overrides MUST be sparse and schema-validated.
- **FR-009** Security constraints MUST use deny-wins / most-restrictive semantics.
- **FR-010** Every run MUST persist an immutable settings-resolution snapshot and hash.
- **FR-011** Unsafe retryable creates MUST require an idempotency key.
- **FR-012** Run transitions MUST use compare-and-set expected state/version.
- **FR-013** Dispatch and delivery MUST use a transactional outbox or equivalent atomic boundary.
- **FR-014** Runtime adapters MUST implement readiness, validation, dispatch, inspection, cancellation, readback, and output normalization.
- **FR-015** Callbacks MUST validate signature, nonce, expiry, adapter binding, and idempotency.
- **FR-016** Mandatory approvals MUST survive forks and tenant-authored assets.
- **FR-017** Tenant resources and credentials MUST remain tenant-isolated.
- **FR-018** Active workflow versions MUST be immutable; edits create a new draft version.
- **FR-019** Generated workflows MUST remain draft until schema, policy, compatibility, and approval validation pass.
- **FR-020** Platform updates MUST never silently rewrite tenant forks.

## Non-functional requirements

- OpenAPI 3.1 contracts and stable structured errors.
- Additive migrations before destructive changes.
- Deterministic resolution and hashable snapshots.
- Structured logs, traces, and metrics without secrets.
- Horizontal-safe claims, leases, callbacks, and retries.
- Backward-compatible feature-flagged rollout.
