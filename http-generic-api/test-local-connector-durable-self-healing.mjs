import nodeAssert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { _testingLocalConnectorInstallerDelegation as installerDelegation } from "./routes/localConnectorInstallerDelegationRoutes.js";

const installerSource = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
const watchdogSource = readFileSync("../local-connector/connector-watchdog.ps1", "utf8");
const indexSource = readFileSync("routes/index.js", "utf8");
const agentSource = readFileSync("routes/connectorAgentRoutes.js", "utf8");
const connectorServerSource = readFileSync("../local-connector/server.mjs", "utf8");
const browser4Source = readFileSync("../local-connector/browser4-adapter.mjs", "utf8");
const connectorReadme = readFileSync("../local-connector/README.md", "utf8");

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

const delegationEnv = { BACKEND_API_KEY: "test-backend-key" };
function signInstallerPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", delegationEnv.BACKEND_API_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

const installerToken = signInstallerPayload({
  user_id: "u1",
  tenant_id: "t1",
  device_id: "device-1",
  format: "bat",
  capabilities: ["windows_control"],
  permission_grants: { allowed_paths: ["C:\\work"] },
  app_managed: true,
  exp: Math.floor(Date.now() / 1000) + 600,
});
const installerPayload = installerDelegation.decodeAndVerifyInstallerToken(installerToken, delegationEnv);
nodeAssert.equal(installerPayload.format, "bat");
nodeAssert.equal(installerPayload.device_id, "device-1");

const ps1Token = installerDelegation.signInstallerToken({ ...installerPayload, format: "ps1" }, delegationEnv);
const ps1Payload = installerDelegation.decodeAndVerifyInstallerToken(ps1Token, delegationEnv);
nodeAssert.equal(ps1Payload.format, "ps1");
nodeAssert.deepEqual(ps1Payload.permission_grants, installerPayload.permission_grants);
nodeAssert.deepEqual(ps1Payload.capabilities, installerPayload.capabilities);
nodeAssert.equal(ps1Payload.exp, installerPayload.exp);

const canonicalBootstrapBat = installerDelegation.buildCanonicalBootstrapBat({
  ps1Url: `https://dev.mad4b.com/connector-agent/installer.ps1?token=${encodeURIComponent(ps1Token)}`,
  deviceId: installerPayload.device_id,
  appManaged: true,
});
nodeAssert.match(canonicalBootstrapBat, /connector-agent\/installer\.ps1/);
nodeAssert.match(canonicalBootstrapBat, /Canonical Local Connector installer/);
nodeAssert.doesNotMatch(canonicalBootstrapBat, /cloudflared service install/i);
nodeAssert.doesNotMatch(canonicalBootstrapBat, /nssm install Mad4B-LocalConnector-Cloudflared/i);
nodeAssert.doesNotMatch(canonicalBootstrapBat, /Start-Service cloudflared/i);
nodeAssert.throws(
  () => installerDelegation.decodeAndVerifyInstallerToken(`${installerToken}tampered`, delegationEnv),
  /Invalid installer download token/,
);
nodeAssert.throws(
  () => installerDelegation.decodeAndVerifyInstallerToken(signInstallerPayload({ format: "bat", exp: 1 }), delegationEnv),
  /expired/,
);

const delegationMount = indexSource.indexOf("app.use(buildLocalConnectorInstallerDelegationRoutes");
const legacyMount = indexSource.indexOf("app.use(buildLocalConnectorInstallRoutes(deps))");
nodeAssert.ok(delegationMount >= 0, "canonical delegation router must be mounted");
nodeAssert.ok(legacyMount > delegationMount, "canonical delegation router must precede legacy installer routes");
nodeAssert.match(agentSource, /\$CfService = 'Mad4B-LocalConnector-Cloudflared'/);
nodeAssert.match(agentSource, /CONNECTOR_CLOUDFLARED_SERVICE=Mad4B-LocalConnector-Cloudflared/);
nodeAssert.match(agentSource, /CONNECTOR_CLOUDFLARED_METRICS=127\.0\.0\.1:49313/);
nodeAssert.match(agentSource, /cloudflared-token\.txt/);
nodeAssert.doesNotMatch(agentSource, /cloudflared service install/);
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
