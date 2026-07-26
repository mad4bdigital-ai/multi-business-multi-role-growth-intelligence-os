# Dynamic Container Authority Foundation

## Status

Schema and domain foundation only. This phase does not authorize runtime enforcement, provider calls, credential reads, external writes, or platform-owner bypass.

## Scope

Migration `319_sprint69_dynamic_container_authority_foundation.sql` adds SQL-primary registry and projection surfaces for:

- dynamic container types and container instances;
- multi-parent containment, read-only sharing, explicit delegation, reference, and management edges;
- closure projections and tenant authority epochs;
- dynamic classifications and merge strategies;
- composable role templates plus explicit container assignments;
- resource dimensions and no-secret resource bindings;
- structural issue and foundation readiness views.

The initial type topology is:

```text
Platform
└── Tenant
    └── Workspace
        └── Brand
            ├── Activity
            └── Workflow
```

The topology remains registry-driven. Multi-parent edges are permitted only when the child type declares `supports_multi_parent=1`. Containment cycles, cross-tenant edges, invalid parent/child type pairs, and resolution-limit exhaustion fail closed in the pure domain validator.

## Non-authority boundary

Rows created by this migration do not grant execution authority. In particular:

- classifications influence defaults or restrictions but never grant authority by themselves;
- sharing is read-only by default and never implies containment or write permission;
- delegation must be explicit and operation-scoped in later resolver phases;
- credential resource bindings contain references only, never credential values;
- `platform_owner` has no implicit override in this foundation;
- current runtime dispatch continues to use existing authorities until a separately reviewed shadow resolver is integrated and promoted.

## Deterministic primitives

`dynamicContainerAuthority.js` provides pure, side-effect-free functions for:

- relationship validation;
- multi-parent eligibility;
- bounded transitive cycle detection;
- no-secret metadata validation;
- deterministic `deny_wins`, `union`, `intersection`, `minimum`, `nearest_replace`, and `priority_replace` merges.

The functions perform no SQL writes, provider calls, credential resolution, token minting, or client construction. They are not wired into execution in this phase.

## Initial limits

```text
max depth:                  16
max paths:                 256
max visited containers:   2048
max traversed relations:  4096
max candidate bindings:   5000
```

Limit exhaustion returns `container_resolution_limit_exceeded`; it must never return a partial allow.

## Rollout

1. Apply the migration only through the governed migration runner after preflight and confirmation.
2. Verify all new tables, views, seeds, and the migration ledger in the same cycle.
3. Keep runtime enforcement disabled.
4. Implement the read-only shadow resolver in a separate PR.
5. Compare legacy and container decisions before any canary enforcement.
6. Add override requests, immutable effective-context snapshots, and one-time consumption only after the shadow resolver contract is stable.

Rollback is consumer-based: disable future readers and leave additive tables intact. Dropping tables is not part of this phase.
