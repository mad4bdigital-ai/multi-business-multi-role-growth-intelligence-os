import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const preflight = read("autopilot-portable-staging/Staging-Windows-Preflight.ps1");
const installer = read("autopilot-portable-staging/Install-AutoDeployTask.ps1");
const monitor = read("autopilot-portable-staging/Staging-HealthMonitor.ps1");
const autoDeploy = read("autopilot-portable-staging/Auto-Deploy-Staging.ps1");
const operationsLog = read("autopilot-portable-staging/Staging-Operations-Log.ps1");
const converger = read("autopilot-portable-staging/Converge-StagingActivationGateway.ps1");
const connectorRepair = read("autopilot-portable-staging/Repair-LocalConnectorTunnel.ps1");
const stagingCloudflared = read("autopilot-portable-staging/Staging-WindowsCloudflared.ps1");
const connectorWatchdog = read("local-connector/connector-watchdog.ps1");
const connectorInstaller = read("local-connector/install-service.ps1");

// Docker Desktop is a bounded prerequisite, but docker info remains the authority.
assert.match(preflight, /function Ensure-StagingDockerDesktopReady/);
assert.match(preflight, /docker info --format '\{\{\.ServerVersion\}\}'/);
assert.match(preflight, /Docker\\Docker\\Docker Desktop\.exe/);
assert.match(preflight, /Start-Process -FilePath \$desktop/);
assert.match(preflight, /TimeoutSeconds = 180/);
assert.match(preflight, /PollSeconds = 3/);
assert.match(preflight, /reason=docker_engine_start_timeout/);
assert.match(preflight, /DOCKER_HOST/);
assert.match(preflight, /DOCKER_CONTEXT/);

// Task Scheduler restores Docker independently from deployment eligibility, then
// starts Auto Deploy after its own delay. The Docker task cannot select/deploy a commit.
assert.match(installer, /DockerBootstrapTaskName = "MAD4B Staging Docker Bootstrap"/);
assert.match(installer, /Staging-Windows-Preflight\.ps1/);
assert.match(installer, /Ensure-StagingDockerDesktopReady -TimeoutSeconds \$BootGraceSeconds -PollSeconds 3/);
assert.match(installer, /EncodedCommand \$encodedDockerBootstrapCommand/);
assert.match(installer, /local_runtime_bootstrap_only=True deployment_authorized=False/);
assert.match(installer, /New-ScheduledTaskPrincipal[^\n]+LogonType Interactive[^\n]+RunLevel Highest/);
assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
assert.match(installer, /\$dockerTrigger\.Delay = "PT\$\{dockerDelaySeconds\}S"/);
assert.match(installer, /\$trigger\.Delay = "PT\$\{LogonDelaySeconds\}S"/);
assert.match(installer, /RestartCount 3/);
assert.match(installer, /RestartInterval \(New-TimeSpan -Minutes 1\)/);
assert.match(installer, /MultipleInstances IgnoreNew/);
assert.match(installer, /BootGraceSeconds = 180/);

// Health incidents are lease-aware and distinguish current failure from historical failure.
assert.match(monitor, /deployment-lease\.json/);
assert.match(monitor, /BootGraceSeconds = 180/);
assert.match(monitor, /bootstrapping/);
assert.match(monitor, /deploying/);
assert.match(monitor, /converging/);
assert.match(monitor, /certifying/);
assert.match(monitor, /transient startup health state suppressed inside bounded grace/);
assert.match(monitor, /failure_class = ""/);
assert.match(monitor, /last_failure_class/);
assert.match(monitor, /\$state\.failure_class = ""/);

// Staging public ingress and the Admin Recovery connector are independent surfaces.
assert.match(monitor, /staging_tunnel/);
assert.match(monitor, /local_connector_tunnel/);
assert.match(monitor, /dev\.mad4b\.com/);
assert.match(monitor, /mcp-dev\.mad4b\.com/);
assert.match(monitor, /connector\.mad4b\.com/);
assert.match(monitor, /cloudflare_1033/);
assert.match(monitor, /Mad4B-Staging-Cloudflared/);

// Auto Deploy is now a resumable phase machine rather than deployed/certified booleans.
assert.match(autoDeploy, /mad4b\.staging-auto-deploy-state\.v2/);
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
  assert.match(autoDeploy, new RegExp(`${phase} =`));
}
assert.match(autoDeploy, /overall = \$Overall/);
assert.match(autoDeploy, /Ensure-StagingDockerDesktopReady -TimeoutSeconds 180 -PollSeconds 3/);
assert.match(autoDeploy, /mad4b\.staging-deployment-lease\.v1/);
assert.match(autoDeploy, /STAGING_CONVERGENCE_REQUIRED: component=activation_gateway/);
assert.match(autoDeploy, /gateway_exact_commit_mismatch/);
assert.match(autoDeploy, /Staging-Schema-Governance-Preflight\.ps1/);
assert.match(autoDeploy, /Converge-StagingActivationGateway\.ps1/);
assert.match(autoDeploy, /--no-build", "app/);
assert.match(autoDeploy, /refusing blind redeploy/);
assert.match(autoDeploy, /Test-LocalDeploymentHealthy/);
assert.match(autoDeploy, /Get-GatewayOnlyRecovery/);
assert.match(autoDeploy, /Invoke-GatewayConvergence/);

// Reuse the existing bounded exact-SHA Worker authority instead of direct local Cloudflare calls.
assert.match(converger, /operation=deploy_activation_worker/);
assert.match(converger, /confirmation=DEPLOY_STAGING_ACTIVATION_WORKER/);
assert.match(converger, /origin\/main moved before governed Staging Worker dispatch/);
assert.match(converger, /source_commit/);
assert.match(converger, /worker_build_sha/);
assert.match(converger, /production_mutation = \$false/);
assert.match(converger, /cloudflare_dns_mutation = \$false/);

