# PR-2O — T033 short-lived bearer profile

## Scope

This slice implements the repository portion of T033 for Tenant GPT bearer issuance and verification.

New strict access tokens are issued with a governed lifetime of at most one hour. The same TTL drives the signed token, OAuth `expires_in`, activation-context expiry, and bounded diagnostic evidence.

The verifier now checks issuer, exactly one audience, subject binding, `iat`, `exp`, user claim, tenant claim, positive lifetime, and current expiry. It emits no-secret evidence for the presence or validity of those properties.

This slice does **not** close T033. Deployment and live readback of the issued token profile and evidence remain required.

## Issuance boundary

`TENANT_GPT_ACCESS_TOKEN_TTL_SECONDS` is optional. When absent, the default is 3600 seconds. When present, it must be an integer from 60 through 3600 seconds.

A caller cannot extend the maximum by passing a larger `expiresIn` value. The governed issuer replaces that value with the resolved profile.

The OAuth token route uses the same resolved value for:

- the JWT `exp - iat` lifetime;
- OAuth response `expires_in`;
- activation-context `expires_at`;
- bounded bearer-profile diagnostics.

The route no longer contains verifier or issuer fallback behavior. Missing dependencies fail before code consumption through the existing pre-consumption `503 temporarily_unavailable` outcome.

## Strict verification profile

A strict Tenant GPT bearer is accepted only when:

1. the issuer equals `https://auth.mad4b.com`;
2. `aud` contains exactly the registered protected resource;
3. `user_id` and `tenant_id` are present and bounded;
4. `sub` equals `tenant:{tenant_id}:user:{user_id}`;
5. `iat` and `exp` are positive integers;
6. `iat` is not more than five minutes in the future;
7. `exp` is greater than `iat`;
8. `exp - iat` is no more than 3600 seconds;
9. the token is not expired.

The verifier uses the supplied verification clock for both JWT expiry and profile checks, preventing inconsistent decisions between signature verification and evidence classification.

## Legacy transition boundary

T032 remains the only authority for accepting the legacy audience `mad4b-tenant-gpt`.

When T032 accepts a legacy token before cutoff, T033 allows a lifetime up to the existing seven-day transition maximum of 604800 seconds. It does not extend the T032 cutoff or permit a strict protected-resource token longer than one hour.

A legacy token beyond seven days is rejected even while the compatibility window is active.

## Evidence boundary

The metric contract is:

`tenant_gpt_access_token_profile_total{classification,outcome,audience_mode,short_lived}`

Evidence may include:

- issuer verified: boolean;
- audience verified: boolean;
- subject verified: boolean;
- user claim present: boolean;
- tenant claim present: boolean;
- issued-at present: boolean;
- expiry present: boolean;
- lifetime seconds;
- remaining seconds;
- maximum allowed lifetime;
- short-lived: boolean.

Evidence does not contain the raw issuer, audience, subject, user ID, tenant ID, access token, authorization header, or secret.

Ordinary successful strict verification is attached to the verified request context and available to a caller-supplied metric sink without creating default log volume. Legacy verification and rejected profiles use bounded default evidence.

## Deterministic coverage

The repository regressions cover:

- default, minimum, maximum, and invalid configured TTLs;
- attempted seven-day override of strict issuance;
- matching signed lifetime, OAuth response, and activation-context expiry;
- missing route verifier and issuer dependencies before code consumption;
- strict one-hour acceptance and 3601-second rejection;
- legacy seven-day transition acceptance and over-limit rejection;
- issuer, audience, subject, user, tenant, `iat`, `exp`, future-`iat`, lifetime, and expiry failures;
- no-secret profile logging and request-context evidence;
- missing and oversized verifier secrets.

## Completion boundary

T033 remains open until all of the following are complete:

1. profile, issuer, route, verifier, and readiness regressions pass on the reviewed head;
2. remaining repository CI gates complete without failure;
3. the reviewed merge SHA is deployed through the governed release path;
4. a live strict token is read back with a lifetime no greater than 3600 seconds;
5. issuer, single audience, subject, expiry, user-claim, and tenant-claim evidence is read back;
6. live evidence proves no raw issuer, audience, subject, user, tenant, token, or authorization header is included;
7. any accepted longer-lived token is proven legacy-only and bounded by T032.

## Non-effects

No Production request, deployment, legacy cutoff extension, legacy lifetime extension, SQL Apply, migration, database mutation, credential access, provider call, external send, or force push occurred. No secrets are included.
