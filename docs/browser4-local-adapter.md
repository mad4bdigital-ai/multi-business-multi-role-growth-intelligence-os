# Browser4 Local Adapter Rollout

## Purpose

This document covers the governed Browser4 local adapter. The adapter is a narrow inspection bridge for the browser runtime layer and does not expose raw PowerShell, raw Browser4 APIs, raw CDP, WebDriver, arbitrary JavaScript, or unrestricted filesystem access.

## Runtime path

```text
Admin GPT
  -> auth-host tool registry
  -> browser_runtime_inspect_site_run
  -> browser runtime policy preflight
  -> connector proxy /connector/{device_id}/browser4
  -> local connector /browser4
  -> Browser4 CLI lifecycle
```

## Session lifecycle

Browser4 commands require an active session. The adapter manages this explicitly:

1. `browser4-cli open --server <server_url>`
2. `browser4-cli goto <allowlisted_url>`
3. `browser4-cli snapshot` and/or `browser4-cli screenshot`

## Policy controls

- Runtime policy blocks unallowlisted domains before device execution.
- The connector validates `http` and `https` only.
- The connector applies `BROWSER4_ALLOWED_HOSTS` as a second allowlist.
- Responses include artifact paths and bounded previews only.
- Responses must include `secrets_included=false` and must not echo cookies, tokens, credentials, or secret-like fields.

## Rollout

The first safe validation target is `https://n8n.mad4b.com/` through `browser4_inspect_essam` after the Essam connector is upgraded with Browser4 enabled and JRE 17 available.
