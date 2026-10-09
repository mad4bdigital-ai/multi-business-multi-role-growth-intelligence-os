import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const install = read("autopilot-portable-staging/Install-AutoDeployTask.ps1");
const addSupervisor = read("autopilot-portable-staging/Install-AutonomousSupervisorTask.ps1");
const supervisor = read("autopilot-portable-staging/Staging-AutonomousSupervisor.ps1");
const autoDeploy = read("autopilot-portable-staging/Auto-Deploy-Staging.ps1");
const doctor = read("autopilot-portable-staging/Staging-Doctor.ps1");
const diagnostic = read("autopilot-portable-staging/Staging-ColdBoot-Diagnostics.ps1");
const readme = read("docs/runbooks/pr8471-windows-coldboot-recovery-20261009.md");

test("all four governed user-logon tasks remain silent, single-instance, and delayed", () => {
  for (const name of ["MAD4B Staging Docker Bootstrap", "MAD4B Staging Auto Deploy",
    "MAD4B Staging Health Monitor", "MAD4B Staging Autonomous Supervisor"])
    assert(install.includes(name), "missing scheduled task: " + name);
  assert.equal((install.match(/-WindowStyle Hidden/g) || []).length, 4);
  assert.match(install, /New-ScheduledTaskPrincipal\s+-UserId[^\n]+-LogonType Interactive/);
  assert.match(install, /-StartWhenAvailable[^\n]+-MultipleInstances IgnoreNew/);
  assert.match(install, /Ensure-StagingDockerDesktopReady -TimeoutSeconds \$BootGraceSeconds/);
  assert.doesNotMatch(install, /-AtStartup|LogonType ServiceAccount/);
});

test("additive supervisor accepts only exact existing watchdog path and optional Hidden window style", () => {
  for (const source of [addSupervisor, supervisor]) {
    assert(source.includes("(?:\\s+-WindowStyle\\s+Hidden)?"));
    assert.match(source, /-RepositoryPath\\s\+/);
    assert.match(source, /-Watch\\s\+/);
    assert.match(source, /-TunnelMode\\s\+/);
  }
  assert.match(addSupervisor, /-WindowStyle Hidden -ExecutionPolicy Bypass/);
  assert.match(addSupervisor, /refusing overwrite/);
  assert.doesNotMatch(addSupervisor, /-Force\s*\|\s*Out-Null/);
});

