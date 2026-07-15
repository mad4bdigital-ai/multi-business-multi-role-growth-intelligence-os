# Tenant GPT OAuth live smoke

`http-generic-api/scripts/tenant-gpt-oauth-live-smoke.mjs` performs a bounded production check of `authorize -> code -> token` on `https://auth.mad4b.com`.

It requires an active user UUID, an active membership tenant UUID, and the typed confirmation `RUN_TENANT_GPT_OAUTH_LIVE_SMOKE`. The OAuth client secret and backend credential are resolved inside the server process and are never accepted as command arguments or returned in output.

The smoke verifies absolute authorize links, OAuth state preservation, lowercase `token_type: bearer`, issuer and audience, user and tenant binding, rejection of code replay with `invalid_grant`, and cleanup of the transient `tenant_gpt_activation_contexts` row. Output is restricted to status codes, booleans, non-secret token metadata, and cleanup counts.

Legacy `https://chat.openai.com/aip/g-.../oauth/callback` requests remain valid during authorization and token exchange, but authorization-code issuance redirects directly to the canonical `https://chatgpt.com/aip/g-.../oauth/callback` host to preserve the current ChatGPT login context.

After CI, merge, and production deployment readback, expose the script through the governed `ADMIN_SHELL_ALLOWLIST` for the duration of the check and invoke it with:

```text
--user-id=<active-user-uuid>
--tenant-id=<active-tenant-uuid>
--confirm=RUN_TENANT_GPT_OAUTH_LIVE_SMOKE
```

Remove the temporary runtime alias after execution. A passing unit test is not evidence of a successful production OAuth exchange.
