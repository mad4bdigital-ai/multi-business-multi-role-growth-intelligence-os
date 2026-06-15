# MAD4B Local Desktop as the Container for Hermes Surface

## Decision

MAD4B Local Desktop is the product container, lifecycle owner, update authority,
and recovery surface.

MAD4B may embed a maintained downstream copy of the MIT-licensed
`NousResearch/hermes-agent` Surface as its primary agent workspace. Hermes is a
replaceable interaction module, not the application root or device authority.

The existing Local Manager responsibilities must move behind MAD4B Local
Desktop into a small native MAD4B sidecar. The sidecar remains responsible for
device identity, DPAPI-protected tokens, signed installer handoff, UAC, device
command polling, connector recovery, and privileged local verification.

The Hermes renderer, Hermes gateway, Hermes agent loop, plugins, skills, and
model providers must never receive the MAD4B device token, connector secret,
installer token, or platform backend credential.

## Why this shape

Hermes Agent v0.16.0, released on June 5, 2026 as the "Surface Release", provides
a mature Electron desktop shell, React UI, streaming chat, profiles, sessions,
model selection, remote gateway connectivity, and an administration dashboard.
Its repository is MIT licensed.

The current Windows Local Manager is a 1,600+ line WinForms application that
combines:

- user-visible controls;
- device-link and device-session calls;
- Windows DPAPI token storage;
- signed installer download and UAC launch;
- connector capability configuration and verification;
- local n8n lifecycle controls;
- updates;
- desktop command polling and bounded local command execution.

Making Hermes itself the application root would also surrender product
lifecycle, recovery, and update authority to an upstream agent project. The
correct migration keeps MAD4B as the outer product shell, embeds Hermes as a
workspace, and separates all user experience from the privileged device-control
process.

## Direction comparison

| Concern | Hermes owns the container | MAD4B owns the container |
| --- | --- | --- |
| Product identity | Coupled to upstream structure | MAD4B-controlled |
| Update authority | Conflicts with Hermes self-update | One MAD4B signed channel |
| Recovery when Hermes fails | Recovery UI may fail with it | MAD4B recovery mode remains available |
| Replacing Hermes later | Expensive application rewrite | Replaceable workspace module |
| Device governance | Easy to blur into Hermes runtime | Explicit sidecar and platform boundary |
| Upstream adoption speed | Fastest initial prototype | Slightly more integration work |
| Long-term platform control | Weak | Strong |

The selected direction is MAD4B-owned container with embedded Hermes Surface.
A downstream Hermes Desktop fork is acceptable as an initial codebase only when
the first implementation step establishes MAD4B-owned identity, updates,
recovery mode, adapter boundaries, and provenance.

## Target process model

```text
MAD4B Local Desktop
|
|-- MAD4B application shell
|   |-- Identity, navigation, device recovery, updates, policy UX
|   |-- Hosts the vendored Hermes Surface workspace
|   `-- No device token, connector secret, shell, DPAPI, or UAC access
|
|-- Desktop main process
|   |-- Window lifecycle and restricted contextBridge
|   |-- Starts and supervises the MAD4B sidecar
|   `-- No raw device token or connector secret
|
|-- Hermes Surface workspace
|   |-- Chat, plans, sessions, jobs, models, agent interaction
|   `-- Replaceable module with no application-root authority
|
|-- MAD4B Local Manager sidecar
|   |-- Windows DPAPI CurrentUser token storage
|   |-- auth.mad4b.com device APIs
|   |-- signed installer download and UAC handoff
|   |-- connector repair, capability verification, and desktop commands
|   `-- typed local RPC with current-user ACL
|
|-- Local Connector service
|   |-- governed allowlisted device operations
|   `-- optional local model providers and local agent runtime
|
`-- Optional Hermes runtime profile
    |-- chat/session/skills experience
    `-- platform actions only through MAD4B governed tool adapters
