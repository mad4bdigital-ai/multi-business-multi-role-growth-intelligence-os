# Requirements Checklist

## Scope and model

- [x] Capability, grant, authorization, approval, execution, and verification states are separate.
- [x] Relationship, contextual policy, and explicit grants are separate authorities.
- [x] Pilots cover read, internal write, and external high-impact execution.
- [x] Existing routes remain compatibility surfaces during migration.
- [x] Every logical resource is mapped to an existing SQL authority, projection strategy, additive extension, or one bounded new checkpoint candidate.

## Contracts and behavior

- [x] Draft OpenAPI uses version 3.1.
- [x] Subject, action, resource, and context are explicit.
- [x] Errors use stable machine-readable codes.
- [x] Mutable lists use cursor pagination.
- [x] Active approval-gated grants remain active.
- [x] Ambiguous selection fails closed.
- [x] Stale approvals and envelopes cannot be reused.
- [x] Shadow mode performs no provider mutation.
- [x] Canonical capability and endpoint alias resolution has live schema/readiness evidence.
- [x] Bounded tenant shadow decision persistence exists in the resolver implementation.
- [x] Typed subject-action-resource-context decision input is implemented for preview and shadow compare.
- [x] Relationship, grant, capability, binding, endpoint, export and certification revision vectors are resolved and bound into the decision manifest.
- [x] Grant and contextual policy composition is exposed through the resolver output.
- [x] Obligation output and mismatch taxonomy are exposed through the resolver output.
- [ ] Root OpenAPI, generated clients, and acceptance tests are updated during later public API implementation.

## Pre-PR2 and remaining-task readiness

- [x] Security, runtime, tenant and platform terminology has one accepted glossary.
- [x] Canonical capability authority is `platform_semantic_capabilities`, not routes or tools.
- [x] Existing grants and relationships remain scoped authorities during migration.
- [x] Envelope and evidence ledgers are reused rather than duplicated.
- [x] Future additive migration scope is bounded and requires a separate reviewed PR.
- [x] PR #1976 pre-PR2 readiness is merged and its branch is deleted.
- [x] Remaining-task loop is active after explicit instruction.
- [x] Decision-plane loop T010 through T015 is complete without provider mutation, migration execution, or enforcement cutover.

## Delivery

- [x] Delivery mode is `multi_pr`.
- [x] PR1 implementation, CI, merge, ancestry and branch-cleanup evidence is recorded.
- [x] PR1 handoff evidence PR #1967 is merged.
- [x] Pre-PR2 readiness PR #1976 is merged.
- [x] T010 through T015 evidence is recorded.
- [ ] Enforcement, adapter, pilot, migration, rollout, and closeout evidence is recorded.
- [ ] Production verification and post-merge audit are complete.
