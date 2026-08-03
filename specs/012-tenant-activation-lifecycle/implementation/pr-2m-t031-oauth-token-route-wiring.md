# PR-2M — T031 OAuth token-route wiring

## Scope

This slice wires the governed T031 authorization-code consumption and ambiguity policy into the exact Tenant GPT endpoint:

`POST /auth/oauth/token`

The route is mounted through `tenantGptOAuthMetadataRoutes.js`, which is registered before the legacy `/auth` router. The new handler owns only the exact token path; all other authentication routes remain with the existing implementation.

This slice does **not** close T031. Repository wiring and route-level tests are provided, but Production deployment and live exchange/readback evidence are not part of this delivery.

## Pre-consumption ordering

The route completes all deterministic and database-backed eligibility work before the single-use code transition:

1. validate the OAuth grant and client credentials;
2. resolve the registered host and protected resource;
3. verify the authorization-code signature and required claims;
4. validate client, resource, and callback bindings;
5. read the active user;
6. read an active membership joined to an active tenant;
7. prepare the access-token claims and signature in memory;
8. execute the atomic authorization-code consumption gate.

An inactive user or tenant membership therefore cannot consume a valid code.

## Outcome handling

The route uses the centralized T031 policy rather than collapsing every failure into `invalid_grant`:

- verified invalid, expired, revoked, reused, or mismatched codes return `400 invalid_grant` and require a new authorization;
- dependency failure before code consumption returns `503 temporarily_unavailable` and permits the same code to retry;
- a store failure with authoritative `issued` readback returns `503` and permits bounded same-code retry;
- an unknown consumption outcome returns `503`, forbids replay, and requires reconciliation;
- any unexpected failure after consumption returns `503`, forbids replay, and requires reconciliation;
- a response interruption after headers are sent is recorded as an unknown transport outcome rather than misreported as an invalid code.

Every response includes bounded decision metadata, `Cache-Control: no-store`, `Pragma: no-cache`, and an `x-request-id`. Cookies are removed at the route boundary.

## Diagnostics

The route writes bounded diagnostic evidence to `execution_log` on a best-effort basis. The evidence contains only booleans, classifications, safe URL host/path evidence, hash prefixes, request identity, and outcome flags. It does not contain the raw authorization code, access token, client secret, authorization header, cookie, or user email.

Diagnostic write failure does not change the OAuth response.

## Route-level test coverage

The deterministic HTTP tests cover:

- exact metadata-router interception before the legacy handler;
- success ordering and response headers;
- replay rejection;
- unknown consumption and issued-readback store failures;
- inactive user and inactive membership before consumption;
- pre-consumption dependency failure;
- post-consumption failure;
- two concurrent exchanges with exactly one success;
- unregistered request host rejection;
- no-secret response and diagnostic evidence.

## Completion boundary

T031 remains open until all of the following are complete:

1. exact-head CI and the route regressions pass;
2. the reviewed merge SHA is deployed through the governed release path;
3. a live successful exchange is read back on that deployed SHA;
4. a live replay proves no second token is issued;
5. ambiguous store and post-consumption outcomes return the stable reconciliation metadata;
6. bounded `execution_log` evidence is read back without secrets;
7. runtime evidence confirms that the legacy token handler is not reached.

## Non-effects

No Production request, deployment, SQL Apply, migration, database mutation during delivery, credential access, provider call, external send, or force push occurred. No secrets are included.