```

## Component ownership

| Component | Owns | Must not own |
| --- | --- | --- |
| MAD4B application shell | Product navigation, identity UX, recovery UX, update UX, workspace hosting | Secrets, DPAPI, UAC, arbitrary native IPC |
| Hermes Surface workspace | Agent UX, streaming display, sessions, plan/job visualization | Application lifecycle, updates, recovery, secrets, privileged IPC |
| Desktop main | Process supervision, restricted IPC, window lifecycle | Platform authority, device token, connector secret |
| MAD4B sidecar | Device identity, DPAPI, signed installer handoff, device-scoped auth calls | General agent planning, arbitrary prompt execution |
| Local Connector | Allowlisted device execution and local runtime | Tenant/platform authority or raw platform credentials |
| `auth.mad4b.com` | Tenant/admin authority, tool discovery, policy, audit | Direct unmanaged local execution |
| Hermes runtime | Optional conversational and agent experience | Direct platform/database/provider authority outside governed adapters |

## Integration strategy

### Own the container and vendor the Surface

Maintain a MAD4B-owned desktop application that vendors a pinned, reviewed
Hermes Surface version as an internal workspace. Do not make the upstream Hermes
Desktop executable the product root, and do not copy isolated React screens
into the existing WinForms application.

The MAD4B container should:

- own product identity, application ID, icons, installer, and update channel;
- add MAD4B navigation and device/runtime settings;
- mount the Hermes workspace behind a restricted MAD4B adapter;
- expose a restricted `mad4bDesktop` preload bridge;
- disable upstream self-update in favor of a MAD4B-owned signed update channel;
- remove or permanently disable YOLO and approval-off controls;
- preserve upstream attribution and the MIT license;
- record the pinned upstream tag and commit in the build manifest.

Upstream updates must be imported deliberately, reviewed, tested, and promoted.
The application must never track or install upstream `main` automatically.

The practical implementation may begin from a downstream fork of Hermes
Desktop because it already provides a capable Electron shell. That is an
implementation shortcut, not an ownership decision: the distributed product,
outer navigation, update authority, recovery mode, and compatibility contract
remain MAD4B-owned.

### Extract the Local Manager sidecar

Split `apps/local-manager-windows/Program.cs` into:

- a reusable Local Manager core library;
- a headless per-user sidecar executable;
- a temporary legacy WinForms shell that calls the same core during migration.

Suggested modules:

| Module | Responsibility |
| --- | --- |
| `DeviceIdentityStore` | DPAPI CurrentUser save/load/delete and device metadata |
| `DeviceLinkClient` | pairing start/poll and device-session calls |
| `DeviceControlClient` | routes, backups, settings, n8n, and status |
| `SignedInstallerCoordinator` | download, validate, UAC launch, wait, verify |
| `ConnectorCapabilityVerifier` | live post-install capability readback |
| `DesktopCommandWorker` | bounded polling, execution, redaction, completion |
| `LocalRuntimeClient` | capabilities, providers, models, jobs, cancellation |
| `SidecarRpcServer` | typed requests, event stream, caller authentication |

The WinForms UI can be retired only after the Hermes container reaches feature
parity and recovery flows remain available.

## Local IPC contract

Use a Windows named pipe with an ACL restricted to the current Windows user.
Do not expose the privileged sidecar through a general localhost HTTP port.

The initial typed operation registry and validation contract is implemented in
`apps/local-manager-windows/SidecarRpcContracts.cs`. It is intentionally
transport-independent so the current WinForms application and the future
MAD4B-owned desktop container can share the same allowlist and action-specific
approval checks before the named-pipe server is introduced.

The bounded current-user-only named-pipe transport skeleton is implemented in
`apps/local-manager-windows/SidecarRpcServer.cs`. It validates the operation and
action-specific approval before dispatch, rejects oversized requests, validates
successful result envelopes for forbidden secret-like fields, and redacts
sensitive failure text. It is not started by the WinForms application yet and
has no privileged operation dispatcher in this phase.

The MAD4B shell and embedded Hermes workspace call a narrow `mad4bDesktop`
context bridge. The desktop main process validates input and forwards typed
requests to the sidecar.

Example renderer-visible operations:

```text
device.getStatus
device.startLink
device.forget
connector.getControls
connector.requestRepair
connector.requestCapabilities
runtime.getCapabilities
runtime.getRecommendations
runtime.updateSettings
runtime.installProvider
runtime.installModel
runtime.runApprovedJob
runtime.getJob
runtime.cancelJob
```

Forbidden renderer-visible operations:

```text
device.getToken
connector.getSecret
installer.getSignedUrl
shell.execute
process.spawn
dpapi.decrypt
auth.callArbitraryUrl
```

Every mutation request must carry an action-specific approval value. A generic
"user approved" value must not authorize installation, settings mutation,
delegation, fallback, or UAC handoff together.

## Authentication and authority

The MAD4B sidecar stores the device-scoped token with Windows DPAPI CurrentUser.
It uses that token only for device-owned Local Manager routes.

The token must not cross the named pipe. Sidecar responses expose only redacted
device status and `secrets_included=false`.

Tenant and admin platform actions continue to use `auth.mad4b.com` list-before-
call governance. Hermes MCP, plugin, skill, or gateway integrations must call a
MAD4B governed adapter, not platform routes, databases, or providers directly.

The Surface may display approval prompts. The authoritative approval decision
must be evaluated again by the sidecar or platform API at execution time.

## Hermes runtime modes

The container should expose three separately controlled workspace modes:

| Mode | Hermes role | Execution authority |
| --- | --- | --- |
| `surface_only` | Embedded Hermes UX for MAD4B platform and Local Manager | MAD4B platform + sidecar |
| `hermes_local_assistant` | Optional local conversational runtime | Hermes for conversation; MAD4B adapters for platform actions |
| `hermes_remote_assistant` | Optional remote Hermes gateway profile | Remote Hermes for conversation; MAD4B adapters for platform actions |

`surface_only` must be the initial and safest integration target.

Enabling a Hermes assistant must not automatically enable tools, skills, cron,
memory synchronization, local shell, or multi-agent delegation.

## Provider and multi-agent integration

The provider picker should present MAD4B runtime providers from
`POST /agent-runtime` capability discovery. Hermes-native provider settings may
remain available only inside an explicitly enabled Hermes assistant profile.

MAD4B local multi-agent jobs remain governed by:

- `execution_target=local_device`;
- `delegation_approved=true`;
- `delegation_mode=manual_api`;
- meaningful `delegation_reason`;
- an explicit model, agent list, and concurrency limit.

Hermes Kanban and sub-agent UI may visualize MAD4B jobs, but it must not silently
translate card creation into execution. Dispatch remains a separate explicit
action.

## Memory, skills, cron, and tools

Hermes memory and MAD4B tenant memory are separate authorities.

- Local Hermes memory is private to the selected local profile.
- Import into tenant memory requires an explicit reviewed action.
- Tenant memory must never be exported into Hermes automatically.
- Hermes-created skills start disabled for MAD4B platform actions.
- Hermes cron starts disabled.
- MCP and plugin tools must be allowlisted per profile.
- Platform tools are exposed through a MAD4B adapter with list-before-call,
  tenant scope, action approval, and audit evidence.

## Update and supply-chain policy

The combined desktop application needs one update authority.

- MAD4B signs and distributes the downstream desktop build.
- The build manifest records Hermes upstream tag/commit and MAD4B commit.
- Upstream Hermes self-update is disabled.
- Sidecar and desktop compatibility versions are checked before startup.
- A failed desktop update must not remove the sidecar recovery path.
- Sidecar updates remain signed and rollback-capable.
- All upstream imports require license, dependency, security, and behavior
  review before promotion.

## Migration phases

### Phase 0: architecture lock

- Pin the reviewed Hermes upstream tag.
- Record the MIT attribution.
- Define sidecar RPC schemas and threat model.
- Add regression tests around current Local Manager behavior before extraction.

### Phase 1: sidecar extraction

- Extract DPAPI, device link, controls, installer, verification, command worker,
  and local runtime clients from WinForms.
- Keep the existing WinForms UI using the extracted core.
- Add named-pipe RPC tests and ensure secrets never cross the pipe.

### Phase 2: MAD4B container with Surface-only workspace

- Build the MAD4B-owned desktop shell and vendor the pinned Hermes Surface.
- Add MAD4B sign-in, device status, connector controls, and runtime settings.
- Run with Hermes agent, shell, cron, memory sync, and tool execution disabled.
- Preserve legacy WinForms recovery access during beta.

### Phase 3: local runtime experience

- Add provider discovery, device sizing, model recommendations, installation,
  multi-agent job display, cancellation, and execution-log views.
- Keep all mutations action-specific and approval-gated.

### Phase 4: optional Hermes assistant

- Add a MAD4B governed tool adapter.
- Permit Hermes chat/runtime profiles only after tool, memory, cron, and skill
  controls are independently configurable and default-deny.
- Certify tenant isolation and action audit evidence.

### Phase 5: managed rollout

- Signed installer, staged update channel, rollback, telemetry, and recovery.
- Retire the WinForms UI only after parity and recovery certification.

## Acceptance criteria

- The Electron renderer and Hermes runtime cannot read the device token,
  connector secret, signed installer token, or backend credential.
- Sidecar RPC rejects unknown operations and callers outside the current user.
- YOLO and approval-off modes are unavailable in the MAD4B build.
- Platform actions use `auth.mad4b.com` list-before-call.
- Local runtime endpoints remain localhost-only.
- Installation, settings, delegation, fallback, UAC, memory export, skill
  activation, and cron activation remain separate explicit actions.
- Device linking, repair, capability install, update, n8n, desktop commands,
  provider discovery, model recommendation, jobs, cancellation, and recovery
  have parity evidence.
- The MAD4B build records vendored Hermes and MAD4B provenance.
- The legacy recovery path remains available until the combined application is
  certified.

## Stop conditions

Do not proceed from Surface-only integration to Hermes assistant enablement if
any of the following remain true:

- secrets can cross renderer, plugin, skill, or Hermes runtime boundaries;
- platform tools can bypass `auth.mad4b.com`;
- Hermes approval-off or YOLO behavior is reachable;
- desktop and sidecar update authorities conflict;
- Local Manager recovery parity is incomplete;
- tenant/profile isolation is not proven.
