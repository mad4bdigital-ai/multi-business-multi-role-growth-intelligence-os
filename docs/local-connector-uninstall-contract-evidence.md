# Local Connector Uninstall Contract Evidence

This note records the bounded evidence owned by PR #3432 for `DELETE /local-connector/uninstall`.

## Runtime truth

- Runtime route: `routes/localConnectorInstallRoutes.js`
- Runtime guard: `requireBackendApiKey`
- Accepted authentication alternatives: backend bearer or `x-api-key`; user JWT/API credential resolution remains handled by the shared backend guard.
- Admin and service calls require `user_id` and `tenant_id` together.
- Successful uninstall disables the device configuration and clears stored connector credentials.
- Responses do not include secrets.

## Canonical contract

- Canonical OpenAPI source: `openapi/local-connector-uninstall.yaml`
- Security alternatives: `backendBearerAuth` OR `backendApiKeyAuth`
- Request body requires `device_id` and models paired `user_id`/`tenant_id` dependencies.
- The error envelope requires an error code while allowing the runtime code-only `404 config_not_found` response.

## Regression ownership

- Focused test: `test-local-connector-uninstall-rotates-secrets.mjs`
- The test owns the frontend-surface operation claim, runtime guard discovery, alias fail-closed behavior, canonical OpenAPI parity, credential clearing, and secret-free responses.

## Generated evidence

The trusted PR Generated Artifact Refresh workflow regenerates:

- `frontend-surface-dispatch.generated.json`
- `openapi/frontend-runtime-routes.generated.yaml`

Expected readback for the operation:

- runtime authentication state: resolved
- runtime profile: `backend_or_user`
- OpenAPI contract level: canonical
- authentication parity: equivalent
- test ownership: present
- secrets included: false
