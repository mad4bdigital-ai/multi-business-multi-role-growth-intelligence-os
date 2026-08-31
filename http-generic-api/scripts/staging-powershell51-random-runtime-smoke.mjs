#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "..");
const helperRelativePath = "autopilot-portable-staging/Staging-Environment.ps1";
const helperPath = path.join(repoRoot, helperRelativePath);
const helperText = fs.readFileSync(helperPath, "utf8");

// Cross-platform source guard: the canonical Windows PowerShell launcher must never regress to the .NET API that is absent from Windows PowerShell 5.1.
assert.doesNotMatch(helperText, /RandomNumberGenerator\]\s*::\s*Fill\s*\(/);
assert.match(helperText, /RandomNumberGenerator\]\s*::\s*Create\s*\(\s*\)/);
assert.match(helperText, /\$rng\.GetBytes\s*\(\s*\$bytes\s*\)/);

if (process.platform !== "win32") {
  console.log(JSON.stringify({
    ok: true,
    contract: "mad4b.staging-powershell51-random-runtime-smoke.v1",
    runtime_executed: false,
    runtime: "powershell.exe",
    reason: "Windows runtime smoke is executable only on win32; source compatibility guards passed.",
    production_mutation: false,
    database_mutation: false,
    provider_mutation: false,
    secrets_included: false,
  }, null, 2));
  process.exit(0);
}

const quotedHelperPath = helperPath.replaceAll("'", "''");
const command = [
  "$ErrorActionPreference = 'Stop'",
  `. '${quotedHelperPath}'`,
  "$valueA = New-StagingRandomValue -ByteCount 32",
  "$valueB = New-StagingRandomValue -ByteCount 32",
  "if ($valueA -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'Unexpected Base64Url output from 32 random bytes.' }",
  "if ($valueB -notmatch '^[A-Za-z0-9_-]{43}$') { throw 'Unexpected Base64Url output from second 32-byte sample.' }",
  "if ($valueA -eq $valueB) { throw 'Independent CSPRNG samples unexpectedly matched.' }",
  "try { New-StagingRandomValue -ByteCount 15 | Out-Null; throw 'Expected minimum-byte guard did not fire.' } catch { if ($_.Exception.Message -notmatch 'at least 16 random bytes') { throw } }",
  "Write-Output 'STAGING_POWERSHELL51_RANDOM_SMOKE_OK'",
].join("; ");

const result = spawnSync(
  "powershell.exe",
  ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
  {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
  },
);

if (result.error) {
  throw result.error;
}

assert.equal(
  result.status,
  0,
  `powershell.exe runtime smoke failed with exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
);
assert.match(result.stdout, /STAGING_POWERSHELL51_RANDOM_SMOKE_OK/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-powershell51-random-runtime-smoke.v1",
  runtime_executed: true,
  runtime: "powershell.exe",
  powershell_exit_code: result.status,
  random_bytes: 32,
  production_mutation: false,
  database_mutation: false,
  provider_mutation: false,
  secrets_included: false,
}, null, 2));
