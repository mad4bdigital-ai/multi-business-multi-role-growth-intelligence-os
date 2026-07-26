# Adaptive Authorization and Execution Governance

This Spec Kit defines a long-lived authorization, approval, execution, and reconciliation architecture for the Growth Intelligence Platform.

It replaces route-specific security decisions with a governed model built from canonical capabilities, relationship authority, contextual policy, explicit grants, scoped approvals, distributed enforcement, adapter execution, evidence, and reconciliation.

The specification is design-only. It does not activate provider writes, alter production authorization, or deprecate existing routes.

## Documents

- `spec.md` — functional and safety requirements.
- `adr-001-hybrid-authorization-architecture.md` — architectural decision.
- `research.md` — alternatives and trade-offs.
- `data-model.md` — target logical model.
- `plan.md` — phased implementation and rollout.
- `tasks.md` — implementation backlog.
- `contracts/authorization-execution.openapi.yaml` — proposed OpenAPI 3.1 contract.
- `checklists/requirements.md` and `checklists/security.md` — acceptance gates.
- `completion.json` — machine-readable completion state.

## Delivery model

`multi_pr` is mandatory because later phases require additive migrations, shadow parity evidence, staged rollout, production verification, and post-merge audit.
