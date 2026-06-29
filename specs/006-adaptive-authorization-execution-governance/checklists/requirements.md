# Requirements Checklist

## Scope and model

- [x] Capability, grant, authorization, approval, execution, and verification states are separate.
- [x] Relationship, contextual policy, and explicit grants are separate authorities.
- [x] Pilots cover read, internal write, and external high-impact execution.
- [x] Existing routes remain compatibility surfaces during migration.
- [ ] Existing registry ownership is mapped for every logical resource.

## Contracts and behavior

- [x] Draft OpenAPI uses version 3.1.
- [x] Subject, action, resource, and context are explicit.
- [x] Errors use stable machine-readable codes.
- [x] Mutable lists use cursor pagination.
- [x] Active approval-gated grants remain active.
- [x] Ambiguous selection fails closed.
- [x] Stale approvals and envelopes cannot be reused.
- [x] Shadow mode performs no provider mutation.
- [ ] Root OpenAPI, generated clients, and acceptance tests are updated during implementation.

## Delivery

- [x] Delivery mode is `multi_pr`.
- [x] PR1 implementation, CI, merge, ancestry, and branch-cleanup evidence is recorded.
- [ ] Remaining implementation and migration evidence is recorded.
- [ ] Production verification and post-merge audit are complete.

## Branch hygiene

- [x] The merged PR1 source branch was deleted with zero unique commits verified.
- [x] The PR1936 v5 and v6 resolution branches were deleted after exact blob-equivalence checks.
- [x] The two older orphan reconciliation branches were repaired to the accepted `main` test blob without force.
- [x] Both repaired orphan branches passed exact equivalence checks and were deleted with missing-reference readback.
- [x] The ambiguous 502 response for the second deletion was resolved by immediate 404 reference readback without retry.
