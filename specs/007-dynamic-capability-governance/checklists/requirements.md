# Dynamic Capability Governance Requirements Checklist

## Specification completeness

- [x] Problem, scope, non-goals, and terminology are defined.
- [x] Canonical capability and alias rules are defined.
- [x] Inventory sources cover tools, actions, endpoints, routes, workflows, engines, connectors, and capability registries.
- [x] Effect/risk classification and conservative defaults are defined.
- [x] Requirement compilation is defined.
- [x] Admin and Tenant projection rules are separate.
- [x] Shared enforcement, adapter, certification, readback, and reconciliation are defined.
- [x] Resource coverage matrix is included.
- [x] OpenAPI 3.1 draft contracts are included.
- [x] Migration, compatibility, rollout, testing, threat, and operational models are included.

## Implementation requirements

- [ ] Live census and physical schema naming are reviewed before migration design.
- [ ] No competing canonical capability table is introduced.
- [ ] Every source family has a bounded collector and completeness state.
- [ ] Every active surface maps to a capability or typed gap.
- [ ] Surface overrides cannot weaken canonical requirements.
- [ ] Tenant projections use server-derived identity and bounded schemas.
- [ ] State-changing capabilities require explicit compiled policy.
- [ ] Adapter selection is deterministic and certification-gated.
- [ ] Required readback contracts are current before dispatch.
- [ ] Capability debt and operational alerts share typed fingerprints.
- [ ] Existing route compatibility is tested during shadow rollout.

## Delivery governance

- [x] `completion.json` exists and selects `multi_pr`.
- [x] The specification PR has no runtime or provider mutation.
- [ ] Implementation PRs and merge SHAs are recorded.
- [ ] Required migrations are applied through the governed runner with readback.
- [ ] Production parity and post-merge audit are recorded.
- [ ] No unresolved item remains before status becomes complete.
