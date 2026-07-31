import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateActivityPackManifest } from "./src/domain/growthControlPlane/growthControlPlane.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(currentDir, "fixtures", "travel-activity-pack-reference.json");
const activityPack = JSON.parse(readFileSync(fixturePath, "utf8"));

const firstValidation = validateActivityPackManifest(activityPack);
const secondValidation = validateActivityPackManifest(JSON.parse(JSON.stringify(activityPack)));

assert.match(firstValidation.checksumSha256, /^[a-f0-9]{64}$/);
assert.equal(firstValidation.checksumSha256, secondValidation.checksumSha256);
assert.equal(firstValidation.secretsIncluded, false);
assert.equal(firstValidation.manifest.identity.activityPackKey, "travel.reference_pack");
assert.equal(firstValidation.manifest.knowledgeProfile.pointerKey, "travel_knowledge_profile");
assert.deepEqual(
  firstValidation.manifest.workflows.map((workflow) => workflow.workflowKey),
  [
    "content_generation_workflow",
    "destination_analysis_workflow",
    "brand_marketing_workflow"
  ]
);
assert.deepEqual(firstValidation.manifest.providerCompatibility, []);

const serializedFixture = JSON.stringify(activityPack);
for (const forbiddenKey of ["file_path", "file_paths", "drive_id", "drive_ids", "prompt_body", "prompt_bodies"]) {
  assert.equal(serializedFixture.includes(`\"${forbiddenKey}\"`), false);
}

const inlinePrompt = JSON.parse(JSON.stringify(activityPack));
inlinePrompt.workflows[0].nodes[0].promptBody = "inline prompt content is forbidden";
assert.throws(
  () => validateActivityPackManifest(inlinePrompt),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_PACK_INVALID"
    && error.status === 422
    && error.details.some((detail) => detail.issue === "inline_pointer_forbidden")
);

console.log("travel activity pack reference tests passed");