test("remote Git failure survives watcher restart without reusing cached SHA or eligibility", () => {
  assert.match(autoDeploy, /try\s*\{\s*\$sha = Get-RemoteMainSha \$RepositoryPath \$Ref/);
  assert.match(autoDeploy, /\$eligibility = Get-LatestEligibility \$Policy \$ExpectedRepository \$sha/);
  assert.match(autoDeploy, /if \(-not \$Watch\) \{ throw \}/);
  assert.match(autoDeploy, /\$script:CurrentSha = ""/);
  assert.match(autoDeploy, /\$script:CurrentEligibility = \$null/);
  assert.match(autoDeploy, /status = "retry_later"/);
  assert.match(autoDeploy, /desired_sha_verified = \$false/);
  assert.match(autoDeploy, /eligibility_verified = \$false/);
  assert.match(autoDeploy, /deployment_authorized = \$false/);
  assert.match(autoDeploy, /Start-Sleep -Seconds \$PollSeconds\s+continue/);
});

test("Docker Engine readiness precedes trusting prior certification on a reboot", () => {
  const engine = autoDeploy.indexOf("Ensure-StagingDockerDesktopReady -TimeoutSeconds 180");
  const check = autoDeploy.indexOf("$localRuntimeHealthy = Test-LocalDeploymentHealthy");
  const prior = autoDeploy.indexOf("$alreadyCertified = $alreadyCertified -and $localRuntimeHealthy");
  assert(engine >= 0 && check > engine && prior > check);
  assert.match(autoDeploy, /elseif \(\$sameDeployedCommit -and \$localRuntimeHealthy -and -not \$ValidateOnly/);
  assert.match(autoDeploy, /elseif \(\$eligibility.state -eq "eligible"\)/);
  assert.match(autoDeploy, /\$liveImageId = \(& docker inspect --format "\{\{\.Image\}\}"/);
  assert.match(autoDeploy, /\$liveImageId -ne \$imageDigest\.ToLowerInvariant\(\)/);
  assert.doesNotMatch(autoDeploy, /if \(\$alreadyCertified\) \{\s*\$phaseState\.service_health = "healthy"/);
});

test("doctor distinguishes registered task from running supervisor and exposes additive repair", () => {
  for (const name of ["MAD4B Staging Docker Bootstrap", "MAD4B Staging Autonomous Supervisor"])
    assert(doctor.includes(name));
  assert.match(doctor, /Get-ScheduledTaskInfo -TaskName \$Name/);
  assert.match(doctor, /\$RepairMissingSupervisor/);
  assert.match(doctor, /Install-AutonomousSupervisorTask\.ps1/);
  assert.match(doctor, /if \(\$RepairTasks -and \$RepairMissingSupervisor\)/);
});

test("cold-boot observation covers user-visible failure without running repair or claiming recovery", () => {
  for (const flag of ["repository_available", "docker_engine_ready", "auth_host_resolved",
    "github_host_resolved", "missing_tasks", "stopped_watchers", "failed_task_history",
    "staging_health_fresh", "supervisor_acceptance", "secrets_included"])
    assert(diagnostic.includes(flag), "missing diagnostic: " + flag);
  assert.match(diagnostic, /production_promotion_authorized = \$false/);
  assert.match(diagnostic, /device_generation_certified = \$false/);
  assert.match(diagnostic, /read_only = \$true/);
  assert.doesNotMatch(diagnostic, /Start-ScheduledTask|Register-ScheduledTask|Restart-Service|docker compose up|docker compose down|Invoke-Expression/);
});

test("operator guide differentiates synthetic contracts from reboot certificate and Production", () => {
  assert.match(readme, /Task Scheduler/i);
  assert.match(readme, /267009/);
  assert.match(readme, /-RepairMissingSupervisor/);
  assert.match(readme, /Staging-ColdBoot-Diagnostics\.ps1/);
  assert.match(readme, /native Windows reboot/i);
  assert.match(readme, /NO PRODUCTION PROMOTION/i);
  assert.match(readme, /PSSecurityException/);
  assert.match(readme, /-ExecutionPolicy Bypass -File \$Installer/);
  assert.match(readme, /\$LASTEXITCODE -ne 0/);
  assert.match(readme, /Get-ScheduledTask -TaskName "MAD4B Staging Autonomous Supervisor"/);
  assert.match(readme, /Get-ExecutionPolicy -List/);
  assert.match(readme, /MachinePolicy/);
  assert.match(readme, /do not use `Set-ExecutionPolicy/);
});


const matrix = JSON.parse(read("http-generic-api/config/pr8471-windows-coldboot-scenarios.json"));
test("nine additional cold-boot scenarios require independent native proof", () => {
  assert.equal(matrix.contract, "mad4b.pr8471-windows-coldboot-scenarios.v1");
  assert.equal(matrix.environment, "staging");
  assert.equal(matrix.native_reboot_certificate, "missing");
  assert.equal(matrix.scenarios.length, 9);
  const ids = new Set();
  for (const row of matrix.scenarios) {
    assert.match(row.id, /^windows_boot\.[a-z][a-z0-9_]+$/);
    assert(!ids.has(row.id));
    ids.add(row.id);
    assert(["blocked","retry_later"].includes(row.expected_state));
    assert.equal(row.live_certified, false);
    assert.equal(row.production_mutation_allowed, false);
    assert.equal(row.secrets_included, false);
  }
  assert.equal(matrix.production_promotion_authorized, false);
});

console.log("STAGING_COLDBOOT_SOURCE_CONTRACTS: available; live Windows reboot certification remains unproven");
