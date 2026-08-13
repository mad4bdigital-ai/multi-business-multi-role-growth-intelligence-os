# Data Model — Spec 019 Governed Database Lifecycle and Pressure Relief

## Reused Authorities

The preferred model reuses the existing platform resource and durable execution authorities. A lifecycle plan references a resource registry entry and recipe; an execution plan and mutation receipt provide durable identity and reconciliation. New tables are not required for PR-A.

## Core Entities

| Entity | Purpose | Required identity |
|---|---|---|
| Resource registry entry | Exact database table/resource identity and adapter binding | `resource_uri`, `resource_version` |
| Lifecycle recipe | Registered operation and policy metadata | `recipe_key`, `policy_version` |
| Lifecycle plan | Immutable candidate set, cutoff, estimates, limits, and preservation rules | `plan_id`, `plan_fingerprint` |
| Authority binding | Exact resource/recipe/principal scope | `authority_binding_id` |
| Typed approval | Approval bound to one plan fingerprint | `approval_id`, `plan_id`, `plan_fingerprint` |
| Execution plan | Durable dispatch and step state | `execution_plan_id` |
| Mutation receipt | Idempotency, provider/database effect identity, unknown outcome, readback reconciliation | `receipt_id`, `idempotency_key` |
| Readback evidence | Same-cycle observed result and mismatch classification | `readback_id`, `cycle_id` |

## Lifecycle Plan Fields

The canonical plan contains plan ID, exact resource URI/version, recipe key, policy version, immutable cutoff, candidate row estimate, payload and reclaim estimates, risk class, batch size, maximum batches, preservation rules, authority requirement, typed-confirmation flag, same-cycle-readback flag, and fingerprint. Any field that affects eligibility or safety participates in the fingerprint.

## Domain Adapter Metadata

Each adapter declares resource semantics, required columns/relationships, canonical ordering, preservation invariants, policy keys, maximum batch, and whether physical reclaim assessment is supported. Adapters cannot accept arbitrary SQL or caller-supplied predicates.

## Logical and Physical Results

Logical cleanup evidence records eligible rows before and after, deleted rows, logical bytes removed, preservation checks, batch durations, and receipt identifiers. Physical reclaim evidence records engine, table size, `data_free`, estimated reclaim, concurrent-writer evidence, maintenance-window requirement, and a separate execution decision. The two result types cannot be represented by one boolean success flag.

## Tenant and Principal Scope

The initial platform resource is platform-scoped and exact. If a future resource is tenant-owned, the authority binding must include exact tenant/resource ownership and must not borrow platform authority silently. No wildcard or database-wide grant is valid.

## Migration Boundary

PR-A creates no migration. Future additive migration work must first verify whether the existing durable execution receipt schema and authorization registry are present in the target environment. A source migration file is evidence of intended schema, not proof of live availability.
