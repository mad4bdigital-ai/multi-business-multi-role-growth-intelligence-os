import "./test-staging-one-click-autopilot-core.mjs";
import "./test-staging-smart-gateway-convergence-contract.mjs";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "autopilot-portable-staging");
const bridgePath = path.join(here, "scripts", "staging-environment-convergence-plan.mjs");
const smartLauncher = fs.readFileSync(path.join(packageRoot, "Invoke-Staging-One-Click.ps1"), "utf8");
const cmdLauncher = fs.readFileSync(path.join(packageRoot, "Start-Staging-One-Click.cmd"), "utf8");

assert.match(smartLauncher, /\[string\]\$TunnelMode = 'disabled'/);
assert.match(smartLauncher, /function Enter-TopologyTransitionLease/);
assert.match(smartLauncher, /function Mark-TopologyTransitionFailed/);
assert.match(smartLauncher, /function Publish-CanonicalTunnelRuntimeState/);
assert.match(smartLauncher, /Write-StagingAtomicJson \$runtimeStatePath \$runtime 10/);
assert.match(smartLauncher, /Add-Member -NotePropertyName tunnel_mode/);
assert.match(smartLauncher, /Add-Member -NotePropertyName tunnel_started/);
assert.match(smartLauncher, /tunnel_topology_transition_failed/);
assert.match(smartLauncher, /Unable to resolve an exact repository HEAD commit for the topology transition/);
assert.match(smartLauncher, /Canonical runtime commit does not match topology transition commit/);
assert.match(smartLauncher, /Topology transition lease remained after completion cleanup/);
assert.match(smartLauncher, /Public Staging tunnel modes require -EnableActivationGateway before any topology mutation/);
assert.ok(
  smartLauncher.indexOf("if ($TunnelMode -ne 'disabled' -and -not $EnableActivationGateway)") <
    smartLauncher.indexOf("Invoke-EnvAuthorityGuard\n$active = Invoke-CoreWithTopologyLease"),
  "public-mode Activation Gateway guard must run before the topology coordinator",
);
const commitMismatchGuard = smartLauncher.indexOf("if ($commit -ne $expectedCommit)");
const tunnelAuthorityPublication = smartLauncher.indexOf("$runtime | Add-Member -NotePropertyName tunnel_mode");
assert.ok(commitMismatchGuard >= 0 && commitMismatchGuard < tunnelAuthorityPublication,
  "exact transition/runtime commit equality must be proven before tunnel authority publication");
assert.match(cmdLauncher, /if "%TUNNEL_MODE%"=="" set "TUNNEL_MODE=disabled"/);
assert.doesNotMatch(cmdLauncher, /if "%TUNNEL_MODE%"=="" set "TUNNEL_MODE=windows_service"/);
assert.match(cmdLauncher, /'-EnableActivationGateway'/);
assert.match(cmdLauncher, /disabled       : local-only Staging \^\(safe default\^\)/);

function resolvePowerShell() {
  const candidates = process.platform === "win32" ? ["pwsh.exe", "powershell.exe"] : ["pwsh"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoLogo", "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8",
    });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

function powershellSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const publishStart = smartLauncher.indexOf("function Publish-CanonicalTunnelRuntimeState {");
const publishEnd = smartLauncher.indexOf("\nfunction Write-Lines", publishStart);
assert.ok(publishStart >= 0 && publishEnd > publishStart, "must isolate canonical tunnel publication function for behavioral regression");
const publishFunction = smartLauncher.slice(publishStart, publishEnd).trim();

const powerShell = resolvePowerShell();
assert.ok(powerShell, "PowerShell is required to execute the stale-runtime topology publication regression");

const topologyTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-topology-commit-binding-"));
const topologyRuntimePath = path.join(topologyTempRoot, "autopilot-state.json");
const topologyHarnessPath = path.join(topologyTempRoot, "topology-publication-regression.ps1");
const transitionCommit = "a".repeat(40);
const staleRuntimeCommit = "b".repeat(40);

