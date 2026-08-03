# PR-2N — T032 legacy-audience compatibility and cutoff telemetry

## Scope

This slice centralizes the Tenant GPT protected-resource audience decision used by `tenantGptAccessTokenVerifier.js`.

It implements repository-level policy and evidence for:

- strict single-audience acceptance for `https://activation.mad4b.com`;
- bounded acceptance of the existing legacy audience `mad4b-tenant-gpt` before the configured cutoff only;
- deterministic rejection after cutoff, when compatibility is disabled, when the cutoff is absent, when `iat` is invalid or future, and when the token was issued after cutoff;
- rejection of zero-audience and multi-audience tokens;
- stable no-secret metric classification for every audience decision;
- resource-claim mismatch classification without recording a false accepted decision;
- fail-closed token verification when the governed JWT secret is absent or unbounded.

This slice does **not** close T032. Repository policy, verifier wiring, tests, deployment, and live legacy compatibility evidence are separate completion gates.

## Audience decision

Every verified Tenant GPT access token must produce exactly one audience compatibility decision.

A strict token is accepted only when `aud` contains exactly one value and that value equals the registered Activation protected resource.

A legacy token is accepted only when all of the following are true:

1. legacy compatibility is explicitly enabled;
2. the cutoff parses to a positive timestamp;
3. request time is at or before the cutoff;
4. the token contains one positive finite `iat` value;
5. `iat` is not more than five minutes in the future;
6. `iat` is at or before the cutoff;
7. the optional token `resource` claim is absent or matches the Activation protected resource.

The five-minute skew is a governed maximum. A caller cannot widen it by injecting a larger option.

The exact cutoff instant is inclusive. The first millisecond after cutoff rejects the legacy audience. This implementation does not extend or mutate the configured cutoff.

## Verification dependency

The verifier no longer accepts a known development fallback when `JWT_SECRET` is absent. It reads the governed secret at verification time and fails closed with `tenant_gpt_verifier_unavailable` and HTTP `503` when the secret is missing or exceeds 4096 characters.

This dependency failure occurs before signature or audience evaluation. It cannot be misclassified as an invalid user token and does not expose secret material.

## Stable classifications

The policy emits one of the following bounded classifications:

- `strict_resource_audience_accepted`;
- `legacy_audience_accepted_before_cutoff`;
- `legacy_audience_rejected_disabled`;
- `legacy_audience_rejected_cutoff_unconfigured`;
- `legacy_audience_rejected_cutoff_elapsed`;
- `legacy_audience_rejected_iat_invalid`;
- `legacy_audience_rejected_iat_future`;
- `legacy_audience_rejected_issued_after_cutoff`;
- `multi_audience_rejected`;
- `audience_mismatch_rejected`;
- `token_resource_mismatch_rejected`.

All rejected audience classifications continue to produce the existing stable `tenant_gpt_token_audience_invalid` or `tenant_gpt_token_resource_invalid` gateway errors. The compatibility classification remains internal evidence and is attached to `req.auth` only after successful verification.

## Telemetry boundary

The metric contract is:

`tenant_gpt_audience_compatibility_total{classification,outcome,audience_mode,cutoff_state}`

Each decision has a value of one. The labels do not include tenant ID, user ID, token ID, token contents, authorization headers, raw claims, or other unbounded values.

The default recorder suppresses ordinary strict-acceptance logs to avoid request-volume logging. Strict classification remains attached to the verified request context and is available to a caller-supplied metrics sink. The default recorder logs legacy acceptance at `info` and compatibility rejection at `warn`.

Telemetry is best effort. Failure of the metrics callback does not deny an otherwise valid token and does not convert a rejection into acceptance.

## Tests

The deterministic regressions cover:

- strict single-audience acceptance;
- legacy acceptance before and at the cutoff;
- rejection after cutoff;
- compatibility disabled and cutoff unconfigured;
- missing, future, and post-cutoff `iat`;
- a caller attempting to widen clock skew;
- zero and multiple audiences;
- wrong audience and wrong resource;
- missing and oversized verifier secrets;
- stable metric name and label set;
- no-secret default logging;
- verifier propagation into `req.auth`;
- telemetry callback failure isolation.

## Completion boundary

T032 remains open until all of the following are complete:

1. policy, verifier, and readiness regressions pass on the hardened reviewed head;
2. remaining repository CI gates complete without failure;
3. the reviewed merge SHA is deployed through the governed release path;
4. bounded legacy acceptance evidence is read back before cutoff when an authorized test token exists;
5. legacy rejection after cutoff or explicit disablement is read back without extending the cutoff;
6. multi-audience rejection is read back;
7. live evidence confirms the labels contain no tenant, user, token, authorization header, or raw claims.

## Non-effects

No Production request, deployment, cutoff extension, new compatibility enablement, SQL Apply, migration, database mutation, credential access, provider call, external send, or force push occurred. No secrets are included.
