# MAD4B Desktop Device Workspace — Windows app integration

**Status:** Source-stage Windows Forms integration, not a signed or certified Windows release.

## How it works

A new **Device workspace** button opens a separate window inside the existing MAD4B Local Manager application (not a separate Desktop Commander installation). It targets only the loopback `http://127.0.0.1:7070` Local Connector. The administrator manually supplies their **current** Connector device ID, Connector credential, and, when necessary, separate local write and interactive terminal approvals.

The UI calls established Local Connector routes, never the Production cloud API or Hostinger directly:
- `GET /recovery/capabilities` — current feature/capability inventory.
- `POST /device/files` — list, read, info, search, atomic patch, rollback.
- `POST /device/terminal` — start/list/input/output/resume/cancel/close sessions, plus owned process list/status/terminate.

Approval values are sent as local headers, never JSON tool arguments. All credentials remain in memory during the opened form and are cleared when the form closes. They are **not** saved to an application config file or transmitted to GitHub. A file read or terminal transcript can contain secrets and is displayed only locally; the app must be used on a trusted Windows profile.

## Risk and identity limits

- Existing Connector/Admin and independent OAuth MCP boundaries are unchanged.
- Only device ID matching the local Connector identity is accepted; the UI does not select a stale or guessed device automatically.
- WinForms UI is not an authorization service. The local Connector independently checks exact device ID, allowlisted path, feature flags, SHA, active session, and separate local approval.
- Windows protected OS services and arbitrary PIDs cannot be killed using the workspace process tab.
- Native MCP does not inherit the Connector credential from the desktop; its token is separately signed and scoped.
- This implementation has **no secure Sidecar credential delegation yet**. Long-term UX parity requires moving session approvals and credential access into an OS-private Sidecar boundary, rather than manual credentials typed for each UI session.

## Verification required

1. `dotnet build apps/local-manager-windows/Mad4B.LocalManager.Windows.csproj -p:LocalManagerEnvironment=staging` on Windows, including UI startup.
2. `node --test http-generic-api/test-desktop-device-workspace-wiring.mjs`.
3. Install the signed Staging Local Connector package; confirm all runtime assets and tool capability flags remain OFF initially.
4. Run local file search/preview/patch/rollback including conflict and symlink-denial cases.
5. Start and cancel a Git status process. If interactive mode is explicitly approved, test PowerShell STDIN and bounded output, then close the form and ensure approval is not reused.
6. Verify `/mcp/device` rejects the Connector credential and accepts only properly scoped OAuth bearer from a live issuer.
7. Test two client sessions, interruption/restart and live process ownership; no Production mutation.

**Not achieved yet:** ConPTY/true PTY, active process reattachment after a Connector restart, remote interactive MCP approval flow, general file upload/move/rename/copy, desktop automatic device discovery, dedicated DOCX/XLSX/PDF adapters, Windows build/signing/operational certification.

No merge, deployment, device permissions change, or Production activation is authorized by this document.
