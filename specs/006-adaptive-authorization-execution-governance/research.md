# Research and Trade-off Record

## Evaluated models

### RBAC

Useful for broad administrative roles but insufficient by itself for brand ownership, delegated agents, workspace containment, dynamic risk, and operation-specific constraints.

### Relationship-based access control

Best suited to membership, ownership, delegation, supervision, and nested resource authority. Requires revision-aware decisions to avoid stale relationship authorization.

### Attribute-based access control

Best suited to runtime context such as risk, operation class, time, environment, connection readiness, and service mode. Must be typed and bounded to avoid an opaque policy language.

### Capability-style delegation

Useful for short-lived, attenuated execution authority. A database `capability_key` is not itself a security capability. Delegation artifacts must be server-validated, scoped, expiring, replay-resistant, and bound to request evidence.

### Central policy decision point

Provides consistency and explainability. It must remain side-effect-free and highly available. Enforcement cannot be delegated solely to an upstream route; every executor must revalidate or use a shared enforcement kernel.

### Reconciliation controllers

Necessary because grants, relationships, policies, adapters, credentials, connections, and external resources change after initial resolution. Controllers should be narrow and idempotent rather than one global reconciler.

## Policy representation decision

Do not invent an unrestricted JSON policy DSL. Store policy metadata and references in SQL, and evaluate typed policies through a governed engine. A small declarative condition format may be used only when its grammar, types, precedence, deny semantics, and test tooling are explicitly bounded.

## Consistency decision

Every decision records relationship revision, policy bundle version, capability and adapter versions, resource authority revision where available, normalized request hash, and expiry. Mutation dispatch must reject a stale decision.

## Availability decision

Read-only decisions may use bounded cached material when policy permits and revision evidence is present. State-changing operations require same-cycle authority validation.

## Rollout decision

Use additive schema, shadow decisions, mismatch classification, pilot capabilities, canary enforcement, compatibility aliases, and measured deprecation.
