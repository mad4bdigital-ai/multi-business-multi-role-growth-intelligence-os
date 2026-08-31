import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
const preflightPath = path.join(
  root,
  "autopilot-portable-staging",
  "Staging-Schema-Governance-Preflight.ps1",
);
const preflight = fs.readFileSync(preflightPath, "utf8");

assert.match(preflight, /\$headRevision\s*=\s*"HEAD"/);
assert.match(preflight, /\$baseRevision\s*=\s*"HEAD\^1"/);
assert.match(
  preflight,
  /\$observedCommit\s*=\s*\(Invoke-GitText\s+@\("rev-parse",\s*\$headRevision\)\)\.ToLowerInvariant\(\)/,
);
assert.match(
  preflight,
  /\$baseCommit\s*=\s*\(Invoke-GitText\s+@\("rev-parse",\s*\$baseRevision\)\)\.ToLowerInvariant\(\)/,
);

// Windows PowerShell 5.1 can bind member access to the final array/literal when
// parentheses are omitted, mutating HEAD^1 to head^1 before Git receives it.
assert.doesNotMatch(
  preflight,
  /Invoke-GitText\s+@\("rev-parse",\s*"HEAD(?:\^1)?"\)\.ToLowerInvariant\(\)/,
);

console.log(
  JSON.stringify({
    ok: true,
    contract: "mad4b.staging-schema-governance-powershell-revision-contract.v1",
    preserves_git_pseudo_revisions: true,
    production_mutation: false,
    database_mutation: false,
    provider_mutation: false,
    secrets_included: false,
  }),
);