// last-failure.json keeps the actionable child cause instead of only the launcher failure.
for (const key of ["failure_class", "expected_commit", "observed_commit", "parent_error", "blocking_reason"]) {
  assert.match(operationsLog, new RegExp(`"${key}"`));
}

// Local Connector transport has a dedicated ownership boundary distinct from Staging.
for (const source of [connectorWatchdog, connectorInstaller, connectorRepair]) {
  assert.match(source, /Mad4B-LocalConnector-Cloudflared/);
}
assert.match(stagingCloudflared, /return 'Mad4B-Staging-Cloudflared'/);
assert.doesNotMatch(stagingCloudflared, /Mad4B-LocalConnector-Cloudflared/);
assert.match(connectorInstaller, /\$StagingTunnel\s+=\s+"Mad4B-Staging-Cloudflared"/);
assert.match(connectorInstaller, /Cross-runtime non-interference failed/);
assert.doesNotMatch(connectorInstaller, /Get-Process -Name "cloudflared"/);
assert.doesNotMatch(connectorInstaller, /cloudflared service uninstall/);

// Installer and watchdog callbacks fail closed on the originating environment.
assert.match(connectorInstaller, /CONNECTOR_ENVIRONMENT/);
assert.match(connectorInstaller, /"staging" \{ "dev\.mad4b\.com" \}/);
assert.match(connectorInstaller, /"production" \{ "auth\.mad4b\.com" \}/);
assert.match(connectorInstaller, /CONNECTOR_CONTROL_PLANE_BASE_URL/);
assert.match(connectorInstaller, /CONNECTOR_POLICY_URL/);
assert.match(connectorInstaller, /CONNECTOR_HEARTBEAT_URL/);
assert.match(connectorWatchdog, /function Test-HeartbeatBinding/);
assert.match(connectorWatchdog, /environment_binding_rejected/);
assert.match(connectorWatchdog, /ownership_binding_rejected/);
assert.match(connectorWatchdog, /cross_runtime_mutation = \$false/);

// 1033 recovery is out-of-band: bind Staging callbacks before any runtime restart,
// self-heal the connector process first, repair only its tunnel, then prove Staging unchanged.
assert.match(connectorRepair, /Bind-StagingConnectorEnvironment/);
assert.match(connectorRepair, /\$base = "https:\/\/dev\.mad4b\.com"/);
assert.match(connectorRepair, /CONNECTOR_CONTROL_PLANE_BASE_URL" \$base/);
assert.match(connectorRepair, /CONNECTOR_HEARTBEAT_URL" "\$base\/connector-agent\/heartbeat"/);
assert.match(connectorRepair, /function Ensure-ConnectorRuntimeRunning/);
assert.match(connectorRepair, /function Restart-ConnectorRuntime/);
assert.match(connectorRepair, /connector_runtime_restart_attempted/);
assert.match(connectorRepair, /cloudflare_1033/);
assert.match(connectorRepair, /Restart-LocalTunnelRuntime/);
assert.match(connectorRepair, /staging_runtime_unchanged/);
assert.match(connectorRepair, /ambiguous_legacy_service_requires_reconciliation/);
assert.match(connectorRepair, /production_callback_fallback = \$false/);
assert.match(connectorRepair, /production_mutation = \$false/);
assert.match(connectorRepair, /provider_mutation = \$false/);
assert.match(connectorRepair, /dns_mutation = \$false/);
assert.doesNotMatch(connectorRepair, /Restart-Service -Name \$StagingTunnelRuntime/);
assert.doesNotMatch(connectorRepair, /Stop-Service -Name \$StagingTunnelRuntime/);

// Connector watchdog supports service/task runtime recovery but can mutate only
// the canonical Local Connector tunnel ownership boundary.
assert.match(connectorWatchdog, /function Ensure-RuntimeRunning/);
assert.match(connectorWatchdog, /function Restart-RuntimeSafe/);
assert.match(connectorWatchdog, /GrowthIntelligence-LocalConnector/);
assert.match(connectorWatchdog, /https:\/\/connector\.mad4b\.com\/health/);
assert.match(connectorWatchdog, /cloudflare_1033/);
assert.match(connectorWatchdog, /action=restart_local_connector_tunnel/);
assert.match(connectorInstaller, /GrowthIntelligence-ConnectorWatchdog/);
assert.match(connectorInstaller, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
assert.match(connectorInstaller, /connector-watchdog\.ps1/);

// Explicitly retain the non-target safety boundary.
assert.doesNotMatch(autoDeploy, /auth\.mad4b\.com|mcp\.mad4b\.com|activation\.mad4b\.com/);
assert.match(autoDeploy, /production_deploy = \$false/);
assert.match(autoDeploy, /database_mutated = \$false/);
assert.match(autoDeploy, /migration_applied = \$false/);
assert.match(autoDeploy, /provider_mutation_authorized = \$false/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.windows-staging-bootstrap-supervisor.v1",
  docker_desktop_auto_start: true,
  docker_logon_recovery_independent_of_deployment_eligibility: true,
  deployment_grace_lease: true,
  split_tunnel_health: true,
  component_aware_gateway_convergence: true,
  structured_root_cause: true,
  phased_state_machine: true,
  connector_reboot_recovery: true,
  connector_transport_ownership_isolated: true,
  connector_environment_binding: true,
  connector_runtime_self_heal: true,
  connector_1033_reconciliation: true,
  cross_runtime_non_interference: true,
  production_mutation: false,
  secrets_included: false,
}));