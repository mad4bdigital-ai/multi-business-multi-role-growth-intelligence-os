# Resource Authority Registry Foundation

Date: 2026-05-31

## Purpose

This foundation makes resource authority a first-class registry contract before any tenant, user, brand, or external-resource write is allowed.

It is diagnose/readiness only. It does not publish, mutate external resources, apply repo patches, activate workflows, write local connector config, or return secret values.

## Core Rule

```text
Generate is not publish.
Draft is not authorization.
Admin intent is not resource authority.
```

Any write to a tenant, user, brand, or externally owned resource requires:

```text
resource resolution
ownership claim
active grant
scoped credential
policy gate
audit evidence
readback
```

## Registry Objects

Migration:

- `http-generic-api/migrations/175_sprint65_resource_authority_registry_foundation.sql`

Table:

- `platform_resource_authority_requirements`

Engine:

- `resource_authority_engine`

Policy:

- `resource_authority_policy_v1`

Skill:

- `resource_authority`

## Authority Requirements

Seeded requirement keys:

- `wordpress_post_publish_authority`
- `wordpress_draft_write_authority`
- `google_drive_file_write_authority`
- `github_repo_patch_authority`
- `n8n_workflow_activation_authority`
- `cloudflare_dns_write_authority`
- `local_connector_config_write_authority`
- `crm_contact_update_authority`
- `email_campaign_send_authority`
- `social_post_publish_authority`
- `ai_generated_asset_upload_authority`

Each requirement records:

- resource family
- operation class
- required gates
- authority source tables
- credential scope requirement
- grant requirement
- ownership claim requirement
- audit requirement
- readback requirement
- break-glass flag
- explicit `apply_allowed = 0`
- explicit `secrets_may_be_returned = 0`

## Admin Planning Tools

The migration registers read-only admin tools through existing platform engine paths:

- `resource_authority_decision_brief`
- `resource_publish_readiness_plan`
- `resource_external_write_readiness_plan`

All are tagged:

- `read_only`
- `no_execution`
- `no_apply`
- `no_secret_read`

## Apply-Readiness Integration

`platform_engine_apply_readiness_envelope_v1` now treats resource authority as a deterministic hard gate when a plan or request marks `resource_authority_required`.

If authority is required but not satisfied, the envelope returns:

- `can_apply: false`
- `blockers: ["resource_authority_required"]`
- `required_controls.resource_authority_required: true`
- `required_controls.resource_authority_satisfied: false`

This is still readiness only. The envelope does not execute, mutate repo state, publish content, or write to an external system.

## Boundaries

This foundation is not an apply executor.

Still required before any apply phase:

- runtime authority evaluator
- live grant/credential lookup
- validator gate
- approval gate
- scope guard
- audit evidence writer
- readback verifier
- tenant-safe projection tests

Tenant GPT schema remains unchanged. Tenant capability expansion continues through registry-backed `listTools` and `callTool`, not direct exposure of admin or platform-management routes.

## Verification

Static guard:

- `node http-generic-api/test-resource-authority-registry.mjs`

The guard asserts:

- authority requirements are seeded
- all required gates are present
- admin tools are read-only and no-apply
- migration is idempotent
- destructive SQL is absent
- tenant OpenAPI does not expose the resource authority engine or admin tools
