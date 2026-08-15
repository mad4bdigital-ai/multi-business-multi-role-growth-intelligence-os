import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateRepository } from "./e2e-phase-governance.mjs";

const CONTRACT = "mad4b.remote-mcp-write-scope-generated-refresh-recipe-test.v4";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readRepositoryFile = (...parts) => fs.readFileSync(path.join(repositoryRoot, ...parts), "utf8");
const toolSource = readRepositoryFile("http-generic-api", "scripts", "maintenance-tools", "generated-artifact-refresh.mjs");
const generatorSource = readRepositoryFile("scripts", "remote-mcp-write-scope-inventory.mjs");
const contractSource = readRepositoryFile("scripts", "test-remote-mcp-write-scope-inventory.mjs");
const writerWorkflowSource = readRepositoryFile(".github", "workflows", "governed-generated-artifact-refresh.yml");
const verifierWorkflowSource = readRepositoryFile(".github", "workflows", "remote-mcp-write-scope-verification.yml");
const stagingClosureSource = readRepositoryFile("http-generic-api", "test-staging-autopilot-closure.mjs");
const governance = JSON.parse(readRepositoryFile(".github", "repository-maintenance-tool-governance.json"));
const e2ePolicy = JSON.parse(readRepositoryFile(".specify", "e2e-phase-governance.json"));

const failures = [];
function check(id, fn) {
  try {
    fn();
  } catch (error) {
    failures.push({ id, message: String(error?.message || error).slice(0, 2000) });
  }
}

check("recipe-is-explicit-and-bounded", () => {
  assert.match(toolSource, /REMOTE_MCP_WRITE_SCOPE_RECIPE = "remote_mcp_write_scope_refresh"/u);
  assert.match(toolSource, /REMOTE_MCP_WRITE_SCOPE_OUTPUTS = new Set/u);
  assert.match(toolSource, /http-generic-api\/remote-mcp-write-scope-inventory\.generated\.json/u);
  assert.match(toolSource, /docs\/remote-mcp-write-scope-inventory\.md/u);
  assert.match(toolSource, /autopilot-portable-staging\/manifest\.json/u);
  assert.match(toolSource, /recipe === REMOTE_MCP_WRITE_SCOPE_RECIPE\) return REMOTE_MCP_WRITE_SCOPE_OUTPUTS\.has\(file\)/u);
});

check("auto-routing-is-currentness-aware-and-fail-closed", () => {
  assert.match(toolSource, /hasSelfHostingTrigger/u);
  assert.match(toolSource, /remoteMcpWriteScopeInventoryIsCurrent\(\)/u);
  assert.match(toolSource, /Write-scope inventory artifacts are stale:/u);
  assert.match(toolSource, /remote_mcp_write_scope_currentness_probe_failed/u);
  assert.match(toolSource, /if \(!remoteMcpWriteScopeInventoryIsCurrent\(\)\) return REMOTE_MCP_WRITE_SCOPE_RECIPE/u);
  assert.match(toolSource, /return FRONTEND_OPENAPI_RECIPE/u);
});

check("canonical-root-sources-and-contract-test-are-present", () => {
  assert.match(generatorSource, /writeFileSync/u);
  assert.match(generatorSource, /generated_from: "git-index-and-runtime-catalog"/u);
  assert.match(contractSource, /write_activation_allowed, false/u);
  assert.match(contractSource, /secrets_included, false/u);
});

