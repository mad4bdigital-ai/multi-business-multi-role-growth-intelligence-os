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

Tenant operation aliases must be unique in the canonical source. In particular:

- `listTools` is declared only on `GET /system/tools`
- `callTool` is declared only on `POST /system/tools/call`
- `GET /gpt/tools` and `POST /gpt/tools/call` remain admin dispatcher operations and must not carry tenant aliases

## Admin virtual tools

Virtual Admin tools such as `growth_intelligence_pilot_run` are exposed through the existing `POST /gpt/tools/call` dispatcher and do not add independent split-schema paths. Their tool name, description, and input schema come from the Admin tool catalog at runtime. Changes must update the canonical `http-generic-api/openapi.yaml` dispatcher description, keep the generated auth-dispatcher operation stable, and preserve `callAdminTool` request/response compatibility. The split generator must not create a dedicated public endpoint for a virtual tool.

## Enforcement

The DB execution policy is:

- `policy_group = schema_governance`
- `policy_key = split_openapi_must_derive_from_main_openapi`
- `blocking = TRUE`

CI enforcement is implemented by:

- `http-generic-api/scripts/split-openapi.mjs`
- `http-generic-api/test-openapi-split-governance.mjs`
- source-declared tenant aliases through `x-tenant-gpt-operationId` in `http-generic-api/openapi.yaml`
- duplicate tenant alias rejection in `split-openapi.mjs`

## Failure class

Any split-only endpoint or operation, or duplicate split alias key inside a source operation, is classified as `degraded_contract` and must block schema/runtime contract changes.
