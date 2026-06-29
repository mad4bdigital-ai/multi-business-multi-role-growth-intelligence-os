# Research and Trade-off Record

## Evaluated models

RBAC is useful for broad administrative roles but insufficient by itself for delegated agents, workspace containment, dynamic risk, and resource-specific constraints.

Relationship-based access control fits membership, ownership, delegation, supervision, and nested resources. Decisions need revision evidence to avoid stale authorization.

Attribute-based access control fits risk, operation class, time, environment, connection readiness, and service mode. Policies must be typed and bounded.

Capability-style delegation is useful for short-lived attenuated execution authority, but a database `capability_key` is not itself a security capability. Delegation artifacts must be server-validated, scoped, expiring, replay-resistant, and request-bound.

A central policy decision point improves consistency but must remain side-effect-free. Every executor still needs an enforcement point or shared enforcement kernel.

Reconciliation controllers are required because authority, connections, adapters, and resources change after initial resolution. Controllers should be narrow and idempotent.

## Policy representation

Do not invent an unrestricted JSON policy DSL. Store policy metadata and references in SQL and evaluate typed policies through a governed engine. A declarative subset is acceptable only with explicit grammar, types, precedence, deny semantics, validation, and tests.

## Consistency

Every decision records relationship revision, policy bundle version, capability version, adapter version, resource authority revision where available, normalized request hash, and expiry. Mutation dispatch rejects stale decisions.

## Availability and rollout

Read-only decisions may use bounded cached evidence when policy permits. State-changing operations require same-cycle authority validation. Rollout uses additive schema, shadow decisions, mismatch classification, representative pilots, canary enforcement, compatibility aliases, and measured deprecation.