check("remote-recipe-proves-determinism-currentness-and-manifest-convergence", () => {
  assert.match(toolSource, /generate_remote_mcp_write_scope_first_pass/u);
  assert.match(toolSource, /generate_remote_mcp_write_scope_second_pass/u);
  assert.match(toolSource, /remote_mcp_write_scope_not_deterministic/u);
  assert.match(toolSource, /updateRemoteMcpManifestHash/u);
  assert.match(toolSource, /remote_mcp_manifest_entry_cardinality_invalid/u);
  assert.match(toolSource, /verify_remote_mcp_write_scope_current/u);
  assert.match(toolSource, /scripts\/remote-mcp-write-scope-inventory\.mjs", "--check"/u);
  assert.match(toolSource, /verify_remote_mcp_write_scope_contract/u);
  assert.match(toolSource, /scripts\/test-remote-mcp-write-scope-inventory\.mjs/u);
  assert.match(toolSource, /verify_staging_manifest_hash_contract/u);
  assert.match(toolSource, /http-generic-api\/test-staging-autopilot-closure\.mjs/u);
  assert.match(toolSource, /docs\(remote-mcp\): regenerate write-scope inventory/u);
  assert.match(stagingClosureSource, /for \(const entry of manifest\.files\)/u);
  assert.match(stagingClosureSource, /manifest hash mismatch/u);
});

check("writer-dispatch-registers-recipe-and-dedicated-verifier", () => {
  assert.match(writerWorkflowSource, /- remote_mcp_write_scope_refresh/u);
  assert.match(writerWorkflowSource, /remote_mcp_write_scope_refresh/u);
  assert.match(writerWorkflowSource, /remote-mcp-write-scope-verification\.yml/u);
  assert.match(writerWorkflowSource, /Remote MCP Write-Scope Verification/u);
  assert.match(writerWorkflowSource, /expected_head_sha/u);
});

check("remote-verifier-is-read-only-exact-head-and-root-scoped", () => {
  assert.match(verifierWorkflowSource, /workflow_dispatch:/u);
  assert.match(verifierWorkflowSource, /target_ref:/u);
  assert.match(verifierWorkflowSource, /expected_head_sha:/u);
  assert.match(verifierWorkflowSource, /permissions:\s*\n\s*contents:\s*read/u);
  assert.doesNotMatch(verifierWorkflowSource, /contents:\s*write/u);
  assert.doesNotMatch(verifierWorkflowSource, /git\s+push/u);
  assert.match(verifierWorkflowSource, /ref:\s*\$\{\{ inputs\.expected_head_sha \}\}/u);
  assert.match(verifierWorkflowSource, /remote_sha=.*gh api/u);
  assert.match(verifierWorkflowSource, /test "\$remote_sha" = "\$EXPECTED_HEAD_SHA"/u);
  assert.match(verifierWorkflowSource, /run: npm run write-scopes:inventory:check/u);
  assert.match(verifierWorkflowSource, /run: npm run write-scopes:inventory:test/u);
  assert.doesNotMatch(verifierWorkflowSource, /working-directory:\s*http-generic-api/u);
});

check("maintenance-governance-registers-exact-three-remote-refresh-outputs", () => {
  const patterns = governance.tools?.["generated-artifact-refresh"]?.allowed_changed_path_patterns || [];
  const expectedPatterns = [
    "^http-generic-api/remote-mcp-write-scope-inventory\\.generated\\.json$",
    "^docs/remote-mcp-write-scope-inventory\\.md$",
    "^autopilot-portable-staging/manifest\\.json$",
  ];
  for (const pattern of expectedPatterns) assert.ok(patterns.includes(pattern), `missing governed Remote MCP refresh output: ${pattern}`);
});

check("e2e-phase-classifies-bounded-refresh-tooling-as-governance-only", () => {
  const governanceOnlyFiles = [
    ".github/workflows/remote-mcp-write-scope-verification.yml",
    ".github/repository-maintenance-tool-governance.json",
    "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs",
    "scripts/remote-mcp-write-scope-inventory.mjs",
    "scripts/schema-docs-change-guard.mjs",
    "http-generic-api/scripts/test-remote-mcp-write-scope-generated-refresh-recipe.mjs",
    "scripts/test-remote-mcp-write-scope-inventory.mjs",
  ];
  const result = evaluateRepository({
    root: repositoryRoot,
    policy: e2ePolicy,
    changedFiles: governanceOnlyFiles,
    baseRef: "main",
  });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.findings));
  assert.equal(result.report.change_class, "governance_only");
  assert.deepEqual(result.report.runtime_files, []);

  const runtimeControl = evaluateRepository({
    root: repositoryRoot,
    policy: e2ePolicy,
    changedFiles: ["http-generic-api/scripts/runtime-request-handler.mjs"],
    baseRef: "main",
  });
  assert.equal(runtimeControl.report.change_class, "feature");
  assert.equal(runtimeControl.report.ok, false);
  assert.ok(runtimeControl.report.findings.some((finding) => finding.code === "feature_change_missing_e2e_phase_contract"));
});

const report = {
  contract: CONTRACT,
  ok: failures.length === 0,
  checks: 8,
  failures,
  repository_mutation: false,
  runtime_mutation: false,
  secrets_included: false,
};
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;