#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(apiRoot, "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const guard = read("autopilot-portable-staging/Assert-StagingEnvAuthority.ps1");
const launcher = read("autopilot-portable-staging/Invoke-Staging-One-Click.ps1");

assert.match(guard, /STAGING_ENV_AUTHORITY_FAIL_CLOSED/);
assert.match(guard, /\.env\.staging/);
assert.match(guard, /\$rawName\s+-cne\s+\$normalizedName/);
assert.match(guard, /Non-canonical environment key syntax is forbidden/);
assert.match(guard, /Duplicate environment key is forbidden after normalization/);
assert.match(guard, /\$seen\.ContainsKey\(\$normalizedName\)/);
assert.match(guard, /secrets_included\s*=\s*\$false/);
assert.match(guard, /production_mutation\s*=\s*\$false/);
assert.match(guard, /database_mutation\s*=\s*\$false/);
assert.match(guard, /provider_mutation\s*=\s*\$false/);
assert.doesNotMatch(guard, /Write-Host\s+\$line|Write-Output\s+\$line|ConvertTo-Json[\s\S]*?value\s*=/i);
assert.doesNotMatch(guard, /\$[A-Za-z_][A-Za-z0-9_]*\?\./, "guard must remain Windows PowerShell 5.1 compatible");

assert.match(launcher, /Assert-StagingEnvAuthority\.ps1/);
assert.match(launcher, /function Invoke-EnvAuthorityGuard/);
assert.match(launcher, /Invoke-EnvAuthorityGuard\s*\r?\n\$first = Invoke-Core/);
assert.match(launcher, /Staging environment authority guard exited with code/);

// The incident shape must be rejected by source contract: Compose accepts a
// whitespace-before-equals key while the exact PowerShell readers do not.
const canonical = "BACKEND_API_KEY=canonical";
const ambiguous = "BACKEND_API_KEY =compose-winner";
const normalize = (line) => {
  const equals = line.indexOf("=");
  const rawName = line.slice(0, equals);
  let normalizedName = rawName.trim();
  if (normalizedName.startsWith("export ")) normalizedName = normalizedName.slice(7).trim();
  return { rawName, normalizedName };
};
assert.equal(normalize(canonical).rawName, normalize(canonical).normalizedName);
assert.notEqual(normalize(ambiguous).rawName, normalize(ambiguous).normalizedName);
assert.equal(normalize(ambiguous).normalizedName, "BACKEND_API_KEY");

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-env-authority-contract.v1",
  ambiguous_key_syntax_rejected: true,
  duplicate_after_normalization_rejected: true,
  guard_runs_before_core: true,
  production_mutation: false,
  database_mutation: false,
  provider_mutation: false,
  secrets_included: false,
}, null, 2));
