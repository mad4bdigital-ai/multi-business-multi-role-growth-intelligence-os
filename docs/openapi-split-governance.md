# OpenAPI surface generation governance

## Authority

`http-generic-api/openapi.yaml` is the canonical fixed HTTP contract. `canonicals/openapi/custom-gpt-surfaces.yaml` is the canonical distribution registry for fixed Custom GPT surfaces. Generated OpenAPI files are artifacts and must never become source authority.

The surface registry owns:

- output filename;
- public server URL;
- authentication profile;
- fixed-operation selector;
- warning and hard operation budgets;
- Activation Gateway policy membership.

The MySQL registries remain authoritative for dynamic MCP-like tool identities, input/output schema versions, principal visibility, action and endpoint bindings, credentials, approvals, execution policy, and readback policy. Git surface membership must not activate a dynamic tool.

## Generated surfaces

| Surface | Generated artifact | Public server |
|---|---|---|
| Admin Core | `http-generic-api/openapi.custom-gpt.auth-dispatcher.yaml` | `https://auth.mad4b.com` |
| Activation Admin | `http-generic-api/openapi.custom-gpt.activation-admin.yaml` | `https://activation.mad4b.com` |
| Tenant Core | `http-generic-api/openapi.tenant-gpt.auth.yaml` | `https://auth.mad4b.com` |
| Tenant Activation | `http-generic-api/openapi.tenant-gpt.activation.yaml` | `https://activation.mad4b.com` |
| Local Connector Admin | `http-generic-api/openapi.gpt-action.local-connector.yaml` | `https://connector.mad4b.com` |

The Local Connector artifact is copied from `canonicals/openapi/local-connector.openapi.yaml`; it is not derived from the main auth-host contract and must not be exposed directly to tenant GPTs.

## Tenant aliases

Tenant aliases remain declared beside their source operations with `x-tenant-gpt-operationId`. Alias uniqueness is validated before generation. Fixed membership is selected only by `custom-gpt-surfaces.yaml`; the removed `x-tenant-gpt-auth.tenant_operation_ids` list must not be recreated.

Examples:

- `listTools` maps only to `GET /system/tools`;
- `callTool` maps only to `POST /system/tools/call`;
- `activateSession` maps only to `GET /tenant/activation/session-context`;
- Admin `/gpt/tools` operations never carry tenant aliases.

## Dynamic MCP facade

Admin and tenant Core schemas expose stable list/call envelopes. The returned tool catalog is principal-filtered from SQL. `callTool` and `callAdminTool` must re-resolve the current registry row and all authority bindings at execution time. Client-supplied provider URLs, action keys, tenant IDs, user IDs, credential modes, or descriptions are not authority.

Virtual tools such as `growth_intelligence_pilot_run` remain catalog-backed behind the stable dispatcher. They do not receive dedicated public OpenAPI paths.

## Activation Gateway

The two Activation schemas generate `edge/activation-gateway/generated/route-policy.json`. The Gateway may enforce host, path, method, documented query fields, bounded headers, request/response size, timeout, redirect, signed-policy freshness, and secret-safe observability. It must not connect to MySQL, resolve membership, decrypt credentials, select providers, or make final business authorization decisions.

Admin and tenant Activation session paths are intentionally distinct:

- Admin: `GET /activation/session-context`;
- Tenant: `GET /tenant/activation/session-context`.

The tenant path derives tenant and user identity from the signed OAuth JWT and rejects client-provided identity fields.

## Generation and CI

Run from `http-generic-api/`:

```bash
npm run schemas:generate
npm run schemas:guard
```

Generation occurs in a temporary directory. All request, response, component, array, and local-reference schemas are recursively validated before committed artifacts are written. CI fails on artifact drift, unresolved references, empty schemas, operation-budget violations, host/surface mismatch, duplicate aliases, or Gateway-policy drift.

Schema changes are review-required and are never auto-merged by the OpenAPI synchronization workflow.
