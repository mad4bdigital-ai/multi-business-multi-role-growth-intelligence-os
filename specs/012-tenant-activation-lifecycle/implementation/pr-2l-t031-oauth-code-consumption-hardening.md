# PR-2L — T031 OAuth code-consumption hardening foundation

## Scope

This package hardens the repository-side authorization-code store and defines one fail-closed policy for ambiguous OAuth token-exchange outcomes.

It does **not** close T031. The live `POST /auth/oauth/token` route is not wired to the new policy in this package, and no Production or database action is authorized.

## Problem confirmed on the current runtime

The existing store already uses an atomic conditional `UPDATE` so only one concurrent exchange can consume an issued code. However, the previous return value was only `consumed: true|false`.

That binary result could not distinguish:

- an absent code;
- wrong client or callback binding;
- expiry or revocation;
- a normal replay after another concurrent exchange won;
- a transport failure before the database committed the consumption;
- a transport failure after the database committed the consumption; or
- a completely unavailable readback.

Those states require different OAuth behavior. In particular, a code whose consumption result is unknown must not be replayed and must not be reported as a verified `invalid_grant` without readback.

## Repository-side foundation

`tenantGptOAuthAuthorizationCodeStore.js` now provides:

- atomic compare-and-set consumption;
- a bounded inspection/readback operation;
- stable no-secret consumption outcomes;
- classification of replay, binding mismatch, expiry, revocation, and missing record;
- post-error readback for transport failures;
- an attached frozen `oauth_consumption` record on store errors;
- explicit distinction between:
  - `consumption_outcome_unknown`; and
  - `store_unavailable_code_still_issued`.

`tenantGptOAuthTokenExchangeOutcomePolicy.js` defines the OAuth response decision for:

- verified invalid grants;
- store failure with a verified still-issued code;
- unknown code-consumption outcome;
- failure after successful consumption but before response commit; and
- a successfully committed token response.

The policy never includes raw authorization codes, access tokens, authorization headers, or client secrets.

## Safety semantics

When a database failure occurs after the consumption statement:

- readback `already_consumed` is treated as an unknown token-response outcome;
- the same code must not be replayed;
- the client receives `temporarily_unavailable`, not an unverified `invalid_grant`;
- operator reconciliation is required.

When readback proves the code is still `issued`:

- the outcome is not classified as consumed;
- a bounded response may permit the same-code retry;
- authorization restart is not required.

When readback proves the code is absent, mismatched, expired, consumed, or revoked:

- the exchange is a verified `invalid_grant`;
- same-code retry is forbidden;
- restarting authorization is allowed.

## Tests

The deterministic tests cover:

- first consumption and replay;
- client/callback binding mismatch;
- expiry;
- two concurrent consumers with exactly one winner;
- disconnect after database commit;
- disconnect before database commit;
- unavailable update and unavailable readback;
- missing-table recovery behavior;
- no raw code values in returned evidence;
- policy mapping for every governed outcome; and
- bounded OAuth error responses.

## Runtime integration still required

T031 remains open until the live token route:

1. completes all reversible client, callback, resource, subject, membership, and issuer-readiness checks before consumption;
2. consumes the code as the last irreversible authorization gate;
3. uses the classified store result rather than a boolean;
4. records the response-commit boundary;
5. maps post-consumption failures to `temporarily_unavailable` with no same-code replay;
6. records bounded diagnostics;
7. passes route-level race and fault-injection tests; and
8. passes exact-head CI and protected-path smoke.

## Non-effects

This package performs no SQL execution, migration, Production deployment, credential access, provider call, external send, JWT claim change, or live OAuth route change. It does not mark T031 complete.
