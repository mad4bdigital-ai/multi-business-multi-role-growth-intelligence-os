# OpenAPI Lint and Compatibility Policy

## Purpose

Feature 006 uses a checked-in OpenAPI 3.1 contract and a reviewed compatibility baseline. The guard prevents accidental contract drift and protects existing clients without introducing a new dependency.

## Commands

Run the guard from `http-generic-api`:

```bash
npm run openapi:lint:compat
npm run test:openapi:lint:compat
```

Both commands are included in `npm run schemas:guard`.

## Lint rules

The linter requires:

- OpenAPI `3.1.x`
- `info.title`, `info.version`, `paths`, top-level security, and security schemes
- a unique syntactically valid `operationId`, summary, tags, and explicit `2xx` response for every operation
- JSON request bodies
- declared path parameters with `required: true`
- resolvable internal `$ref` values
- every `required` name to exist in the same schema's `properties`

## Compatibility baseline

The baseline records the existing Feature 006 contract for:

- HTTP method, path, and `operationId`
- required parameters
- request-body requirement and required request properties
- success response status codes, schema references, and required response properties
- required properties, known properties, property types, and enum values for the reviewed component schemas

The guard rejects removal or incompatible modification of baseline behavior. Additive operations, optional properties, extra success responses, descriptions, examples, and new enum values remain allowed.

## Updating the baseline

A baseline update is never an automatic response to a CI failure. First review the contract change and its existing-client impact. For an approved update, run:

```bash
cd http-generic-api

node scripts/openapi-lint-and-compatibility.mjs \
  --write-baseline \
  --confirm=UPDATE_OPENAPI_COMPATIBILITY_BASELINE
```

The contract must pass lint before the baseline can be written. Review the resulting diff manually. Breaking changes require an explicit migration or deprecation plan; do not update the baseline only to silence CI.

## Scope

This guard changes CI and contract verification only. It performs no provider call, database migration, external send, live execution, canary activation, route removal, or enforcement cutover.
