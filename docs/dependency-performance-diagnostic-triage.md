# Dependency Performance Diagnostic Triage

This triage records the IDE/npmx dependency replacement diagnostics for
`http-generic-api/package.json`.

## Resolved

`js-yaml`

Status: replaced.

The repo already depended on `yaml`, and all current `js-yaml` usages were
limited to OpenAPI/scripts/tests. Those imports now use `yaml` directly, and
`js-yaml` was removed from `package.json` and `package-lock.json`.

## Deferred

`express`

Status: deferred.

Express is the API framework for `server.js`, route mounting, request body
handling, test harnesses, and dozens of route modules. Replacing it with a
faster framework is a platform migration, not a package cleanup. A safe
replacement requires:

- route compatibility audit;
- middleware/body-parser compatibility;
- auth and tenant guard parity tests;
- OpenAPI route coverage parity;
- deployment smoke on the target runtime.

`jsonwebtoken`

Status: deferred.

`jsonwebtoken` is used across auth issuance, OAuth exchange, tenant/user JWT
guards, local manager device tokens, and smoke tests. A safe replacement must
preserve signing, verification, expiry, JWT ID, and failure semantics across all
tenant and admin flows. A direct swap is not safe without an auth contract test
matrix and a compatibility wrapper.

## Current Policy

Treat performance replacement diagnostics as advisory unless they also carry a
security vulnerability, runtime failure, or measurable bottleneck. Small
dependency removals are allowed when usage is narrow and tests cover the
behavior. Framework/auth-library changes require a separate migration plan and
acceptance tests.
