# Tenant GPT Effective Capability Envelope

This Spec Kit defines the Tenant conversation-orchestration layer that converts natural-language requests into verified, resource-scoped, capability-bound operations.

It composes existing platform authorities rather than replacing them:

- `007-dynamic-capability-governance` remains capability identity, projection, certification, and enforcement authority.
- `009-platform-request-execution-hardening` remains operation lifecycle, approval, idempotency, execution, resume, and readback authority.
- Resource context, Business Activity, connection, role, and provider registries remain their existing authorities.

## Source incident

- Ticket: `0314ec00-6ca0-4f4d-af4a-7532f85c4a7c`
- Pilot brand key: `allroyalegypt_wp`
- The typo `allroyallegypt_wp` is untrusted and must not silently inherit authority.

## Core invariant

```text
Questionnaire option != Capability != Tool != Action
```

A questionnaire option narrows intent. It becomes executable only after the platform proves the exact resource, connection, capability, schema, readiness, authority, policy, approval, and readback path.

## Delivery posture

This branch is specification-only. It performs no provider write, invitation, publish, campaign activation, device action, migration apply, merge, or deployment.
