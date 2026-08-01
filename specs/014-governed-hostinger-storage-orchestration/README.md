# Spec 014 — Governed Hostinger Storage Orchestration

This package specifies one storage orchestration domain for Hostinger-hosted resources with separate, fail-closed Admin and Tenant authority surfaces.

## Problem

A hosting-plan storage limit was reached and Hostinger temporarily raised the limit so File Manager became accessible again. The incident demonstrated that storage pressure can block File Manager, environment-variable updates, builds, deployments, and application recovery before operators can safely identify or remove the responsible files.

The platform therefore needs more than a cleanup script. It needs governed orchestration for:

- byte and inode pressure;
- account, website, deployment, and tenant resource ownership;
- read-only scans and immutable cleanup plans;
- Admin/Tenant authority resolution;
- approvals, delegation, execution leases, and typed confirmation;
- fixed SSH provider operations;
- same-operation readback and unknown-outcome reconciliation;
- deployment prevention at critical pressure.

## Package status

```text
Specification: implementation_in_progress
Runtime routes: not wired
SQL migrations: not created/applied
Live SSH dispatch: disabled
Hostinger mutation: not performed
Production deployment: not authorized
```

The existing implementation on the feature branch is limited to conservative filesystem tooling, machine-readable policies, pure authorization logic, regression tests, and documentation. It does not create live runtime authority.

## Tenant repository provenance regression

The Tenant canary workstream now declares `test-hostinger-storage-tenant-canary-repository-provenance.mjs` in `e2e-phases.json`. The regression proves that delegated execution accepts only a factory-owned Tenant repository that also preserves the canonical control-plane repository identity, rejects copied or direct repositories, rejects an explicit missing adapter, and performs those checks before one-shot enablement is consumed.

This hardening remains synthetic and in-memory. It does not authorize a provider call, filesystem mutation, SSH operation, migration, deployment, or Production promotion.

## Core architecture

```text
Admin surface ─┐
               ├─ Context Kernel + Effective Authority
Tenant surface ┘              ↓
                    Storage Orchestration Service
                              ↓
                immutable plan / approval / lease
                              ↓
                 fixed Hostinger SSH adapter
                              ↓
                   provider readback/evidence
```

## Required reading order

1. `spec.md`
2. `research.md`
3. `concerns.md`
4. `operation-paths.md`
5. `data-model.md`
6. `plan.md`
7. `tasks.md`
8. `acceptance-matrix.md`
9. `work-map-integration.json`
10. `rollout.md`

## Authority boundary

Spec Kit artifacts express intent and verification requirements. They do not authorize:

- database migration apply;
- provider calls;
- credential reads;
- live SSH execution;
- cleanup deletion;
- merge to `main`;
- Production promotion;
- Hostinger Auto Deploy.

Every consequential operation remains subject to live Context Kernel resolution, Effective Authority, Capability Envelope, Resource Authority, approval, lease, fixed adapter dispatch, audit, and same-cycle readback.
