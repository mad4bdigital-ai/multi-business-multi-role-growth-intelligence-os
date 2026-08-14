import assert from "node:assert/strict";
import fs from "node:fs";

const CONTRACT = "mad4b.remote-mcp-write-scope-generated-refresh-recipe-test.v2";
const toolSource = fs.readFileSync("scripts/maintenance-tools/generated-artifact-refresh.mjs", "utf8");
const generatorAdapterSource = fs.readFileSync("scripts/remote-mcp-write-scope-inventory.mjs", "utf8");
const contractAdapterSource = fs.readFileSync("scripts/test-remote-mcp-write-scope-inventory.mjs", "utf8");
const writerWorkflowSource = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const verifierWorkflowSource = fs.readFileSync("../.github/workflows/remote-mcp-write-scope-verification.yml", "utf8");
const governance = JSON.parse(fs.readFileSync("../.github/repository-maintenance-tool-governance.json", "utf8"));

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
  assert.match(toolSource, /recipe === REMOTE_MCP_WRITE_SCOPE_RECIPE\) return REMOTE_MCP_WRITE_SCOPE_OUTPUTS\.has\(file\)/u);
});

check("auto-routing-is-currentness-aware-and-fail-closed", () => {
  const workMapIndex = toolSource.indexOf("if (hasSelfHostingTrigger)");
  const probeIndex = toolSource.indexOf("probeRemoteMcpWriteScopeStale()");
  assert.ok(workMapIndex >= 0 && probeIndex > workMapIndex, "Work Map self-hosting precedence must remain ahead of Remote MCP currentness routing");
  assert.match(toolSource, /Write-scope inventory artifacts are stale:/u);
  assert.match(toolSource, /remote_mcp_write_scope_probe_failed/u);
  assert.match(toolSource, /if \(probeRemoteMcpWriteScopeStale\(\)\) return REMOTE_MCP_WRITE_SCOPE_RECIPE/u);
  assert.match(toolSource, /return FRONTEND_OPENAPI_RECIPE/u);
});

check("package-local-adapters-delegate-to-canonical-root-sources", () => {
  assert.match(generatorAdapterSource, /import "\.\.\/\.\.\/scripts\/remote-mcp-write-scope-inventory\.mjs"/u);
  assert.match(contractAdapterSource, /import "\.\.\/\.\.\/scripts\/test-remote-mcp-write-scope-inventory\.mjs"/u);
  assert.doesNotMatch(generatorAdapterSource, /writeFileSync|execFileSync|spawnSync/u);
  assert.doesNotMatch(contractAdapterSource, /writeFileSync|execFileSync|spawnSync/u);
});

check("remote-recipe-proves-determinism-and-currentness", () => {
  assert.match(toolSource, /generate_remote_mcp_write_scope_first_pass/u);
  assert.match(toolSource, /generate_remote_mcp_write_scope_second_pass/u);
  assert.match(toolSource, /remote_mcp_write_scope_not_deterministic/u);
  assert.match(toolSource, /verify_remote_mcp_write_scope_current/u);
  assert.match(toolSource, /scripts\/remote-mcp-write-scope-inventory\.mjs", "--check"/u);
  assert.match(toolSource, /verify_remote_mcp_write_scope_contract/u);
  assert.match(toolSource, /scripts\/test-remote-mcp-write-scope-inventory\.mjs/u);
  assert.match(toolSource, /docs\(remote-mcp\): regenerate write-scope inventory/u);
});

check("writer-dispatch-registers-recipe-and-verifier", () => {
  assert.match(writerWorkflowSource, /- remote_mcp_write_scope_refresh/u);
  assert.match(writerWorkflowSource, /remote_mcp_write_scope_refresh\) ;;/u);
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

check("maintenance-governance-registers-only-two-remote-outputs", () => {
  const patterns = governance.tools?.["generated-artifact-refresh"]?.allowed_changed_path_patterns || [];
  assert.ok(patterns.includes("^http-generic-api/remote-mcp-write-scope-inventory\\.generated\\.json$"));
  assert.ok(patterns.includes("^docs/remote-mcp-write-scope-inventory\\.md$"));
  const remotePatterns = patterns.filter((pattern) => pattern.includes("remote-mcp-write-scope-inventory"));
  assert.equal(remotePatterns.length, 2);
});

const report = {
  contract: CONTRACT,
  ok: failures.length === 0,
  checks: 7,
  failures,
  repository_mutation: false,
  runtime_mutation: false,
  secrets_included: false,
};
console.log(JSON.stringify(report));
if (failures.length) process.exitCode = 1;