try {
  fs.writeFileSync(topologyRuntimePath, JSON.stringify({ commit: staleRuntimeCommit }), "utf8");
  const topologyHarness = `
$ErrorActionPreference = 'Stop'
$runtimeStatePath = ${powershellSingleQuoted(topologyRuntimePath)}
$TunnelMode = 'windows_service'
$script:TopologyTransitionExpectedCommit = '${transitionCommit}'
function Fail([string]$Message) { throw "STAGING_DUAL_MODE_SMART_ONE_CLICK_FAIL_CLOSED: $Message" }
function Write-StagingAtomicJson([string]$Path, [object]$Value, [int]$Depth) {
    $Value | ConvertTo-Json -Depth $Depth | Set-Content -LiteralPath $Path -Encoding UTF8
}
${publishFunction}
try {
    Publish-CanonicalTunnelRuntimeState
    exit 0
} catch {
    [Console]::Out.WriteLine($_.Exception.Message)
    exit 42
}
`;
  fs.writeFileSync(topologyHarnessPath, topologyHarness, "utf8");

  const topologyResult = spawnSync(powerShell, ["-NoLogo", "-NoProfile", "-File", topologyHarnessPath], {
    encoding: "utf8",
  });
  assert.equal(topologyResult.status, 42,
    `stale runtime commit must fail closed before publication: ${topologyResult.stderr || topologyResult.stdout}`);
  assert.match(String(topologyResult.stdout || topologyResult.stderr),
    /Canonical runtime commit does not match topology transition commit/);

  const afterFailedPublication = JSON.parse(fs.readFileSync(topologyRuntimePath, "utf8").replace(/^\uFEFF/, ""));
  assert.equal(afterFailedPublication.commit, staleRuntimeCommit);
  assert.equal(Object.hasOwn(afterFailedPublication, "tunnel_mode"), false,
    "failed exact-commit proof must not publish tunnel_mode authority");
  assert.equal(Object.hasOwn(afterFailedPublication, "tunnel_started"), false,
    "failed exact-commit proof must not publish tunnel_started authority");
  assert.equal(Object.hasOwn(afterFailedPublication, "tunnel_state_published_at"), false,
    "failed exact-commit proof must not publish topology timestamp authority");
} finally {
  fs.rmSync(topologyTempRoot, { recursive: true, force: true });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-staging-convergence-bom-"));
const runtimePath = path.join(tempRoot, "autopilot-state.json");
const preflightPath = path.join(tempRoot, "staging-schema-governance-preflight.json");
const commit = "a".repeat(40);

const runtime = {
  commit,
  certified_commit: commit,
  certification_status: "ready",
  certification_blocking_failures: [],
  certification_degraded_reasons: [],
};

const preflight = {
  contract: "mad4b.staging.schema-governance-preflight.v1",
  status: "passed",
  expected_commit: commit,
  observed_commit: commit,
  safety: {
    read_only: true,
    schema_bundle_applied: false,
    database_mutation: false,
    migration_apply: false,
    production_access: false,
    provider_access: false,
    data_export: false,
    credential_access: false,
    secrets_included: false,
    tunnel_started: false,
    auto_deploy_installed: false,
  },
};

try {
  fs.writeFileSync(runtimePath, `\uFEFF${JSON.stringify(runtime)}`, "utf8");
  fs.writeFileSync(preflightPath, `\uFEFF${JSON.stringify(preflight)}`, "utf8");

  const result = spawnSync(process.execPath, [
    bridgePath,
    "--runtime-state", runtimePath,
    "--preflight", preflightPath,
    "--repository", "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    "--recovery-trust-exact", "true",
  ], {
    cwd: here,
    encoding: "utf8",
    env: process.env,
  });

  assert.equal(result.status, 0, `bridge must accept Windows PowerShell UTF-8 BOM JSON inputs: ${result.stderr || result.stdout}`);
  const output = JSON.parse(String(result.stdout || "").trim());
  assert.equal(output.contract, "mad4b.staging-environment-convergence-bridge.v1");
  assert.equal(output.status, "not_required");
  assert.equal(output.expected_commit, commit);
  assert.equal(output.safety.provider_mutation, false);
  assert.equal(output.safety.workflow_dispatch, false);
  assert.equal(output.safety.production_mutation, false);
  assert.equal(output.safety.database_mutation, false);
  assert.equal(output.safety.secrets_included, false);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("staging topology exact-commit and convergence regressions: ok");
