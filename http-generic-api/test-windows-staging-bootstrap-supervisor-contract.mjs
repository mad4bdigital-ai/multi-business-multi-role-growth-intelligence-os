import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const supervisor = read("autopilot-portable-staging/Windows-Staging-Bootstrap-Supervisor.ps1");
const connectorRepair = read("autopilot-portable-staging/Repair-LocalConnectorTunnel.ps1");
const healthMonitor = read("autopilot-portable-staging/Staging-HealthMonitor.ps1");
const windowsPreflight = read("autopilot-portable-staging/Staging-Windows-Preflight.ps1");
const installer = read("autopilot-portable-staging/Install-AutoDeployTask.ps1");
const manifestGenerator = read("http-generic-api/scripts/generate-portable-staging-manifest.mjs");

assert.match(windowsPreflight, /function Ensure-StagingDockerDesktopReady/);
assert.match(windowsPreflight, /docker info --format '\{\{\.ServerVersion\}\}'/);
assert.match(windowsPreflight, /Docker Desktop\.exe/);
assert.match(windowsPreflight, /docker_engine_start_timeout/);
assert.doesNotMatch(windowsPreflight, /Get-Process[^\n]+Docker Desktop[^\n]+return \$true/);

assert.match(installer, /Windows-Staging-Bootstrap-Supervisor\.ps1/);
assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
assert.match(installer, /\.Delay = "PT\$\{LogonDelaySeconds\}S"/);
assert.match(installer, /-RestartCount 3/);
assert.match(installer, /-RestartInterval \(New-TimeSpan -Minutes 1\)/);
assert.match(installer, /-MultipleInstances IgnoreNew/);
assert.match(installer, /-RunLevel Highest/);

assert.match(healthMonitor, /deployment-lease\.json/);
assert.match(healthMonitor, /source = "deployment_lease"/);
assert.match(healthMonitor, /status = "bootstrapping"/);
assert.match(healthMonitor, /transient startup health state suppressed inside bounded grace/);
assert.match(healthMonitor, /staging_tunnel/);
assert.match(healthMonitor, /local_connector_tunnel/);
assert.match(healthMonitor, /connector\.mad4b\.com/);
assert.match(healthMonitor, /cloudflare_1033/);
assert.match(healthMonitor, /\$runtimeDetected = \$snapshot\.runtime -ne "none"/);
assert.match(healthMonitor, /\$snapshot\.expected = \[bool\]\(\$expectedFromRuntime -or \$expectedFromEnv -or \$runtimeDetected\)/);
assert.match(healthMonitor, /\$state\.failure_class = ""/);
assert.match(healthMonitor, /last_failure_class/);

assert.match(connectorRepair, /Resolve-Runtime/);
assert.match(connectorRepair, /kind = "service"/);
assert.match(connectorRepair, /kind = "scheduled_task"/);
assert.match(connectorRepair, /Restart-Runtime/);
assert.match(connectorRepair, /GrowthIntelligence-LocalConnector/);
assert.match(connectorRepair, /GrowthIntelligence-CloudflaredTunnel/);
assert.match(connectorRepair, /connector\.mad4b\.com\/health/);
assert.match(connectorRepair, /cloudflare_1033/);

assert.match(supervisor, /Ensure-StagingDockerDesktopReady/);
assert.match(supervisor, /mad4b\.staging\.deployment-lease\.v1/);
assert.match(supervisor, /mad4b\.staging\.auto-deploy-phased-state\.v1/);
for (const phase of [
  "eligibility",
  "docker",
  "build",
  "deployment",
  "service_health",
  "staging_tunnel",
  "local_connector_tunnel",
  "convergence",
  "certification",
]) {
  assert.ok(supervisor.includes(`${phase} =`), `missing phased state: ${phase}`);
}
assert.match(supervisor, /if \(\$local\.exact -and \$local\.healthy\)/);
assert.match(supervisor, /reused_exact_provenance/);
assert.match(supervisor, /STAGING_CONVERGENCE_REQUIRED: component=activation_gateway/);
assert.match(supervisor, /Converge-StagingActivationGateway\.ps1/);
assert.match(supervisor, /Invoke-StagingCertification\.ps1/);
assert.ok(
  supervisor.indexOf("$gateway = Invoke-ActivationConvergence $sha") < supervisor.indexOf("$certification = Invoke-Certification $sha"),
  "gateway convergence must happen before certification",
);
assert.match(supervisor, /failure_class = \$FailureClass/);
assert.match(supervisor, /expected_commit = \$ExpectedCommit/);
assert.match(supervisor, /observed_commit =/);
assert.match(supervisor, /parent_error = \$ParentError/);
assert.match(supervisor, /production_deploy = \$false/);
assert.match(supervisor, /database_mutated = \$false/);
assert.match(supervisor, /migration_applied = \$false/);
assert.match(supervisor, /ruleset_mutation = \$false/);
assert.match(supervisor, /secrets_included = \$false/);

assert.match(manifestGenerator, /Windows-Staging-Bootstrap-Supervisor\.ps1/);
assert.match(manifestGenerator, /Repair-LocalConnectorTunnel\.ps1/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.windows-staging-bootstrap-supervisor.contract-test.v1",
  docker_readiness_gate: true,
  lifecycle_lease: true,
  phased_recovery: true,
  component_aware_gateway_convergence: true,
  independent_tunnel_health: true,
  structured_root_cause: true,
  production_mutation: false,
  secrets_included: false,
}));
