# MAD4B Device Runtime — Desktop Commander parity, source Stage A

Status: **Draft source / NO-GO for Production, unattended interactive execution, or claims of full parity.**
Stack: PR #8605 on top of PR #8604. No changes to `main` authorized.

## Current source boundary

Device Files already supports bounded, allowlisted project-relative operations. Stage A exposes more of them through **Native OAuth MCP** without removing any of the existing local Connector authorization:

| Native MCP tool | Local action | OAuth scope | Independent local consent |
|---|---|---|---|
| `files_list`, `files_read`, `files_info`, `files_search`, `files_stat`, `files_read_many` | read-only | `device:files:read` | No |
| `files_create_directory`, `files_create_file`, `files_copy`, `files_move`, `files_patch`, `files_rollback` | text-only, project root | `device:files:write` | Yes, exact one-shot |
| `terminal_start_readonly` | fixed Git probes | `device:terminal:execute` | Fixed-profile scope; no local write/interactive authority |
| `terminal_cancel`, `process_terminate_owned`, `sessions_close` | owned session lifecycle | `device:terminal:execute` | **Fresh, one-shot local consent** bound to subject/client and exact session ID |
| `terminal_start_interactive`, `terminal_input` | fixed-profile REPL, scoped | `device:terminal:interactive` | Yes, exact one-shot |
| `sessions_list`, `sessions_get`, `sessions_resume`, `terminal_output`, `process_list`, `process_status` | own principal only | `device:terminal:read` | No |
| `devices_list`, `devices_health`, `devices_capabilities` | bound identity | `device:status:read` | No |

`devices_list` returns the **single OAuth-bound device**, not an organization-wide device registry. File reads are bounded to 1 MiB and common sensitive files/path segments are rejected. File patch uses SHA-256 conflict detection and rollback; this is not a multi-writer filesystem transaction. Interactive terminal input is potentially powerful and receives a fresh consent for **every** submitted string.

## Two independent authorities

1. The Native MCP bearer proves identity and scopes, including exact issuer, audience, tenant, device, client and expiry. It is **never** a Connector admin or local consent token.
2. The Local Manager's **MCP Local Consent** tab explicitly names the OAuth subject, client, tenant, tool and *exact JSON arguments*. It shows the operation and requires human confirmation. It submits a separate, locally generated secret over an admin-authenticated loopback endpoint. The broker stores only a hash of the operation's canonical arguments, a principal identifier and an expiry.

The broker is disabled unless both MCP and broker flags are on, the Connector environment is **staging**, and a private 24+ character approval secret is present.

Every authenticated `tools/call` emits a bounded structured local audit event with the device ID, registered tool name, outcome and a SHA-256 principal fingerprint; OAuth bearer strings, subjects, tool arguments and approval secrets are not recorded. Audit logging is best-effort and must receive an independent live Staging acceptance check before being treated as durable security evidence. Production can not enable Stage A write/interactive consent even by turning on the feature flag.

Receipts:
- expire after 90 seconds and are kept in memory only;
- are consumed before the privileged engine dispatch;
- are tied to exact device/tenant, OAuth subject/client, tool name and arguments;
- cannot be reused for changed arguments or another principal;
- are not passed to the MCP client as credentials;
- are rejected for external/tunneled requests and forwarded proxy headers;
- do **not** authorize arbitrary PIDs, paths outside the configured root, new commands/profiles, secrets changes, or bypass of existing engine rules.

## Local configuration example — Staging only

```dotenv
CONNECTOR_DEVICE_FILES_ENABLED=false
CONNECTOR_DEVICE_FILE_WRITES_ENABLED=false
CONNECTOR_DEVICE_TERMINAL_ENABLED=false
CONNECTOR_DEVICE_TERMINAL_INTERACTIVE_ENABLED=false
CONNECTOR_DEVICE_MCP_ENABLED=false
CONNECTOR_DEVICE_MCP_APPROVAL_ENABLED=false
CONNECTOR_DEVICE_MCP_ENVIRONMENT=staging
CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN=
```

Do not place real credentials or OAuth tokens in a chat, GitHub Issue, log or source tree. The local administrator must opt in to **all** relevant feature flags and configure the separate file/terminal secrets locally. The existing root allowlist and exact `CONNECTOR_DEVICE_ID` remain mandatory. The MCP broker requires the full OAuth resource setup specified in `native-device-mcp-oauth-20261018.md`.

## Tests added

```sh
node --test local-connector/test-device-mcp-approval-broker.mjs
node --test local-connector/test-device-mcp-resource.mjs
node --test local-connector/test-device-runtime-http.mjs
node http-generic-api/test-connector-staging-mcp-distribution.mjs
```

Acceptance must include: disabled-by-default, Production denial, wrong device/tenant/principal rejection, expiry/replay denial, argument substitution denial, scope filtering, masked local consent UI, Connector-only authentication, proxy/header denial, signed manifest packaging, installer/rollback and real Windows staging acceptance.

**Running source tests is not live device certification.** Confirm against a real OAuth issuer (Authorization Code + PKCE), ChatGPT MCP discovery, an actual signed Windows package, and two independent principals before moving beyond this stage.

## Deferred Desktop Commander parity

These gaps are **not** silently considered complete: true ConPTY/PTTY and robust REPL control; owned process recovery/reattachment after connector restart; secure OS-private Sidecar credential delegation and consent UX; multi-device discovery and routing; dedicated DOCX/XLSX/PDF editing; large/binary file transfer; broad directory move/rename; cross-client compatibility certification; hardening of simultaneous non-cooperating file writers.

Recommended subsequent stages: B = dedicated OS-private Sidecar and stronger terminal/session lifecycle; C = multi-device registry and signed routing; D = document/media adapters and large-file streams; E = Windows live OAuth/ChatGPT end-to-end certification, performance and rollback. All stages retain opt-in and independent Staging/Production promotion gates.
