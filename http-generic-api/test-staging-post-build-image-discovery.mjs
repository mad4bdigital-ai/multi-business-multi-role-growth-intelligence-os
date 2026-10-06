import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = readFileSync(new URL("../autopilot-portable-staging/Start-AutoPilot.ps1", import.meta.url), "utf8");
const finder = source.slice(source.indexOf("function Find-ExactStagingImageId"), source.indexOf("function Seed-SchemaBundle"));
const runtimeFinder = source.slice(source.indexOf("function Resolve-ExactStagingImageCandidate"), source.indexOf("function Seed-SchemaBundle"));

assert.match(finder, /Resolve-ExactStagingImageCandidate/);
assert.match(finder, /"env_pin"/);
assert.match(finder, /"running_container"/);
assert.match(finder, /"compose_image_ref"/);
assert.match(finder, /"label_index"/);
assert.match(finder, /config", "--format", "json"/);
assert.match(finder, /composeModel\.services\.app\.image/);
assert.match(finder, /composeModel\.name/);
assert.match(finder, /-app:latest/);
assert.match(finder, /docker image inspect --format ["']\{\{\.Id\}\}["'] \$effectiveImageRef/);
assert.match(finder, /Test-ExactStagingImage/);
assert.match(finder, /"ps", "-q", "app"/);
assert.match(finder, /docker inspect --format "\{\{\.Image\}\}"/);
assert.match(finder, /accepted exact Staging image candidate/);
assert.match(finder, /no local Staging image matched exact provenance/);
assert.doesNotMatch(finder, /Get-NativeText "docker"/);
assert.match(source, /\$inspectJson = \(& docker image inspect \$ImageId 2>\$null \| Out-String\)\.Trim\(\)/);
assert.match(source, /\$parsed = ConvertFrom-Json -InputObject \$inspectJson/);
assert.match(source, /\$parsed -is \[System\.Array\]/);
assert.match(source, /\$parsed\.Count -ne 1/);
assert.match(source, /\$inspect = \$parsed\[0\]/);
assert.match(source, /\$property = \$Labels\.PSObject\.Properties\[\$Name\]/);
assert.match(source, /\$labels = \$inspect\.Config\.Labels/);
assert.match(source, /\$inspectedId = \(\[string\]\$inspect\.Id\)\.Trim\(\)\.ToLowerInvariant\(\)/);
assert.match(finder, /Staging image candidate rejected after exact provenance validation/);
assert.doesNotMatch(source, /docker image inspect --format '\{\{json \.Config\.Labels\}\}' \$ImageId/);
assert.doesNotMatch(source, /docker image inspect --format '\{\{\.Id\}\}' \$ImageId/);
assert.doesNotMatch(finder, /"images", "-q", "app"/);

for (const label of [
  "org.mad4b.staging.provenance.contract",
  "org.mad4b.staging.build.commit",
  "org.mad4b.staging.build.tree",
  "org.mad4b.staging.build.context_file_set_sha256",
  "org.mad4b.staging.build.secrets_included",
]) assert.ok(source.includes(label), `exact provenance validation lost ${label}`);

assert.match(source, /\$imageId -notmatch '\^sha256:/);
assert.match(source, /Fail "Staging app image ID is not a content-addressed sha256 digest with exact provenance"/);

if (process.platform === "win32") {
  const fixture = JSON.stringify([{
    Id: "sha256:" + "7".repeat(64),
    Config: {
      Labels: {
        "org.mad4b.staging.provenance.contract": "mad4b.staging-build-provenance.v1",
        "org.mad4b.staging.build.commit": "8".repeat(40),
        "org.mad4b.staging.build.tree": "3".repeat(40),
        "org.mad4b.staging.build.context_file_set_sha256": "6".repeat(64),
        "org.mad4b.staging.build.secrets_included": "false",
      },
    },
  }]).replaceAll("'", "''");

  const command = [
    "$ErrorActionPreference = 'Stop'",
    "Set-StrictMode -Version Latest",
    `$inspectJson = '${fixture}'`,
    "$parsed = ConvertFrom-Json -InputObject $inspectJson",
    "if (-not ($parsed -is [System.Array])) { throw 'Docker inspect fixture must parse as a top-level array on Windows PowerShell 5.1.' }",
    "if ($parsed.Count -ne 1) { throw 'Docker inspect fixture cardinality mismatch.' }",
    "$inspect = $parsed[0]",
    "$labels = $inspect.Config.Labels",
    "$get = { param($name) $p = $labels.PSObject.Properties[$name]; if ($null -eq $p) { return '' }; return ([string]$p.Value).Trim() }",
    "if ((& $get 'org.mad4b.staging.provenance.contract') -ne 'mad4b.staging-build-provenance.v1') { throw 'contract label mismatch' }",
    "if ((& $get 'org.mad4b.staging.build.commit') -ne ('8' * 40)) { throw 'commit label mismatch' }",
    "if ((& $get 'org.mad4b.staging.build.tree') -ne ('3' * 40)) { throw 'tree label mismatch' }",
    "if ((& $get 'org.mad4b.staging.build.context_file_set_sha256') -ne ('6' * 64)) { throw 'context label mismatch' }",
    "if ((& $get 'org.mad4b.staging.build.secrets_included') -ne 'false') { throw 'secrets label mismatch' }",
    "Write-Output 'STAGING_POWERSHELL51_IMAGE_PROVENANCE_SMOKE_OK'",
  ].join("; ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `Windows PowerShell 5.1 provenance smoke failed with exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(result.stdout, /STAGING_POWERSHELL51_IMAGE_PROVENANCE_SMOKE_OK/);

  const tempRoot = mkdtempSync(join(tmpdir(), "mad4b-staging-image-reuse-"));
  try {
    const envPath = join(tempRoot, ".env.staging");
    const smokePath = join(tempRoot, "image-reuse-smoke.ps1");
    const imageId = "sha256:" + "9".repeat(64);
    const expectedCommit = "a".repeat(40);
    const expectedTree = "b".repeat(40);
    const expectedContext = "c".repeat(64);
    writeFileSync(envPath, `STAGING_APP_IMAGE_ID=${imageId}\r\n`, "utf8");

    const escapedEnvPath = envPath.replaceAll("'", "''");
    const smokeScript = [
      "$ErrorActionPreference = 'Stop'",
      "Set-StrictMode -Version Latest",
      "$LogComponent = 'runtime-smoke'",
      "function Write-StagingOperationBoundary { param($Component,$Stage,$Outcome,$Message,$Data) }",
      "function Write-StagingLog { param($Level,$Component,$Stage,$Message,$Data) }",
      "function Test-ExactStagingImage { param($ImageId,$ExpectedCommit,$ExpectedTree,$ExpectedContextFileSet) return $true }",
      "function docker { throw 'DOCKER_MUST_NOT_BE_CALLED_AFTER_EXACT_ENV_PIN' }",
      runtimeFinder,
      `$resolved = Find-ExactStagingImageId '${expectedCommit}' '${expectedTree}' '${expectedContext}' '${escapedEnvPath}' @('compose')`,
      `if ($resolved -ne '${imageId}') { throw "env pin short-circuit returned unexpected image: $resolved" }`,
      "Write-Output 'STAGING_POWERSHELL51_IMAGE_REUSE_SHORT_CIRCUIT_OK'",
    ].join("\r\n");
    writeFileSync(smokePath, smokeScript, "utf8");

    const reuse = spawnSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", smokePath],
      { encoding: "utf8", windowsHide: true },
    );
    if (reuse.error) throw reuse.error;
    assert.equal(
      reuse.status,
      0,
      `Windows PowerShell 5.1 exact-image reuse smoke failed with exit=${reuse.status}\nstdout:\n${reuse.stdout}\nstderr:\n${reuse.stderr}`,
    );
    assert.match(reuse.stdout, /STAGING_POWERSHELL51_IMAGE_REUSE_SHORT_CIRCUIT_OK/);
    assert.doesNotMatch(reuse.stderr, /DOCKER_MUST_NOT_BE_CALLED_AFTER_EXACT_ENV_PIN/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log("staging post-build image discovery contract tests passed");
