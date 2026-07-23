# Implementation PR-1 Inventory: Tenant Activation Contracts and Persistence

## Scope

This is a read-only implementation baseline for Spec 012. It does not activate routes, change OAuth credentials, alter SQL, call providers, deploy, or migrate data. Machine-readable authority for this PR is `pr-1-inventory.json`.

## Contract surface

The served Tenant Activation contract is `http-generic-api/openapi/openapi.tenant-gpt.activation.yaml`: OpenAPI 3.1, server `https://activation.mad4b.com`, OAuth scheme `userBearerAuth`, protected resource `https://activation.mad4b.com`.

The public schema currently declares 15 tenant operations. Three OAuth handoffs are admitted through `activationHostGatewayRoutes.js` and executed by `authRoutes.js`.

Rows synchronized into `endpoints` are `inventory_only`, `pending_governance_review`, and not runtime-callable authority. Runtime behavior is owned by the gateway, route handlers, application services, SQL repositories, and authorization middleware listed in the JSON inventory.

## Bootstrap and provider-validation authority

`GET /activation/bootstrap-config` in `activationRoutes.js` resolves `resolveActivationBootstrapConfig()` and is the authoritative backend-runtime/DB bootstrap read. `sheets_required` is false.

The governed Admin system tool `activation_provider_bootstrap_validate` performs same-cycle Drive, DB bootstrap-config, and GitHub validation. Targeted recovery surfaces are `activation_drive_probe`, `activation_bootstrap_config_read`, and `activation_github_validate`.

`activation_sheets_bootstrap_read` is a deprecated compatibility alias for the DB bootstrap read. It must not call Google Sheets. Health/status/count endpoints are diagnostics and do not replace the bootstrap-config plus provider-validation evidence pair.

## Route ownership

| Surface | Route authority | Service authority |
|---|---|---|
| OAuth handoff | `activationHostGatewayRoutes.js` → `authRoutes.js` | Tenant OAuth resource/profile and token services |
| Session context and list | `tenantActivationOverlayRoutes.js` | Activation context, lifecycle, dashboard, and tenant/user-scoped session-list handling |
| Session turn archive | `gptSessionRoutes.js` | Bounded turn batching, tenant/user session ownership, and per-turn readback |
| Awareness/detail/attention | `activationAwarenessRoutes.js` | Awareness and operational alert services |
| Resolution cases | `activationAwarenessRoutes.js` | Projection, case, lifecycle, diagnostic services |
| Task-source repair | `activationAwarenessRoutes.js` | Preview, apply, verification, capability, approval, readback services |

Tenant operations are protected by `requireActivationTenantGptAccessToken` at the Activation host and a tenant JWT/membership guard in the route layer.

## Public versus discovered operations

The Tenant Activation schema is the public exposure list. Runtime and parent endpoint inventory also contain guidance, session-list/turn, run-archive, and skill-approval routes not declared in this schema. They remain separately inventoried and are not silently treated as public operations.

Current naming alias:

- public OpenAPI operation ID: `activateSession`
- endpoint inventory operation ID: `getTenantActivationSessionContext`

PR-1 records the alias and does not rename either surface.

## Physical mapping

### Reuse

- `tenant_gpt_oauth_authorization_codes`
- `tenant_resolution_cases`, `tenant_resolution_case_events`, `tenant_resolution_readbacks`
- `operational_alerts` and lifecycle events
- `runtime_verification_runs`, evidence chunks, parity status

### Reuse with additive projection

`workflow_runs`, `step_runs`, and `operation_run_ownership` provide execution identity, tenancy, status, current step, and timestamps. `activation_runs` and `activation_snapshot_ledger` provide the current Activation projection.

They do not yet satisfy the full ADR-001 contract for operation fingerprint, idempotency hash, protected resource, OAuth client, purpose, activation mode, and optimistic version.

### Proposed later additive tables

- `activation_stage_attempts`
- `activation_evidence_items`
- `activation_deliveries`
- `activation_acknowledgements`
- `activation_reconciliation_attempts`
- `tenant_resolution_operation_policies`

No table is created by PR-1.

## Known gaps

1. T010 must designate the canonical generation source for the served artifact before contract edits.
2. Registry endpoint rows are discovery metadata, not execution authority.
3. ADR-004 Resolution scopes and dynamic operation policies are not active; the current schema uses the broad five-scope catalog.
4. Session-context public and registry operation IDs differ.
5. `activationAwarenessRoutes.js` contains an `x-tenant-id` fallback when a verified payload lacks `tenant_id`; later centralized-auth hardening must review it.
6. Existing general workflow tables require additive Activation fields/projections to satisfy ADR-001.

## CI policy

`test-tenant-activation-contract-inventory-parity.mjs` is offline and deterministic. It checks exact public method/path/operation ID parity, OAuth security, consequential flags, route literals, gateway groups, OAuth handoffs, inventory-only registry classification, physical mappings, and the no-provider-write boundary.

A future route or contract change must update this inventory in the same PR or CI fails.
