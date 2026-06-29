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
- [ ] Implementation and migration evidence is recorded.
- [ ] Production verification and post-merge audit are complete.
