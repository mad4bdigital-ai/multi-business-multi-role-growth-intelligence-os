import assert from "node:assert/strict";

import { buildDocsAgentCoordinationTelemetry, docsAgentGeneratedPaths } from "./scripts/docs-agent-runner.mjs";

const generatedPaths = docsAgentGeneratedPaths({ outDir: "docs/auto-docs-agent" });
assert.deepEqual(generatedPaths, ["docs/auto-docs-agent/README.md", "docs/auto-docs-agent/generated-note.md"]);

const telemetry = buildDocsAgentCoordinationTelemetry({
  branch: "gpt/docs-agent-advisory-coordination-test",
  outDir: "docs/auto-docs-agent",
  repository_current_state: {
    base_sha: "a".repeat(40),
    branch_sha: "b".repeat(40),
  },
});

assert.equal(telemetry.ok, true);
assert.equal(telemetry.mode, "advisory");
assert.equal(telemetry.tool_key, "docs_agent_commit");
assert.equal(telemetry.should_block, false);
assert.equal(telemetry.summary.path_count, 2);
assert.deepEqual(telemetry.summary.policy_groups, ["generated_docs"]);
assert.equal(telemetry.secrets_included, false);

console.log("docs agent coordination telemetry ok");
