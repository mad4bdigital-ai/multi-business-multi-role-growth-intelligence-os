import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const inventoryWorkflow = await readFile(`${repoRoot}.github/workflows/repository-inventory.yml`, "utf8");
const evaluationWorkflow = await readFile(`${repoRoot}.github/workflows/repository-evaluation.yml`, "utf8");
const stagingEligibilityWorkflow = await readFile(`${repoRoot}.github/workflows/staging-main-deploy-eligibility.yml`, "utf8");

const inventoryAdvisoryBlock = inventoryWorkflow.match(
  /if \[\[ \"\$inventory_outcome\" == \"advisory\" \]\];[\s\S]*?\n\s*fi/,
)?.[0] || "";
assert.match(
  inventoryAdvisoryBlock,
  /followup_mode.*post_merge_observability_publish[\s\S]*non-blocking post-merge observability advisory[\s\S]*post_merge_observability_publish_required=true[\s\S]*exit 0/,
  "repository inventory advisory path must be explicit, non-blocking, and retain follow-up evidence",
);
assert.doesNotMatch(
  inventoryAdvisoryBlock,
  /exit 1/,
  "repository inventory advisory path must not fail the post-merge workflow",
);
assert.match(
  evaluationWorkflow,
  /EVENT_NAME.*push[\s\S]*non-blocking post-merge observability advisory[\s\S]*post_merge_observability_publish_required=true[\s\S]*exit 0/,
  "repository evaluation push advisory path must be explicit and non-blocking",
);
assert.match(
  evaluationWorkflow,
  /Exact-head Repository Evaluation verification failed[\s\S]*exit 1/,
  "unclassified evaluation verification failures must remain fail-closed",
);
assert.match(
  stagingEligibilityWorkflow,
  /node scripts\/remote-mcp-write-scope-semantic-currentness\.mjs/,
  "Staging eligibility must block on the registered semantic currentness projection",
);
assert.match(
  stagingEligibilityWorkflow,
  /npm run write-scopes:inventory:test/,
  "Staging eligibility must retain Remote MCP inventory regression tests",
);
assert.doesNotMatch(
  stagingEligibilityWorkflow,
  /npm run write-scopes:inventory:check/,
  "Staging eligibility must not promote post-merge observability-only inventory drift into a deployment blocker",
);
assert.match(
  stagingEligibilityWorkflow,
  /remote_mcp_semantic_currentness: true/,
  "Staging eligibility evidence must declare semantic currentness",
);
assert.match(
  stagingEligibilityWorkflow,
  /postmerge_observability_drift_blocking: false/,
  "Staging eligibility evidence must preserve the non-blocking post-merge observability policy",
);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.postmerge-observability-advisory.v1",
  inventory_advisory_non_blocking: true,
  evaluation_advisory_non_blocking: true,
  staging_eligibility_semantic_currentness_blocking: true,
  staging_eligibility_observability_non_blocking: true,
  unclassified_failures_fail_closed: true,
  secrets_included: false,
}));
