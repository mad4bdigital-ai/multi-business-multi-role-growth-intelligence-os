# OpenAPI split schema governance

## Rule

`http-generic-api/openapi.yaml` is the source of truth for split Custom GPT schemas.

The governed `POST /connect/device-install` contract is consequential and must remain additive: `device_id` stays the only universally required field, while `install_intent`, `typed_confirmation`, and `reprovision` are state-dependent inputs enforced at runtime. The canonical response documents signed installer delivery and `secrets_included=false`; split schemas must not reintroduce raw installer bodies, connector secrets, tunnel tokens, or omit the structured `404/409` error classes.

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
