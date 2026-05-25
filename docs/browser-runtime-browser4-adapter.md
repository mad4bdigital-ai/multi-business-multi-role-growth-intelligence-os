# Browser Runtime Browser4 Adapter

## Purpose

This document describes the governed Browser4 runtime adapter used for site inspection and structured extraction experiments. The adapter is part of the Browser Runtime Governance layer and must not be used as a raw browser, raw PowerShell, or unrestricted local-device execution surface.

## Scope

The adapter adds two governed surfaces:

- Local connector: `POST /browser4`
- Auth-host runtime route: `POST /browser-runtime/inspect-site/run`

The auth-host route is the production entry point for the Admin GPT. It performs `browser_runtime_policy_check` before device execution and records the inspection result back to `browser_site_inspection_runs`.

## Execution Flow

```text
Admin GPT
  -> browser_runtime_inspect_site_run
  -> Browser Runtime policy preflight
  -> /connector/{device_id}/browser4 proxy
  -> local connector /browser4 endpoint
  -> Browser4 CLI session lifecycle
  -> artifact metadata + inspection run result
```

## Browser4 Session Lifecycle

Browser4 CLI requires an explicit browser session before DOM operations. The adapter therefore runs the lifecycle as separate steps:

1. `browser4-cli open --server <server-url>`
2. `browser4-cli goto <allowlisted-url>`
3. `browser4-cli snapshot` and/or `browser4-cli screenshot`

The adapter does not expose arbitrary Browser4 commands. Only allowlisted inspection checks are accepted.

## Policy and Security Controls

The adapter enforces two layers of domain control:

1. Runtime policy from `browser_runtime_bindings.domain_allowlist_json`.
2. Connector-side allowlist from `BROWSER4_ALLOWED_HOSTS`.

The adapter must not return cookies, tokens, Authorization headers, raw credentials, or local connector secrets. Result payloads include bounded stdout/stderr previews and artifact paths only.

Disallowed surfaces:

- raw PowerShell as the GPT-facing browser surface
- raw Browser4 API passthrough
- arbitrary JavaScript evaluation
- arbitrary filesystem access
- unallowlisted domains
- destructive form submits or payment/checkout actions

## Runtime Prerequisites

On Essam, the Browser4 PoC uses portable Java instead of changing the system Java installation:

```text
D:\n8n-data\browser-runtime\jre17\jdk-17.0.19+10-jre
```

The local connector installer provisions these environment variables:

```text
CONNECTOR_BROWSER4_ENABLED=true
BROWSER4_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com
BROWSER4_WORK_DIR=D:\n8n-data\browser-runtime-artifacts
BROWSER4_JAVA_HOME=D:\n8n-data\browser-runtime\jre17\jdk-17.0.19+10-jre
```

## Rollout Notes

This adapter should remain `planned` or `planned_adapter_available_after_connector_upgrade` until the local connector on the target device has been upgraded and `/browser4` health is verified. After verification, the runtime can be promoted with same-cycle evidence from:

- `browser_runtime_policy_check`
- `connector_browser4` action `status`
- `browser_runtime_inspect_site_run` against an allowlisted URL
- readback from `browser_site_inspection_runs`

## Audit Expectations

Each run should preserve:

- `inspection_key`
- `runtime_key`
- `binding_key`
- `url_host`
- policy result
- connector route metadata
- artifact references
- `secrets_included=false`
