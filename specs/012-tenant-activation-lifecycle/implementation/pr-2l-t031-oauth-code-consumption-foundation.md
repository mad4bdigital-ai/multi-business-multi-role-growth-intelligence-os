# PR-2L — T031 OAuth code-consumption hardening foundation

## Scope

This slice adds the repository-side foundation for Spec 012 task T031. It hardens authorization-code consumption evidence and defines one fail-closed policy for ambiguous token-exchange outcomes.

It does **not** close T031. The live `/auth/oauth/token` route is unchanged in this slice and must be wired in a later bounded runtime PR.

## What changed

### Classified atomic consumption

`tenantGptOAuthAuthorizationCodeStore.js` retains a single conditional `UPDATE` as the consumption authority. Exactly one exchange can change an eligible code from `issued` to `consumed`.

When the update affects no row, the store performs bounded readback and classifies the result as:

- `not_found`;
- `binding_mismatch`;
- `expired`;
- `already_consumed`;
- `revoked`; or
- `issued_not_consumed`.

When the database transport fails during consumption, the store attempts readback:

- a consumed readback becomes `consumption_outcome_unknown` and forbids replay;
- an issued readback becomes `store_unavailable_code_still_issued` and may permit a bounded retry;
- missing readback fails closed as `consumption_outcome_unknown`.

Raw authorization codes are never returned. The persisted and queried identity remains a SHA-256 hash.

### Token-response ambiguity policy

`tenantGptOAuthTokenExchangeOutcomePolicy.js` defines stable behavior for the route integration:

- verified missing, expired, revoked, reused, or mismatched codes map to `400 invalid_grant`;
- store unavailability with authoritative `issued` readback maps to `503 temporarily_unavailable` and may allow the same code to retry;
- unknown consumption outcome maps to `503 temporarily_unavailable`, forbids replay, and requires reconciliation;
- a consumed code without a committed token response maps to `503 temporarily_unavailable`, forbids replay, and requires reconciliation;
- restart authorization is recommended only after a verified invalid-grant classification.

The policy returns bounded OAuth error metadata and never includes a raw code, token, authorization header, or client secret.

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

## Runtime integration still required

Before T031 can be marked complete, a bounded route PR must:

1. validate the active user and membership before consuming the code;
2. prepare token claims before the atomic consume gate;
3. wire classified store outcomes into stable OAuth errors;
4. return `temporarily_unavailable` for unknown outcomes rather than collapsing them into `invalid_grant`;
5. forbid same-code replay after consumed or unknown outcomes;
6. record post-consumption/no-response evidence;
7. retain `Cache-Control: no-store` and `Pragma: no-cache`;
8. run exact route-level concurrent and post-consumption failure regressions;
9. complete exact-environment readback.

## Non-effects

No live OAuth route, OAuth response, JWT claim, SQL schema, migration, database data, runtime wiring, Production deployment, credential, provider, or external system was changed. No force push was used and no secrets are included.
