# PR-2L — T031 OAuth code-consumption hardening

## Scope

This slice hardens the live authorization-code store used by `/auth/oauth/token` and adds a fail-closed policy module for ambiguous token-exchange outcomes.

It does **not** close T031. The store-level consumption and readback behavior changes in this slice, but the live token route does not yet import the new outcome policy or expose its classified OAuth responses. That route wiring and exact-environment readback remain a later bounded runtime step.

## What changed

### Live classified atomic consumption

`tenantGptOAuthAuthorizationCodeStore.js` remains the store called by the live token route. It retains a single conditional `UPDATE` as the consumption authority, so exactly one exchange can change an eligible code from `issued` to `consumed`.

The live store now performs bounded readback when the update affects no row and classifies the result as:

- `not_found`;
- `binding_mismatch`;
- `expired`;
- `already_consumed`;
- `revoked`; or
- `issued_not_consumed`.

When the database transport fails during consumption, the live store attempts authoritative readback:

- a consumed readback becomes `consumption_outcome_unknown` and forbids replay;
- an issued readback becomes `store_unavailable_code_still_issued` and may permit a bounded retry;
- missing readback fails closed as `consumption_outcome_unknown`.

Raw authorization codes are never returned. Persisted and queried code identity remains a SHA-256 hash.

### Token-response ambiguity policy awaiting route wiring

`tenantGptOAuthTokenExchangeOutcomePolicy.js` defines the stable behavior to be wired into `/auth/oauth/token`:

- verified missing, expired, revoked, reused, or mismatched codes map to `400 invalid_grant`;
- store unavailability with authoritative `issued` readback maps to `503 temporarily_unavailable` and may allow the same code to retry;
- unknown consumption outcome maps to `503 temporarily_unavailable`, forbids replay, and requires reconciliation;
- a consumed code without a committed token response maps to `503 temporarily_unavailable`, forbids replay, and requires reconciliation;
- restart authorization is recommended only after a verified invalid-grant classification.

The policy returns bounded OAuth error metadata and never includes a raw code, token, authorization header, or client secret. The live route does not import this policy in this slice, so its response contract remains unchanged.

## Test coverage

The deterministic tests cover:

- first consumption;
- replay;
- two concurrent exchanges with exactly one winner;
- client/callback mismatch;
- expiry;
- transport failure after commit;
- transport failure before commit with `issued` readback;
- total store/readback unavailability;
- consumed-without-response policy;
- no-secret response evidence.

## Route integration still required

Before T031 can be marked complete, a bounded route PR must:

1. validate the active user and membership before consuming the code;
2. prepare token claims before the atomic consume gate;
3. wire classified store outcomes into stable OAuth errors;
4. return `temporarily_unavailable` for unknown outcomes rather than collapsing them into `invalid_grant`;
5. forbid same-code replay after consumed or unknown outcomes at the response boundary;
6. record post-consumption/no-response evidence;
7. retain `Cache-Control: no-store` and `Pragma: no-cache`;
8. run exact route-level concurrent and post-consumption failure regressions;
9. complete exact-environment readback.

## Effects and non-effects

The authorization-code store's runtime behavior is changed: zero-row and transport-error outcomes are now classified through bounded readback. The token route source, OAuth response contract, JWT claims, and SQL schema are unchanged.

No migration or database mutation was executed during delivery. No Production deployment, credential access, provider call, external send, or force push occurred, and no secrets are included.
