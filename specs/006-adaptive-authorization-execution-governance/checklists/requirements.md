# Requirements Checklist

## Scope and model

- [x] Capability, grant, authorization, approval, execution, and verification states are separate.
- [x] Relationship, contextual policy, and explicit grants are separate authorities.
- [x] Pilot capabilities represent read, internal write, and external high-impact execution.
- [x] Existing routes remain compatibility surfaces during migration.
- [ ] Existing registry ownership has been mapped for every proposed logical resource.

## Contracts

- [x] Draft OpenAPI uses version 3.1.
- [x] Subject, action, resource, and context are explicit.
- [x] Errors use stable machine-readable codes.
- [x] Mutable list resources use cursor pagination.
- [ ] Root OpenAPI and generated client artifacts have been updated after implementation.

## Behavior

- [x] Active approval-gated grants remain active.
- [x] Ambiguous adapter selection fails closed.
- [x] Stale approvals and envelopes cannot be reused.
- [x] Shadow mode performs no provider mutation.
- [ ] Acceptance tests demonstrate all required behavior.

## Delivery

- [x] Delivery mode is `multi_pr`.
- [ ] Implementation PR evidence is recorded.
- [ ] Migration authorization and ledger evidence are recorded where applicable.
- [ ] Production verification and post-merge audit are complete.
