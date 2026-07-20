import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("./routes/gptToolsRoutes.js", import.meta.url),
  "utf8"
);

const requiredPolicyTags = [
  "approval_required",
  "readback",
  "same_cycle_readback",
  "no_execution",
  "no_provider_write",
  "no_external_send",
  "no_secrets",
];

const tools = [
  {
    name: "growth_intelligence_insight_decide",
    path: "internal://growth-intelligence-insight-decide",
  },
  {
    name: "growth_intelligence_action_decide",
    path: "internal://growth-intelligence-action-decide",
  },
  {
    name: "growth_intelligence_readiness_refresh",
    path: "internal://growth-intelligence-readiness-refresh",
  },
];

for (const tool of tools) {
  const nameIndex = source.indexOf(`name: "${tool.name}"`);
  assert.notEqual(nameIndex, -1, `missing virtual tool ${tool.name}`);
  const nextToolIndex = source.indexOf("\n  {\n    name:", nameIndex + 1);
  const block = source.slice(nameIndex, nextToolIndex === -1 ? source.length : nextToolIndex);
  assert.match(block, new RegExp(tool.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const tag of requiredPolicyTags) {
    assert.match(block, new RegExp(`"${tag}"`), `${tool.name} must declare ${tag}`);
  }
  assert.doesNotMatch(block, /provider_write_allowed\s*:\s*true/);
  assert.doesNotMatch(block, /external_send_allowed\s*:\s*true/);
  assert.doesNotMatch(block, /execution_allowed\s*:\s*true/);
}

console.log("growth intelligence review mutation policy tests passed");
