# Automation Intelligence Guard Runbook

## Purpose

The Automation Intelligence Guard is a fail-fast repository and runtime contract that prevents unsafe tenant automation changes from reaching merge or deployment.

It protects four high-risk areas:

1. tenant discovery or direct dispatch of privileged runtime tools;
2. mutating tenant tools without explicit registry governance metadata;
3. implicit or duplicate local connector provisioning and raw secret material in API responses;
4. partial integration-policy writes that report an error after state has already changed.

## Runtime authority

The guard does not invent action keys or permissions. Runtime decisions are resolved from the existing registries:

- `tenant_platform_endpoint_tools` for tenant tool method, path, tags, and schema;
- `platform_endpoint_tool_exports` for exported system-layer tools;
- `endpoints` for method, execution mode, request-envelope requirements, actor roles, and governance levels;
- `capability_resolution_envelope_ledger` for approval-backed repository mutations;
- `tenant_integration_policies` for managed or dedicated integration source policy;
- `local_connector_user_configs` for active device identity and reuse decisions.

## Tenant mutation policy

### Tenant tool registry

`evaluateTenantToolVisibility()` applies the same decision in discovery and dispatch.

A tool is blocked when any of these conditions is true:

- its path is an admin-only or connector-workaround path;
- its tool key matches a high-risk direct mutation pattern such as repository patching, GitHub content writes, or unrestricted local shell/file access;
- its registry tags include a deny marker such as `admin_only`, `raw_secrets`, `direct_provider_write`, or `force_push`;
- it uses `POST`, `PUT`, `PATCH`, or `DELETE` without at least one explicit tenant governance tag.

Read-only methods remain available unless another deny rule applies. Mutating methods are allowed only when their registry row contains an explicit governance tag such as `tenant_safe`, `state_changing`, `mode_governed`, `approval_required`, `preflight`, `read_only`, or `no_provider_write`.

A validated `admin_scope_grant` preserves the existing audited grant path and bypasses ordinary tenant visibility filtering only for the granted tool.

Stable rejection code:

- `tenant_tool_route_not_allowed`

The error details include `policy_reason`, evaluated tags, method, path, and `secrets_included=false`.

### Platform endpoint exports

`evaluateTenantPlatformEndpointExport()` reads `scope_class`, `auth_policy_json`, `execution_policy_json`, `import_policy_json`, endpoint method, execution mode, request-envelope requirements, and actor roles.

A mutating export is allowed for a tenant only when both conditions are true:

1. tenant access is explicitly authorized by scope or policy metadata;
2. a governance gate is required, such as a capability envelope, approval, preflight, dry run, or governed execution mode.

Dangerous policy tokens such as `unrestricted_write`, `direct_provider_write`, `raw_secret_return`, `force_push`, and `freeform_command` fail closed.

Stable rejection code:

- `tenant_platform_endpoint_mutation_not_allowed`

## Local connector provisioning

`POST /connect/device-install` follows these rules:

- the first device can be provisioned with only a valid `device_id`;
- adding or replacing another active device requires `install_intent=add|replace` and a typed confirmation;
- reinstalling requires `reprovision=true`, `install_intent=reinstall`, and the same typed confirmation;
- the typed value is `INSTALL_DEVICE_<NORMALIZED_DEVICE_ID>`;
- an existing device without reprovisioning is reused before provider credentials are loaded and before Cloudflare or Hostinger calls;
- JSON responses never include connector secrets, Cloudflare tokens, `.env` contents, or installer script bodies;
- installer delivery uses a short-lived signed download link.

Important status codes:

- `400` invalid request or device identifier;
- `403` missing tenant membership or authorization;
- `404` tenant or reinstall target not found;
- `409` explicit intent or typed confirmation required;
- `500` unexpected provisioning or persistence failure.

Stable state and confirmation errors include:

- `existing_device_registered`
- `reinstall_intent_required`
- `reinstall_device_not_found`
- `device_install_confirmation_required`

## Integration policy transaction contract

`upsertTenantIntegrationPolicies()` validates all app modes before any database write. All writes execute inside one transaction when the pool supports transactions.

On failure:

- the transaction is rolled back;
- no commit occurs;
- the error code is `integration_policy_transaction_failed` unless validation failed first;
- details include the original error code, attempted rows, rows reached before failure, rollback evidence, `committed=false`, and `secrets_included=false`.

A readiness readback failure after commit is returned as `integration_policy_readiness_unavailable`; it must not convert a successful mutation into a false mutation failure.

## Repository guard and CI

The offline guard is:

```text
http-generic-api/scripts/automation-intelligence-guard.mjs
```

It performs static contract checks only. It must not read provider credentials, call external providers, or mutate state.

The CI workflow runs it as a fail-fast syntax-stage step. The test manifest also runs:

- `test-automation-intelligence-guard.mjs`
- `test-tenant-mutation-policy-evaluator.mjs`
- `test-tenant-tool-surface-guard.mjs`
- `test-integration-policy-transaction-guard.mjs`
- `test-local-connector-provisioning-safety.mjs`

## Operator verification

From `http-generic-api`:

```bash
node scripts/automation-intelligence-guard.mjs
node test-tenant-mutation-policy-evaluator.mjs
node test-integration-policy-transaction-guard.mjs
node test-local-connector-provisioning-safety.mjs
node test-tenant-tool-surface-guard.mjs
node test-automation-intelligence-guard.mjs
npm test
```

Use Node 22 for release evidence. Treat local Google ADC warnings as environment diagnostics only when the executed tests do not require provider access.

## Change procedure

When adding a new tenant-facing mutating tool:

1. add an explicit tenant-safe governance tag to its registry migration;
2. document its auth and side-effect policy;
3. add evaluator tests for the allowed and denied variants;
4. update OpenAPI when the request, response, or error contract changes;
5. run the offline guard and full manifest;
6. reconcile the branch with `main` and run release readiness before opening or merging the PR.

Never bypass the guard by weakening high-risk name patterns, returning raw secret material, silently defaulting a mutating tool to allowed, or converting a structured `400/404/409` into `500`.

## Rollback

Code rollback is a normal Git revert of the relevant commits. Migration `1003_sprint69_tenant_device_install_intent_contract.sql` is additive and updates only the tenant tool contract row. If it must be reversed, restore the prior `description`, `input_schema`, and tags through a new governed migration; do not edit production registry rows manually.
