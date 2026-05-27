import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const connectorAgent = readFileSync('routes/connectorAgentRoutes.js', 'utf8');
const localManager = readFileSync('routes/localManagerBetaRoutes.js', 'utf8');
const installRoutes = readFileSync('routes/localConnectorInstallRoutes.js', 'utf8');
const proxyRoutes = readFileSync('routes/connectorProxyRoutes.js', 'utf8');
const localManagerWindows = readFileSync('../apps/local-manager-windows/Program.cs', 'utf8');
const localManagerProject = readFileSync('../apps/local-manager-windows/Mad4B.LocalManager.Windows.csproj', 'utf8');

assert(connectorAgent.includes('const AGENT_VERSION = "2026.05.26.1"'), 'connector agent version must move for Local Manager tool releases');
assert(connectorAgent.includes('"browser4-adapter.mjs"'), 'Browser4 adapter must be shipped by connector-agent manifest');
assert(connectorAgent.includes('LOCAL_TOOL_RELEASES'), 'connector-agent manifest must define local tool releases');
assert(connectorAgent.includes('owner_app: "mad4b-local-manager"'), 'Local Manager must own local tool releases');
assert(connectorAgent.includes('release_model: "manifest_driven_allowlisted_tools"'), 'manifest must declare allowlisted tool release model');
assert(connectorAgent.includes('CONNECTOR_BROWSER4_ENABLED=true'), 'installer env must enable Browser4 through Local Manager release');
assert(connectorAgent.includes('BROWSER4_ALLOWED_HOSTS=mad4b.com,n8n.mad4b.com'), 'Browser4 install must preserve connector-side domain allowlist');
assert(connectorAgent.includes("Get-Mad4BManifestFile -Name 'browser4-adapter.mjs'"), 'installer must install manifest-declared Browser4 adapter file');
assert(connectorAgent.includes('local_tool_release_owner: "mad4b-local-manager"'), 'upgrade policy must identify Local Manager as tool release owner');

assert(localManager.includes('local release owner for platform tools'), 'public app page must explain Local Manager tool release ownership');
assert(localManager.includes('manifest-driven local tool installation'), 'link flow must explain manifest-driven local tool installation');
assert(localManager.includes('Mad4B Local Manager Admin Tools'), 'admin page must distinguish governed installer tools');
assert(localManager.includes('LOCAL_MANAGER_WINDOWS_LATEST_VERSION = "0.2.12"'), 'public Local Manager update route must advertise Windows 0.2.12');
assert(localManager.includes('Mad4B-Local-Manager-Setup-0.2.12.exe'), 'public Local Manager download route must point at Windows 0.2.12 assets');
assert(localManagerProject.includes('<Version>0.2.12</Version>'), 'Windows project Version must match advertised release');
assert(localManagerProject.includes('<AssemblyVersion>0.2.12.0</AssemblyVersion>'), 'Windows project AssemblyVersion must match advertised release');
assert(localManagerProject.includes('<FileVersion>0.2.12.0</FileVersion>'), 'Windows project FileVersion must match advertised release');
assert(localManagerProject.includes('<InformationalVersion>0.2.12-app-managed-installer-bootstrap</InformationalVersion>'), 'Windows project InformationalVersion must identify the app-managed installer bootstrap fix');

