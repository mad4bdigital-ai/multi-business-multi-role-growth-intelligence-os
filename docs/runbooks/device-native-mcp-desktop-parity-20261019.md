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


## Windows ConPTY source slice (opt-in; not live accepted)

The local terminal manager has an **optional** native `node-pty` adapter for
Windows ConPTY sessions. It stays off unless
`CONNECTOR_DEVICE_TERMINAL_CONPTY_ENABLED=true` **and**
the device is explicitly Staging, terminal interactive authority is enabled,
and the Windows runtime can resolve a working native `node-pty` binding.
When ConPTY is requested but unavailable, interactive start returns
`pty_unavailable`; it **must not** silently fall back to pipes.

The native adapter starts only existing allowlisted REPL profiles in the
pre-authorized project root, with a scrubbed process environment and bounded
recorded output. It supports a per-principal streaming cursor, input capped
at 2048 bytes, consented `terminal_resize` (20–240 columns, 10–80 rows),
and owned-session termination. The local consent broker must issue a distinct
one-shot approval for **each resize and each input**; no OAuth token,
approval secret or arbitrary PID belongs in tool arguments.

Source tests: `node --test local-connector/test-device-terminal-engine.mjs`.
The native Windows binary must still be independently packaged, provenance-
verified, exercised in a signed Staging EXE/MSI, and tested against actual
process-tree teardown and logout/crash behavior. Node tests using an injected
ConPTY adapter are **synthetic** and do not certify a real Windows ConPTY
installation. Until those gates pass, this slice is `SOURCE_ONLY`.

### Native ConPTY package promotion gate (source-ready, no signed package)

For the opt-in Staging connector, keep
`CONNECTOR_DEVICE_TERMINAL_CONPTY_ENABLED=false` until an independently
approved Windows `node-pty@1.1.0` package has been supplied under the
connector's `node_modules/node-pty` directory. Activation also requires
`CONNECTOR_DEVICE_CONPTY_NATIVE_ADDON_PATH` (the actual native `.node`),
`CONNECTOR_DEVICE_CONPTY_NATIVE_SHA256` (the exact package addon digest),
and `CONNECTOR_DEVICE_CONPTY_SIGNER_THUMBPRINT` (the approved signing
certificate). An empty, unsigned, wrong-version or wrong-digest artifact
fails closed **before service installation** and is checked again **before
the connector loads node-pty at runtime** by
`Test-ConptyNativePackage.ps1`.

The Windows CI negative test proves only that an uncertified package is
rejected. It does not create a signed `node-pty`, validate the
positive-signature path, or install the native addon on a live machine.
Real ConPTY acceptance requires signed artifact custody, code-signing
identity attestation, Windows process-tree and teardown tests, and
Staging operator confirmation; Production remains independently blocked.

### Bounded binary document replacement (not structural editing)

`files_binary_info` establishes the expected SHA; every
`files_binary_read` page must send that exact SHA to avoid cross-version
mixes. `files_binary_replace` accepts a small fully formed DOCX/XLSX/PDF
binary only with source and target SHA, an exact-root path and separate
one-shot local consent. A private transaction backup enables
`files_rollback`, which rejects if the document was edited meanwhile.
All such actions are default-off and Staging-only. They **do not** edit
Word paragraphs, spreadsheet formulas/cells or PDF annotations; a trusted
format-aware adapter and positive ZIP/PDF fidelity tests remain required.

### Remaining independent acceptance gates for Issue #8606

| Workstream | Source status | Independent gate |
| --- | --- | --- |
| OS-private per-user Sidecar | Current-user Named Pipe and source one-shot OS-principal consent; mutation still gated | Live SID/ACL, OS-logoff revocation and per-client/tenant binding |
| Windows ConPTY | Bounded opt-in adapter, source tests | Native dependency packaging, interactive PTY, process tree and crash tests on Windows |
| Multi-device registry | Single OAuth-bound local device | Live authorized registry/heartbeat, offline and revocation, exact-device selection |
| DOCX/XLSX/PDF editing | Bounded, default-off Staging binary transport; no structural editing | Certified format-preserving document adapters, transaction rollback and large-file streaming |
| OAuth/MCP interoperability | Synthetic issuer/resource tests | Real PKCE flow, key rotation, ChatGPT + second client |
| Windows acceptance | Not achieved | Online managed Windows Staging device; signed install/rollback and local operator |
| Production | Blocked | Separate exact-head owner approval, CI, Staging signoff and governed promotion |

Do not infer Desktop Commander parity or Production readiness from these
source-level checks.

## Deferred Desktop Commander parity

These gaps are **not** silently considered complete: true ConPTY/PTTY and robust REPL control; owned process recovery/reattachment after connector restart; secure OS-private Sidecar credential delegation and consent UX; multi-device discovery and routing; dedicated DOCX/XLSX/PDF editing; large/binary file transfer; broad directory move/rename; cross-client compatibility certification; hardening of simultaneous non-cooperating file writers.

Recommended subsequent stages: B = dedicated OS-private Sidecar and stronger terminal/session lifecycle; C = multi-device registry and signed routing; D = document/media adapters and large-file streams; E = Windows live OAuth/ChatGPT end-to-end certification, performance and rollback. All stages retain opt-in and independent Staging/Production promotion gates.
