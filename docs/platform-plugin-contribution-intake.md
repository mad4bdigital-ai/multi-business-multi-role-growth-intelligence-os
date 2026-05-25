# Platform Plugin contribution intake

This document provides CI guard coverage for the Platform Plugin contribution intake runtime surface.

## Summary

Platform Plugin contribution intake lets tenants and users create scoped plugin drafts without modifying the Platform Base. Drafts are stored in `platform_plugin_contributions` and must pass later validation/certification before promotion or runtime execution.

## Runtime surfaces

- `POST /platform/plugins/contributions`
- `GET /platform/plugins/contributions`
- `GET /platform/plugins/contributions/{contribution_id}`

## Registry tools

- `platform_plugin_contribution_create`
- `platform_plugin_contribution_list`
- `platform_plugin_contribution_get`

## Guardrails

- No secrets are accepted or returned.
- Existing `app_integrations` rows remain the immutable Platform Base.
- Tenant/user drafts are scoped by owner fields.
- Draft creation writes `execution_log` evidence.
- Contributions do not execute plugin actions.
- Contributions do not grant agent skills.
- Contributions do not store credentials.

## Promotion boundary

A contribution can be private to a tenant/user, submitted as a marketplace candidate, or submitted as a Platform Base candidate. Promotion is intentionally not part of this intake surface; it requires a separate certification and approval step.
