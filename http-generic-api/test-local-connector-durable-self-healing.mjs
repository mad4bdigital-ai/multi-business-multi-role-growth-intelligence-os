import nodeAssert from "node:assert/strict";
import { readFileSync } from "node:fs";

const installerSource = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
const watchdogSource = readFileSync("../local-connector/connector-watchdog.ps1", "utf8");
const indexSource = readFileSync("routes/index.js", "utf8");
const agentSource = readFileSync("routes/connectorAgentRoutes.js", "utf8");
const connectorServerSource = readFileSync("../local-connector/server.mjs", "utf8");
const browser4Source = readFileSync("../local-connector/browser4-adapter.mjs", "utf8");
const connectorReadme = readFileSync("../local-connector/README.md", "utf8");
const installerCapabilitySource = readFileSync("localConnectorInstallerCapability.js", "utf8");
const localManagerDeviceSource = readFileSync("services/localManagerDeviceLinkService.js", "utf8");
const runtimeBootstrapSource = readFileSync("../local-connector/connector-runtime-bootstrap.mjs", "utf8");

let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`[PASS] ${label}`);
    passed += 1;
    return;
  }
  console.error(`[FAIL] ${label}`);
  failed += 1;
}

assert(
  "watchdog leaves a healthy running service untouched",
  watchdogSource.includes("if ($svc.Status -eq 'Running') { return $true }")
);
assert(
  "watchdog no longer restarts cloudflared on every tick",
  !watchdogSource.includes("Restart-ServiceSafe $CloudflaredService | Out-Null")
);
assert(
  "watchdog ensures Local Connector-owned transport and connector runtimes are running",
  watchdogSource.includes("Ensure-RuntimeRunning $CloudflaredService $CloudflaredTask") &&
    watchdogSource.includes("Ensure-RuntimeRunning $ConnectorService $ConnectorTask")
);
assert(
  "watchdog binds transport ownership to the canonical Local Connector runtime",
  watchdogSource.includes('[string]$CloudflaredService = "Mad4B-LocalConnector-Cloudflared"') &&
    watchdogSource.includes('$CanonicalCloudflaredRuntime = "Mad4B-LocalConnector-Cloudflared"') &&
    watchdogSource.includes('$CloudflaredService = $CanonicalCloudflaredRuntime') &&
    watchdogSource.includes('$CloudflaredTask = $CanonicalCloudflaredRuntime') &&
    !watchdogSource.includes('[string]$CloudflaredService = "cloudflared"')
);
assert(
  "watchdog rejects noncanonical connector transport ownership",
  watchdogSource.includes("ownership_binding_rejected field=CONNECTOR_CLOUDFLARED_SERVICE") &&
    watchdogSource.includes("ownership_binding_rejected field=CONNECTOR_CLOUDFLARED_TASK") &&
    watchdogSource.includes("Test-TransportOwnershipBinding $CloudflaredService $CloudflaredTask")
);
assert(
  "watchdog heartbeat is environment-bound and has no Production fallback",
  watchdogSource.includes('Get-DotEnvValue "CONNECTOR_ENVIRONMENT"') &&
    watchdogSource.includes('"production" { "auth.mad4b.com" }') &&
    watchdogSource.includes('"staging" { "dev.mad4b.com" }') &&
    watchdogSource.includes("Test-HeartbeatBinding $heartbeatUrl") &&
    !watchdogSource.includes('$heartbeatUrl = "https://auth.mad4b.com/connector-agent/heartbeat"')
);
assert(
  "watchdog fails closed when environment heartbeat binding is invalid",
  watchdogSource.includes("heartbeat_skipped reason=environment_binding_invalid")
);
assert(
  "watchdog writes a secret-free runtime state snapshot",
  watchdogSource.includes("connector-runtime-state.json") &&
    watchdogSource.includes("connector_environment = $binding.environment") &&
    watchdogSource.includes("cloudflared_service = $CloudflaredService") &&
    watchdogSource.includes("secrets_included = $false")
);
assert(
  "watchdog records manual intervention after restart and rollback fail",
  watchdogSource.includes("manual_required") &&
    watchdogSource.includes("health remained unavailable after restart and rollback")
);

