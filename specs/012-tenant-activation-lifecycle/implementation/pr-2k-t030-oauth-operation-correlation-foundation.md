# Spec 012 T030 — OAuth Operation Correlation Foundation

## Status

`runtime_chain_wired_schema_apply_readback_required`

The domain contract is now wired repository-side through OAuth authorize, identity verification, authorization-code issuance, token exchange, access-token verification, and protected-resource gateway verification. The additive authorization-code migration is included but is not applied by this PR. T030 therefore remains open until governed schema apply/readback and exact-SHA Staging verification complete. Production remains unchanged.

## Problem confirmed on current main

The prior OAuth implementation had request-local identifiers but no server-owned carrier that survived authorize → code → token → gateway. This PR closes that repository-runtime wiring gap without inventing an Activation run before an Activation session exists.

`request_correlation_ref` is defined as the OAuth correlation `operation_id`. It is stored on `tenant_gpt_oauth_authorization_codes` and has no foreign key to `activation_runs`, because OAuth authorization starts before a valid Activation run/session exists. The migration remains subject to exact-environment schema apply/readback.

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

## Repository runtime wiring implemented

The repository runtime now performs the following chain:

1. `GET /auth/oauth/authorize` creates the `oauth_authorize` envelope server-side.
2. The browser receives only a short-lived signed correlation ticket bound to client, resource, redirect URI, and OAuth state.
3. `POST /auth/oauth/code` verifies that ticket, advances to `identity_verify`, persists the authorization-code row with `request_correlation_ref = operation_id`, then advances to `oauth_code_issue` and signs the verified envelope into the authorization-code JWT.
4. `POST /auth/oauth/token` verifies the code correlation, atomically consumes the exact row using the same `operation_id`, checks readback parity, advances to `oauth_token_exchange` with the access-token JTI, and signs the verified envelope into the access token.
5. `tenantGptAccessTokenVerifier` fails closed on a present-but-invalid correlation claim. Protected-resource middleware advances a verified OAuth claim exactly once to `gateway_verify` and replaces caller-provided auth context rather than trusting it.

No raw OAuth code, token, credential, client secret, user identifier, tenant identifier, or request body is copied into correlation evidence.

## Remaining T030 closure work

T030 remains open until all of the following post-merge conditions are satisfied:

1. governed apply/readback confirms `request_correlation_ref VARCHAR(36) NULL` and its index in the exact target environment;
2. exact-SHA Staging deployment proves authorize → code → token → gateway correlation parity;
3. a legitimate Activation session/run is available before any bridge into `activation_operation_projections` or `activation_stage_attempts`;
4. that bridge preserves the existing invariant `activation_operation_projections.operation_id = activation_runs.run_id` rather than manufacturing an OAuth-only `activation_run`;
5. exact operation/stage readback completes under tenant scope.

The OAuth correlation `operation_id` is therefore a stable pre-Activation request correlation reference, not a substitute for `activation_runs.run_id`. No parallel ledger is introduced.

## Dependency boundary

The correlation domain module remains repository-local. Authorization-code runtime wiring now depends on the additive migration in this PR; applying that migration is explicitly outside the PR and remains governed by exact-environment schema readiness and readback. Activation operation/stage persistence remains gated by the existence of a legitimate Activation run.

## Non-effects

This PR changes OAuth route/JWT/runtime wiring and adds an additive migration file, but it does not apply that migration, deploy code, mutate Production, change credentials, call providers, create Activation runs, write Activation projections, or mark Recovery OAuth source authority available. `callback_received` remains unresolved and is intentionally deferred to B2A.2. It includes no secrets.
