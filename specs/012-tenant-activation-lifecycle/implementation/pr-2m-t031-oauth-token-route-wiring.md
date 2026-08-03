# PR-2M — T031 OAuth token-route wiring

## Scope

This slice wires the governed T031 authorization-code consumption and ambiguity policy into the exact Tenant GPT endpoint:

`POST /auth/oauth/token`

The route is mounted through `tenantGptOAuthMetadataRoutes.js`, which is registered before the legacy `/auth` router. A request-binding guard and a signed-claim verifier are mounted immediately before the token handler. This surface owns only the exact token path; all other authentication routes remain with the existing implementation.

This slice does **not** close T031. Repository wiring and the original route-level HTTP validation are complete, but the new binding-guard regression, remaining repository CI gates, Production deployment, and live exchange/readback evidence are still required.

## Mandatory binding boundary

The token request must include `redirect_uri`; omission is rejected before authorization-code verification, subject lookup, or consumption, and the response allows a corrected same-code retry.

The signed authorization code must contain all six binding claims:

- `jti`;
- `user_id`;
- `tenant_id`;
- `redirect_uri`;
- `client_id`;
- `resource`.

Missing or malformed signed bindings are rejected as a verified invalid grant before subject lookup or code consumption. The runtime verifier also fails closed as a pre-consumption dependency when `JWT_SECRET` is unavailable; it does not fall back to the development secret used by the legacy route.

## Pre-consumption ordering

The route completes all deterministic and database-backed eligibility work before the single-use code transition:

1. require the request callback binding;
2. validate the OAuth grant and client credentials;
3. resolve the registered host and protected resource;
4. verify the authorization-code signature and all mandatory signed binding claims;
5. validate client, resource, and callback equality;
6. read the active user;
7. read the exact active membership joined to an active tenant;
8. prepare the access-token claims and signature in memory;
9. execute the atomic authorization-code consumption gate.

An incomplete binding, inactive user, or inactive tenant membership therefore cannot consume a valid code.

## Outcome handling

The route uses the centralized T031 policy rather than collapsing every failure into `invalid_grant`:

- verified invalid, expired, revoked, reused, or mismatched codes return `400 invalid_grant` and require a new authorization;
- dependency failure before code consumption returns `503 temporarily_unavailable` and permits the same code to retry;
- a store failure with authoritative `issued` readback returns `503` and permits bounded same-code retry;
- an unknown consumption outcome returns `503`, forbids replay, and requires reconciliation;
- any unexpected failure after consumption returns `503`, forbids replay, and requires reconciliation;
- a response interruption after headers are sent is recorded as an unknown transport outcome rather than misreported as an invalid code.

Every response includes bounded decision metadata, `Cache-Control: no-store`, `Pragma: no-cache`, and an `x-request-id`. Cookies are removed at the route boundary.

## Response-commit evidence

A successful token exchange is not recorded merely because the route reached `res.json`. The route registers a one-shot `finish` listener before writing the token response and records `token_response_committed` only when the HTTP response finishes.

A `close` event before `writableFinished` is classified as `response_transport_interrupted` with an unknown outcome. A terminal-evidence guard prevents duplicate success/unknown records across `finish`, `close`, and exceptional response paths.

The HTTP regression proves that exactly one success record is emitted, that its phase is `response_committed`, and that no success record is emitted from an earlier phase.

## Diagnostics

The route writes bounded diagnostic evidence to `execution_log` on a best-effort basis. The evidence contains only booleans, classifications, safe URL host/path evidence, hash prefixes, request identity, and outcome flags. It does not contain the raw authorization code, access token, client secret, authorization header, cookie, or user email.

Diagnostic write failure does not change the OAuth response.

## Route-level coverage

The earlier deterministic HTTP integration and Shared Canary validation completed with API dependencies installed from the committed lockfile. Coverage includes:

- exact metadata-router interception before the legacy handler;
- success ordering, response headers, and post-`finish` evidence;
- replay rejection;
- unknown consumption and issued-readback store failures;
- inactive user and inactive membership before consumption;
- pre-consumption dependency failure;
- post-consumption failure;
- two concurrent exchanges with exactly one success;
- unregistered request host rejection;
- no-secret response and diagnostic evidence.

The new focused binding regression additionally covers missing request `redirect_uri`, every mandatory signed claim, invalid callback/resource claims, missing `JWT_SECRET`, and proof that no subject lookup or code consumption occurs on those failures. That regression remains pending on the current head until CI reaches a terminal result.

No workflow file is changed by this repair.

## Completion boundary

T031 remains open until all of the following are complete:

1. the binding-guard regression and remaining exact-head repository CI gates pass;
2. the reviewed merge SHA is deployed through the governed release path;
3. a live successful exchange is read back on that deployed SHA;
4. a live replay proves no second token is issued;
5. ambiguous store and post-consumption outcomes return the stable reconciliation metadata;
6. bounded `execution_log` evidence is read back without secrets;
7. runtime evidence confirms that the legacy token handler is not reached.

## Non-effects

No Production request, deployment, SQL Apply, migration, database mutation during delivery, credential access, provider call, external send, or force push occurred. No secrets are included.
