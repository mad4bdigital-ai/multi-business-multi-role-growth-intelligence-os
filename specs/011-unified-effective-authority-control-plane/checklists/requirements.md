# Requirements Checklist

## Scope

- [x] Admin and Tenant use one decision architecture.
- [x] Actor and Subject are separated.
- [x] Platform visibility is not mutation authority.
- [x] Service principals, agents, agencies, and support delegation are covered.
- [x] Tool, tab, dashboard, connector, and runtime projections are covered.

## Authority semantics

- [x] RBAC, ABAC, ReBAC, and capability authorization are defined.
- [x] Semantic capability precedes provider/tool selection.
- [x] Deterministic connection selection and ambiguity blocking are defined.
- [x] Resource inheritance is policy-driven.
- [x] Approval, delegation, freshness, and certification are explicit layers.

## State and projections

- [x] Connector state is multi-dimensional.
- [x] Registered, Authorized, Projected, Executable, and Observed are distinct.
- [x] Set invariants are defined.
- [x] Exclusion reasons are required.
- [x] Drift detection is specified.

## Delivery

- [x] Additive shadow-first migration is defined.
- [x] Multi-PR sequence is defined.
- [x] Rollback and deprecation gates are defined.
- [x] Production verification and post-merge audit are required.
- [x] No runtime effect is introduced by this Spec Kit branch.

## Pending implementation evidence

- [ ] Live SQL census mapped to physical schema.
- [ ] Migrations reviewed and authorized.
- [ ] OpenAPI contracts implemented and linted.
- [ ] Shadow parity thresholds approved.
- [ ] Cross-tenant suite passing.
- [ ] Production verification complete.
