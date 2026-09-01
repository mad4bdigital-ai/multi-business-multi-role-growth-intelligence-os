import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageRoot = path.join(root, "autopilot-portable-staging");
const preflightPath = path.join(
  packageRoot,
  "Staging-Schema-Governance-Preflight.ps1",
);
const bootstrapPath = path.join(packageRoot, "Bootstrap-Staging-One-Click.ps1");
const oneClickContractPath = path.join(
  root,
  "http-generic-api",
  "test-staging-one-click-autopilot-contract.mjs",
);
const oneClickCoreContractPath = path.join(
  root,
  "http-generic-api",
  "test-staging-one-click-autopilot-core.mjs",
);
const smartGatewayContractPath = path.join(
  root,
  "http-generic-api",
  "test-staging-smart-gateway-convergence-contract.mjs",
);
const preflight = fs.readFileSync(preflightPath, "utf8");
const bootstrap = fs.readFileSync(bootstrapPath, "utf8");
const oneClickContract = fs.readFileSync(oneClickContractPath, "utf8");
const oneClickCoreContract = fs.readFileSync(oneClickCoreContractPath, "utf8");
const smartGatewayContract = fs.readFileSync(smartGatewayContractPath, "utf8");

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

// Bootstrap must not re-shallow the checkout to depth 1 because the preflight
// requires the exact checkout's first parent for environment-impact comparison.
assert.match(
  bootstrap,
  /Invoke-Git\s+@\("fetch",\s*"origin",\s*\$Ref,\s*"--depth=2"\)/,
);
assert.doesNotMatch(bootstrap, /--depth=1/);
assert.match(bootstrap, /\$firstParentRevision\s*=\s*"HEAD\^1"/);
assert.match(
  bootstrap,
  /\$firstParentCommit\s*=\s*Get-GitText\s+@\("rev-parse",\s*"--verify",\s*\$firstParentRevision\)/,
);
assert.ok(
  bootstrap.indexOf('$firstParentCommit = Get-GitText') <
    bootstrap.indexOf('$preflightReportPath ='),
);

// Node.js file URLs expose Windows drive paths as /C:/... URL pathnames.
// The contract that runs inside the Windows preflight delegates to the split
// Core and smart-gateway modules, so both imported modules must resolve from
// import.meta.dirname rather than passing URL pathname text to node:path.
assert.match(
  oneClickContract,
  /import "\.\/test-staging-one-click-autopilot-core\.mjs";/,
);
assert.match(
  oneClickContract,
  /import "\.\/test-staging-smart-gateway-convergence-contract\.mjs";/,
);
for (const delegatedContract of [oneClickCoreContract, smartGatewayContract]) {
  assert.match(
    delegatedContract,
    /const root = path\.resolve\(import\.meta\.dirname, "\.\."\);/,
  );
  assert.doesNotMatch(delegatedContract, /import\.meta\.url\)\.pathname/);
}

console.log(
  JSON.stringify({
    ok: true,
    contract: "mad4b.staging-schema-governance-powershell-revision-contract.v1",
    preserves_git_pseudo_revisions: true,
    bootstrap_preserves_first_parent_history: true,
    windows_node_file_url_paths_safe: true,
    production_mutation: false,
    database_mutation: false,
    provider_mutation: false,
    secrets_included: false,
  }),
);
