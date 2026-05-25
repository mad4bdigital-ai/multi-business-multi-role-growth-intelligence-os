# Browser4 Local Adapter Rollout

## Purpose

This note documents the governed Browser4 local adapter added for the browser runtime layer. The adapter is intentionally narrow: it supports status checks and site inspection only after browser runtime policy preflight.

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

The local connector manages Browser4 as a device-side runtime. The production GPT-facing path must not call raw PowerShell, raw shell, raw Browser4 APIs, CDP, WebDriver, or arbitrary JavaScript.

## Session lifecycle

Browser4 CLI requires an active session before page commands. The adapter runs the lifecycle explicitly:

1. `browser4-cli open --server <server_url>`
2. `browser4-cli goto <allowlisted_url>`
3. `browser4-cli snapshot` and/or `browser4-cli screenshot`

The adapter records only bounded previews and artifact paths. It does not return cookies, tokens, credentials, or raw secret-like fields.

## Policy controls

Both layers enforce policy:

- `browser_runtime_policy_check` blocks unallowlisted domains and risky actions before device execution.
- The local `/browser4` endpoint validates `http`/`https` URLs and checks `BROWSER4_ALLOWED_HOSTS`.
- The connector endpoint is admin-only through the auth-host proxy.
- Browser4 artifacts are metadata references only; sensitive values must not be echoed in responses.

Default allowed hosts for the first PoC:

```text
mad4b.com,n8n.mad4b.com
```

## Connector environment

The connector installer provisions the following runtime flags:

```text
CONNECTOR_BROWSER4_ENABLED=true
BROWSER4_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com
BROWSER4_WORK_DIR=D:\n8n-data\browser-runtime-artifacts
BROWSER4_JAVA_HOME=D:\n8n-data\browser-runtime\jre17\jdk-17.0.19+10-jre
```

`BROWSER4_JAVA_HOME` points to the portable JRE 17 location used during the Essam PoC. If the device does not have this JRE yet, provision it before promoting the runtime from planned to active.

## Rollout notes

- This change adds adapter wiring and governance surfaces; it does not promote Browser4 to a fully active runtime automatically.
- Keep `browser4_essam_v1` planned until the connector on Essam is upgraded and `/browser4 status` succeeds.
- After upgrade, run `browser_runtime_inspect_site_run` against `https://n8n.mad4b.com/` using `browser4_inspect_essam`.
- Promote to active only after a completed inspection run writes artifact metadata and `secrets_included=false`.
