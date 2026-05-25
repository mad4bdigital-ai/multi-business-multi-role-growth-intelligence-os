# Platform Plugin private runtime

## Purpose

Tenant/user contributed Platform Plugins must be usable by their owner before platform-wide certification or promotion. Promotion is only required when a contribution should become part of the shared Platform Base for other users.

This private runtime layer enables owner-scoped execution eligibility without mutating `app_integrations`.

## Model

| State | Who can use it | Platform Base mutation |
|---|---|---|
| Contribution draft | Owner can edit/read | No |
| Private activation | Owner can resolve/execute within tenant/user scope | No |
| Certified/promoted | Other users can install from Platform Base | Yes, via separate admin promotion |

## Runtime surfaces

- `POST /platform/plugins/contributions/activate-private`
- `POST /platform/plugins/contributions/resolve-private`

## Guardrails

- Owner scope must match the supplied tenant/user.
- Private activation does not certify the plugin.
- Private activation does not promote the plugin.
- Private resolver does not expose secrets.
- Credential policy is enforced against requested credential scope.
- Private resolver marks `promotion_required_for_other_users: true`.

## Execution boundary

The resolver returns `execution.will_execute: true` only when owner scope, private activation, action binding, contribution status, and credential policy all allow it. Protocol-specific dispatch remains governed by adapters and credential resolvers.