assert(
  "PowerShell installer requires local-connector service Running state",
  installerSource.includes("local-connector service did not reach Running state") &&
    installerSource.includes("WaitForStatus('Running'")
);
assert(
  "PowerShell installer requires local health before success",
  installerSource.includes("for ($attempt = 1; $attempt -le 12; $attempt++)") &&
    installerSource.includes("local connector health check failed after service start")
);
assert(
  "batch installer also requires local health before success",
  installerSource.includes("for /L %%i in (1,1,12)") &&
    installerSource.includes("ERROR: local connector health check failed")
);
assert(
  "installer configures automatic recovery for both Windows services",
  installerSource.includes("sc.exe failure $NodeService") &&
    installerSource.includes("sc.exe failure $CfService") &&
    installerSource.includes("AppExit Default Restart")
);
assert(
  "installer avoids PowerShell 7-only null conditional service syntax",
  !installerSource.includes("$nodeSvc?.Status")
);
assert(
  "installer runtime diagnostics remain secret-free",
  installerSource.includes("connector-runtime-state.json") &&
    installerSource.includes("secrets_included = $false")
);

const downloadRouteOccurrences = installerSource.match(/router\.get\("\/local-connector\/install\/download"/g) || [];
nodeAssert.equal(downloadRouteOccurrences.length, 1, "installer download path must have exactly one route owner");
nodeAssert.doesNotMatch(indexSource, /localConnectorInstallerDelegationRoutes|buildLocalConnectorInstallerDelegationRoutes/);
const downloadStart = installerSource.indexOf('// ── GET /local-connector/install/download');
const downloadEnd = installerSource.indexOf('// ── POST /local-connector/install', downloadStart);
nodeAssert.ok(downloadStart >= 0 && downloadEnd > downloadStart, "canonical installer download handler must be discoverable");
const downloadHandlerSource = installerSource.slice(downloadStart, downloadEnd);
nodeAssert.match(downloadHandlerSource, /connector-agent\/installer\.ps1/);
nodeAssert.match(downloadHandlerSource, /res\.redirect\(307, canonicalUrl\)/);
nodeAssert.match(downloadHandlerSource, /buildInstallPowerShellBootstrapBat/);
nodeAssert.match(downloadHandlerSource, /X-Mad4B-Installer-Delegation/);
nodeAssert.doesNotMatch(downloadHandlerSource, /connector_secret|cf_token/);
nodeAssert.doesNotMatch(downloadHandlerSource, /buildInstallPowerShell\s*\(/);
nodeAssert.doesNotMatch(downloadHandlerSource, /cloudflared service install/i);
nodeAssert.match(downloadHandlerSource, /SELECT config_id, device_id/);
nodeAssert.doesNotMatch(downloadHandlerSource, /SELECT[^\n]*(?:connector_secret|cf_token)/i);

nodeAssert.match(installerSource, /createInstallerCapability/);
nodeAssert.match(installerSource, /assertNoInstallerAuthorityOverrides/);
nodeAssert.match(installerSource, /config_id: config\.config_id/);
nodeAssert.match(downloadHandlerSource, /WHERE config_id = \? AND user_id = \? AND tenant_id = \? AND device_id = \?/);
nodeAssert.doesNotMatch(installerSource, /permission_grants:\s*permissionGrants/);
nodeAssert.match(installerCapabilitySource, /LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE = "local_connector_installer_download"/);
nodeAssert.match(installerCapabilitySource, /LOCAL_CONNECTOR_INSTALLER_REDEEM_PURPOSE = "local_connector_installer_secret_redeem"/);
nodeAssert.match(installerCapabilitySource, /aud:\s*"connector_agent"/);
nodeAssert.match(installerCapabilitySource, /jti:\s*randomUUID\(\)/);
nodeAssert.match(installerCapabilitySource, /LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS = 10 \* 60/);
nodeAssert.match(installerCapabilitySource, /installer_permission_grants_server_managed/);
nodeAssert.match(agentSource, /claimInstallerCapability/);
nodeAssert.match(agentSource, /local_connector_recovery_events/);
nodeAssert.match(agentSource, /installer_capability_replayed/);
nodeAssert.match(agentSource, /router\.post\("\/connector-agent\/installer\/redeem"/);
nodeAssert.match(agentSource, /Authorization = \\"Bearer \$RedeemToken/);
nodeAssert.doesNotMatch(agentSource, /material=runtime_credentials/);
nodeAssert.match(agentSource, /permissionGrants:\s*dbGrants/);
nodeAssert.doesNotMatch(agentSource, /mergePermissionGrants\(dbGrants,\s*payload\.permission_grants/);
nodeAssert.match(agentSource, /WHERE config_id = \? AND user_id = \? AND tenant_id = \? AND device_id = \? AND is_enabled = 1/);
nodeAssert.match(agentSource, /Protect-ConnectorSecretDirectory \$SecretsRoot/);
nodeAssert.match(agentSource, /CONNECTOR_SECRET_FILE=\$ConnectorSecretFile/);
nodeAssert.match(agentSource, /CONNECTOR_LOCAL_API_KEY_FILE=\$ConnectorLocalApiKeyFile/);
nodeAssert.doesNotMatch(agentSource, /`CONNECTOR_SECRET=\$\{connectorSecret\}`/);
nodeAssert.match(agentSource, /cloudflared_token_file_unsupported_version/);
nodeAssert.match(agentSource, /\[version\]'2025\.4\.0'/);
nodeAssert.doesNotMatch(agentSource, /publicBaseUrl\(req\)/);
nodeAssert.match(runtimeBootstrapSource, /CONNECTOR_SECRET_FILE/);
nodeAssert.match(runtimeBootstrapSource, /CONNECTOR_LOCAL_API_KEY_FILE/);
nodeAssert.match(localManagerDeviceSource, /PRIVILEGED_DEVICE_AUTH_MAX_AGE_SECONDS = DEVICE_TOKEN_TTL_SECONDS/);
nodeAssert.doesNotMatch(localManagerDeviceSource, /privileged_installer_reauth_required/);
nodeAssert.match(localManagerDeviceSource, /requires_reauth_for_privileged_installers:\s*false/);

nodeAssert.match(agentSource, /\$CfService = 'Mad4B-LocalConnector-Cloudflared'/);
nodeAssert.match(agentSource, /CONNECTOR_CLOUDFLARED_SERVICE=Mad4B-LocalConnector-Cloudflared/);
nodeAssert.match(agentSource, /CONNECTOR_CLOUDFLARED_METRICS=127\.0\.0\.1:49313/);
nodeAssert.match(agentSource, /cloudflared-token\.txt/);
nodeAssert.doesNotMatch(agentSource, /cloudflared service install/);
nodeAssert.doesNotMatch(installerSource, /CONNECTOR_SECRET=|CONNECTOR_LOCAL_API_KEY=|cloudflared service install ["'`]?\s*\+?\s*(?:cfToken|tunnelToken)/);
nodeAssert.match(agentSource, /connector-environment-policy\.mjs/);
nodeAssert.match(agentSource, /connector-runtime-bootstrap\.mjs/);
nodeAssert.match(connectorServerSource, /import ['"]\.\/connector-runtime-bootstrap\.mjs['"];?/);
nodeAssert.doesNotMatch(browser4Source, /connector-runtime-bootstrap\.mjs/);
nodeAssert.match(watchdogSource, /Mad4B-LocalConnector-Cloudflared/);
nodeAssert.match(watchdogSource, /Mad4B-Staging-Cloudflared/);
nodeAssert.match(connectorReadme, /shared Admin Recovery transport/);
nodeAssert.match(connectorReadme, /Mad4B-LocalConnector-Cloudflared/);
nodeAssert.match(connectorReadme, /staging` → `dev\.mad4b\.com/);
nodeAssert.match(connectorReadme, /production` → `auth\.mad4b\.com/);
nodeAssert.match(connectorReadme, /Do not treat a generic Windows service named `cloudflared` as Connector-owned/);

console.log(`durable self-healing assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
