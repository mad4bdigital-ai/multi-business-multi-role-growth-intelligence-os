# Local Connector Reachability Contract Validation

This file is part of Lane A.

## Validation scope

- OpenAPI is 3.1.0.
- All public responses use JSON object envelopes.
- Error responses use the shared `ErrorEnvelope`.
- The stable error code registry is `local-connector-reachability.error-codes.json`.
- Examples must never include secrets, signed installer URLs, connector secrets, or raw sensitive machine identifiers.

## Required contract tests

1. Parse `local-connector-reachability.openapi.yaml` with the repository OpenAPI validator.
2. Assert every path has `operationId`, `tags`, success responses, and error responses.
3. Assert state-changing endpoints require `Idempotency-Key` where relevant.
4. Assert every response/example containing `secrets_included` sets it to `false`.
5. Assert tenant endpoints do not expose `connector.mad4b.com` as fallback authority.
6. Assert recovery action responses cannot use `verified` or `recovered` unless `same_cycle_readback_complete=true`.
7. Assert `ErrorEnvelope.error.code` is one of the stable registry values.

## Non-goals

- No runtime handler implementation.
- No migration apply.
- No route, tunnel, installer, or Cloudflare mutation.
