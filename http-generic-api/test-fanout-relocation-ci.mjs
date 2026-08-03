import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taxonomy = JSON.parse(readFileSync(new URL("./scripts/taxonomy/script-taxonomy.json", import.meta.url), "utf8"));
const relocator = readFileSync(new URL("./scripts/fanout-relocation-ci.mjs", import.meta.url), "utf8");
const reportWorkflow = readFileSync(new URL("../.github/workflows/http-generic-api-fanout-relocation.yml", import.meta.url), "utf8");
const applyWorkflow = readFileSync(new URL("../.github/workflows/http-generic-api-fanout-relocation-apply.yml", import.meta.url), "utf8");

const categories = new Set(taxonomy.categories.map((category) => category.key));
for (const expected of [
  "activation",
  "ads",
  "agent-runtime",
  "audit",
  "backup",
  "capability",
  "cloudflare",
  "cms",
  "connectors",
  "credentials",
  "database",
  "dev",
  "docs",
  "execution",
  "hostinger",
  "openapi",
  "platform",
  "runtime",
  "tools",
  "tenant",
  "uncategorized",
]) assert(categories.has(expected), `missing taxonomy category ${expected}`);

assert.equal(taxonomy.safety.applyRequiresWorkflowDispatch, true);
assert.equal(taxonomy.safety.secretsIncluded, false);
assert(taxonomy.safety.forbidProtectedBranches.includes("main"));
assert.match(relocator, /protectedBranches\.has\(branchName\)/);
assert.match(relocator, /manual_review/);
assert.match(relocator, /relative_sibling_script_import/);
assert.match(relocator, /safe_to_move/);
assert.match(relocator, /updateReferences/);

assert.match(reportWorkflow, /pull_request:/);
assert.match(reportWorkflow, /workflow_dispatch:/);
assert.match(reportWorkflow, /permissions:\s+[\s\S]*contents: read/);
assert.match(reportWorkflow, /FANOUT_RELOCATION_MODE: report/);
assert.doesNotMatch(reportWorkflow, /contents: write/);
assert.doesNotMatch(reportWorkflow, /mode == 'apply'/);
assert.doesNotMatch(reportWorkflow, /git push/);

assert.match(applyWorkflow, /workflow_dispatch:/);
assert.match(applyWorkflow, /expected_head_sha:/);
assert.match(applyWorkflow, /EXPECTED_HEAD_SHA/);
assert.match(applyWorkflow, /current_head_sha/);
assert.match(applyWorkflow, /TARGET_BRANCH/);
assert.match(applyWorkflow, /"main"/);
assert.match(applyWorkflow, /"Production"/);
assert.match(applyWorkflow, /git push origin "HEAD:refs\/heads\/\$\{TARGET_BRANCH\}"/);
assert.doesNotMatch(applyWorkflow, /pull_request:/);
assert.doesNotMatch(applyWorkflow, /--force(?:-with-lease)?/);
assert.doesNotMatch(relocator, /process\.env\.(TOKEN|SECRET|PASSWORD|API_KEY)/i);

console.log("fanout relocation split workflow contract passed");
