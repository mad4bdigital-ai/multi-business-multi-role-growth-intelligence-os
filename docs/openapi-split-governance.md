# OpenAPI split schema governance

## Rule

`http-generic-api/openapi.yaml` is the source of truth for split Custom GPT schemas.

Split schemas such as:

- `http-generic-api/openapi.tenant-gpt.auth.yaml`
- `http-generic-api/openapi.custom-gpt.auth-dispatcher.yaml`

must be generated from operations that already exist in `openapi.yaml`.

## Tenant GPT split

Tenant GPT operations are selected from `x-tenant-gpt-auth.tenant_operation_ids` in `openapi.yaml`.

The split generator must not treat `openapi.tenant-gpt.auth.yaml` as an independent source of paths, operations, security scopes, or component dependencies.

## Enforcement

The DB execution policy is:

- `policy_group = schema_governance`
- `policy_key = split_openapi_must_derive_from_main_openapi`
- `blocking = TRUE`

CI enforcement is implemented by:

- `http-generic-api/scripts/split-openapi.mjs`
- `http-generic-api/test-openapi-split-governance.mjs`

## Failure class

Any split-only endpoint or operation is classified as `degraded_contract` and must block schema/runtime contract changes.