assert(installRoutes.includes('LOCAL_CONNECTOR_CAPABILITY_FLAGS'), 'installer route must define explicit capability flag mapping');
assert(installRoutes.includes('powershell_admin: "CONNECTOR_POWERSHELL_ENABLED"'), 'PowerShell capability must map only through explicit opt-in');
assert(installRoutes.includes('windows_control: "CONNECTOR_WIN_ENABLED"'), 'Windows control capability must map only through explicit opt-in');
assert(installRoutes.includes('normalizePermissionGrants'), 'installer route must normalize dynamic permission grants');
assert(installRoutes.includes('/[\\n\\r<>|?*&^%!]/.test(raw)'), 'dynamic Windows paths must reject CMD metacharacters before installer rendering');
assert(installRoutes.includes('CONNECTOR_APP_ALLOWLIST'), 'installer route must support dynamic app allowlist grants');
assert(installRoutes.includes('CONNECTOR_FILE_PATHS'), 'installer route must support dynamic file path grants');
assert(installRoutes.includes('shell_aliases'), 'installer route must support dynamic helper shell alias grants');
assert(installRoutes.includes('normalizePermissionGrants({ ...(req.body?.permission_grants || {}), capabilities: req.body?.capabilities || [] })'), 'device-scoped installer link must normalize requested permission grants');
assert(installRoutes.includes('permission_grants: permissionGrants'), 'installer download token must propagate permission grants without secrets');
assert(!installRoutes.includes('CONNECTOR_POWERSHELL_ENABLED=true",'), 'PowerShell must not be enabled by default in base connector env');
assert(!installRoutes.includes('CONNECTOR_WIN_ENABLED=true",'), 'Windows control must not be enabled by default in base connector env');

assert(proxyRoutes.includes('code: "DISABLED"'), 'connector proxy must preserve disabled capability errors');
assert(proxyRoutes.includes('connector_capability_status: "disabled"'), 'connector proxy response must classify disabled capability state');

assert(localManagerWindows.includes('RunElevatedInstallerAndVerifyAsync'), 'Windows app must run connector installers through an in-app elevated workflow');
assert(localManagerWindows.includes('RefreshDeviceControlsAfterInstallerAsync'), 'Windows app must refresh device controls after installer execution');
assert(localManagerWindows.includes('WaitForExitAsync'), 'Windows app must wait for elevated installer completion when possible');
assert(localManagerWindows.includes('UAC prompt'), 'Windows app must clearly explain local Administrator approval');
assert(localManagerWindows.includes('installer_applied = false'), 'Windows app must handle cancelled UAC prompts explicitly');
assert(localManagerWindows.includes('installer_launching = true'), 'Windows app must show sanitized installer launch diagnostics');
assert(localManagerWindows.includes('connector capability installer'), 'Windows app must apply the capability installer, not just download it');
assert(localManagerWindows.includes('RegisterDesktopCommandPollFailure'), 'Windows app must back off transient desktop command polling failures');
assert(localManagerWindows.includes('_desktopCommandPollBackoffUntil'), 'Windows app must track desktop command polling backoff state');
assert(localManagerWindows.includes('Desktop command polling paused'), 'Windows app must show paused polling instead of noisy repeated failures');
assert(localManagerWindows.includes('secrets_included = false'), 'desktop polling diagnostics must remain secret-safe');
assert(localManagerWindows.includes('Capabilities'), 'Windows app must expose capability choices');
assert(localManagerWindows.includes('ConfigureConnectorCapabilitiesAsync'), 'Windows app must request capability installer from user action');
assert(localManagerWindows.includes('powershell_admin'), 'Windows app must support PowerShell capability selection');
assert(localManagerWindows.includes('windows_control'), 'Windows app must support Windows control capability selection');
assert(localManagerWindows.includes('permission_grants'), 'Windows app must send dynamic permission grants');
assert(localManagerWindows.includes('OpenFileDialog'), 'Windows app must let users choose app/helper executables locally');
assert(localManagerWindows.includes('FolderBrowserDialog'), 'Windows app must let users choose allowed paths locally');
assert(localManagerWindows.includes('PickInstalledApp'), 'Windows app must provide installed-app discovery for easier app grants');
assert(localManagerWindows.includes('Registry.CurrentUser') && localManagerWindows.includes('Registry.LocalMachine'), 'installed-app discovery must read per-user and machine uninstall registries');
assert(localManagerWindows.includes('RunAsAdminRequired'), 'Windows app must surface local Administrator requirement');

console.log('local manager tool release owner tests passed');
