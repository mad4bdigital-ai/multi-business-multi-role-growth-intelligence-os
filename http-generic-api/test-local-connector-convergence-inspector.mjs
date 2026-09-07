import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inspector = readFileSync("../local-connector/Get-LocalConnectorConvergence.ps1", "utf8");

for (const marker of [
  "duplicate_agent_runtime",
  "duplicate_tunnel_runtime",
  "duplicate_watchdog_runtime",
  "runtime_root_drift",
  "identity_missing",
  "cross_runtime_binding",
  "credential_values_read=$false",
  "mutations_executed=$false",
  "secrets_included=$false",
]) assert.ok(inspector.includes(marker), `missing convergence marker: ${marker}`);

for (const forbidden of ["Restart-Service", "Start-Service", "Stop-Service", "Register-ScheduledTask", "Set-Dns", "Remove-Item"])
  assert.equal(inspector.includes(forbidden), false, `read-only inspector must not contain ${forbidden}`);

console.log("local connector convergence inspector contract tests passed");

const watchdog = readFileSync("../local-connector/connector-watchdog.ps1", "utf8");
const stagingRepair = readFileSync("../autopilot-portable-staging/Repair-LocalConnectorTunnel.ps1", "utf8");
for (const source of [watchdog, stagingRepair]) {
  for (const marker of ["dns_resolution_failed", "identity_invalid", "identity_binding_mismatch", "tunnel_restart_allowed"])
    assert.ok(source.includes(marker), `component-aware health classifier missing ${marker}`);
  assert.match(source, /tunnel_restart_allowed\)?/);
}
