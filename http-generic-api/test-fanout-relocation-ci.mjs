import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const taxonomy = JSON.parse(readFileSync(new URL("./scripts/taxonomy/script-taxonomy.json", import.meta.url), "utf8"));
const relocator = readFileSync(new URL("./scripts/fanout-relocation-ci.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/http-generic-api-fanout-relocation.yml", import.meta.url), "utf8");

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

assert.match(workflow, /(?:^|\n)\s*pull_request\s*:/u);
assert.match(workflow, /(?:^|\n)\s*contents\s*:\s*read\b/u);
assert.match(workflow, /FANOUT_RELOCATION_MODE:\s*report/u);
assert.match(workflow, /Report fanout relocation taxonomy/u);
assert.match(workflow, /Validate relocation tooling/u);
assert.doesNotMatch(workflow, /(?:^|\n)\s*workflow_dispatch\s*:/u);
assert.doesNotMatch(workflow, /(?:^|\n)\s*contents\s*:\s*write\b/u);
assert.doesNotMatch(workflow, /mode\s*==\s*['"]apply['"]/u);
assert.doesNotMatch(workflow, /Apply safe fanout relocations/u);
assert.doesNotMatch(workflow, /\bgit\s+push\b/iu);
assert.doesNotMatch(workflow, /Refusing to apply relocation on protected branch/u);
assert.doesNotMatch(relocator, /process\.env\.(TOKEN|SECRET|PASSWORD|API_KEY)/i);

console.log("fanout relocation read-only PR contract test passed");
