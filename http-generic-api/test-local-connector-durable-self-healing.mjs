import { readFileSync } from "node:fs";

const installerSource = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
const watchdogSource = readFileSync("../local-connector/connector-watchdog.ps1", "utf8");

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
  "watchdog ensures cloudflared and connector services are running",
  watchdogSource.includes("Ensure-ServiceRunning $CloudflaredService") &&
    watchdogSource.includes("Ensure-ServiceRunning $ConnectorService")
);
assert(
  "watchdog preserves legacy cloudflared service until live migration is certified",
  watchdogSource.includes('[string]$CloudflaredService = "cloudflared"') &&
    watchdogSource.includes('Get-DotEnvValue "CONNECTOR_CLOUDFLARED_SERVICE"')
);
assert(
  "watchdog can bind to a future explicitly owned connector transport service",
  watchdogSource.includes('$CloudflaredService = $configuredCloudflaredService') &&
    watchdogSource.includes("^[A-Za-z0-9_.-]{1,128}$")
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

console.log(`durable self-healing assertions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
