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

Virtual Admin tools such as `growth_intelligence_pilot_run` are exposed through the existing `POST /gpt/tools/call` dispatcher and do not add independent split-schema paths. Their tool name, description, and input schema come from the Admin tool catalog at runtime. Changes must update the canonical `http-generic-api/openapi.yaml` dispatcher description, keep the generated auth-dispatcher operation stable, and preserve `callAdminTool` request/response compatibility. The split generator must not create a dedicated public endpoint for a virtual tool. Growth Intelligence insight/action decisions, readiness refresh, and V5 plan-bound approval-hold operations remain catalog-backed virtual tools behind the stable dispatcher; their schemas must preserve no-execution/no-provider-write boundaries and typed-confirmation requirements.

## Auth lifecycle and provider action parity

The canonical dispatcher descriptions in `openapi.yaml` must remain aligned with runtime action selection and passive credential behavior.

- `POST /system/tools/call` and `POST /admin/system/tools/call` remain stable dispatcher operations; provider probes do not add split-only routes.
- `activation_drive_probe` must resolve the SQL-authoritative `google_drive_api` action and scope contract explicitly. It must not inherit a Sheets action or an actionless client default.
- Split schemas may expose the dispatcher operation, but they must not duplicate provider action keys, credential scope rules, or token-cache behavior as an independent authority.
- Preview, dry-run, and preflight descriptions must not imply a provider call or credential materialization when the runtime returns no-secret evidence.
- Any split schema regeneration must preserve operation IDs, security schemes, and request compatibility after canonical auth-lifecycle documentation changes.

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
