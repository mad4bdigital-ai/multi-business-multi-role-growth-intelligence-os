# Implementation Quickstart

This is a planning guide, not authorization to change production.

## 1. Establish baseline

- Read the live SQL table census.
- Enumerate existing Admin and Tenant authorization paths.
- Record exact IDs returned by Activation, Connector Inventory, Dynamic Tabs, Dashboard, Tool Catalog, and Runtime.
- Document legacy field meanings.

## 2. Add domain contracts

Create typed contracts for Principal, Actor, Subject Scope, Resource Reference, Capability Operation, Readiness Vector, Version Vector, Decision Gap, Projection Eligibility, and Effective Authority Manifest.

Add tests proving zero-tenant is not Admin authority, Tenant scope cannot expand, ambiguity blocks, shadow cannot execute, and manifests serialize no secrets.

## 3. Build shadow resolver

Call existing semantic capability, connection, endpoint, certification, membership, and grant authorities. Produce a shadow manifest and ledger bounded evidence. Do not alter runtime behavior.

## 4. Compare parity

Compare exact resource/action/connection IDs and reason codes. Classify every mismatch. Stop rollout on unexplained over-grants or cross-tenant differences.

## 5. Cut over safe reads

Start with Admin diagnostics and connector readiness, then Dynamic Tabs, Dashboard, and Tool Catalog. Preserve legacy response fields during migration.

## 6. Add final enforcement

Introduce shared PEP checks and same-cycle revalidation for selected read-only capabilities. Move to reversible writes only after approval, idempotency, readback, rollback, and certification are proven.

## 7. Operate continuously

Publish invalidation events, maintain synthetic principals, reconcile sets, alert on drift, and verify production after every authority-affecting release.
