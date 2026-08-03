# Spec 012 T030 — OAuth Operation Correlation Foundation

## Status

`domain_foundation_complete_runtime_integration_required`

This phase implements the domain contract for carrying one stable Activation operation identity through the OAuth and gateway stages. It does not wire the contract into live routes, JWTs, database persistence, or Production, and therefore does not close T030.

## Problem confirmed on current main

The current OAuth implementation has useful request IDs and bounded token-exchange diagnostics, but these values are local to individual requests. The authorize, identity, code issue, token exchange, and gateway verification stages do not yet share one verified operation/correlation envelope.

The historical inventory also records `request_correlation_ref` as a gap on `tenant_gpt_oauth_authorization_codes`. Runtime persistence remains dependent on exact-environment schema readiness and governed readback.

## Implemented domain contract

`tenantGptOAuthOperationCorrelation.js` defines an immutable versioned envelope with:

- stable `operation_id` and `correlation_id` UUIDs;
- optional governed `parent_operation_id`;
- registered protected-resource binding;
- hashed OAuth client reference;
- exact stage progression:
  `oauth_authorize → identity_verify → oauth_code_issue → oauth_token_exchange → gateway_verify`;
- SHA-256 chaining through `previous_envelope_sha256` and `envelope_sha256`;
- monotonic timestamps;
- fail-closed verification and safe bounded evidence.

Every stage transition must advance exactly one step. Stage skipping, replaying the same stage, moving backward, clock regression, digest tampering, resource drift, unknown fields, and sensitive fields are rejected.

## Sensitive-data handling

The domain contract never retains raw:

- user or tenant identifiers;
- OAuth client identifier in the envelope;
- OAuth authorization-code JTI;
- access-token JTI;
- request IDs;
- access tokens or authorization codes;
- authorization headers, cookies, credentials, secrets, email, or raw payloads.

References required for correlation are represented as SHA-256 digests. Public diagnostic evidence exposes only stable operation/correlation UUIDs, stage, protected resource, a client-hash prefix, binding booleans, envelope digest, timestamps, and `secrets_included=false`.

## Runtime integration still required

T030 remains open until a later exact-head phase performs all of the following:

1. create the envelope at OAuth authorize;
2. advance the same envelope after identity verification and code issue;
3. bind the operation reference to the authorization-code record;
4. verify and advance it during token exchange;
5. carry a bounded correlation claim in the access token;
6. attach the verified claim to gateway request context without caller override;
7. persist the Activation operation projection and stage evidence under tenant scope;
8. read back the exact operation and stage chain;
9. pass OAuth/gateway and canonical-contract parity tests.

The runtime work must not invent a parallel ledger or silently fall back when correlation persistence fails.

## Dependency boundary

The domain module is repository-only and does not require database access. Authorization-code storage and operation/stage persistence remain gated by T026 exact-environment schema readiness plus a separate runtime implementation review.

## Non-effects

This phase changes no OAuth route, JWT claim, gateway behavior, SQL schema, database data, runtime configuration, credentials, provider state, Production deployment, or external system. It includes no secrets.
