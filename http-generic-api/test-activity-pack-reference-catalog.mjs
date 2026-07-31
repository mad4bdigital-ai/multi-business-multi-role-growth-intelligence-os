import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReferencePackCatalog, validateReferencePackCatalog } from "./src/domain/growthControlPlane/referencePackFactory.js";
import { validateActivityPackManifest } from "./src/domain/growthControlPlane/growthControlPlane.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(currentDir, "fixtures");
const catalog = JSON.parse(readFileSync(join(fixtureDir, "activity-pack-reference-catalog.json"), "utf8"));
const travelManifest = JSON.parse(readFileSync(join(fixtureDir, "travel-activity-pack-reference.json"), "utf8"));

const expectedProfileKeys = [
  "b2b_product_knowledge_profile",
  "business_services_knowledge_profile",
  "connectivity_service_knowledge_profile",
  "consumer_service_knowledge_profile",
  "destination_travel_knowledge_profile",
  "education_service_knowledge_profile",
  "employment_career_knowledge_profile",
  "expert_service_knowledge_profile",
  "financial_service_knowledge_profile",
  "fitness_recreation_knowledge_profile",
  "food_dining_knowledge_profile",
  "gift_event_retail_knowledge_profile",
  "home_garden_knowledge_profile",
  "hvac_knowledge_profile",
  "media_entertainment_knowledge_profile",
  "property_service_knowledge_profile",
  "retail_home_service_knowledge_profile",
  "retail_personal_care_knowledge_profile",
  "retail_product_knowledge_profile",
  "seasonal_retail_knowledge_profile",
  "software_service_knowledge_profile",
  "stay_guest_service_knowledge_profile",
  "ticketing_event_knowledge_profile",
  "travel_knowledge_profile",
  "vehicle_auto_service_knowledge_profile"
];

const validatedCatalog = validateReferencePackCatalog(catalog);
assert.equal(validatedCatalog.schemaVersion, 1);
assert.equal(validatedCatalog.profiles.length, expectedProfileKeys.length);
assert.deepEqual(validatedCatalog.profiles.map((entry) => entry.knowledgeProfileKey).sort(), expectedProfileKeys);

const packs = createReferencePackCatalog(validatedCatalog, {
  specializedManifests: { travel_knowledge_profile: travelManifest }
});

assert.equal(packs.length, expectedProfileKeys.length);
assert.equal(packs.filter(({ catalogEntry }) => catalogEntry.referenceMode === "specialized").length, 1);
assert.equal(packs.filter(({ catalogEntry }) => catalogEntry.referenceMode === "baseline").length, expectedProfileKeys.length - 1);

const profileKeys = new Set();
const activityPackKeys = new Set();
const checksumByProfile = new Map();
const forbiddenKeys = ["file_path", "file_paths", "drive_id", "drive_ids", "prompt_body", "prompt_bodies"];

for (const { catalogEntry, manifest } of packs) {
  assert.equal(profileKeys.has(catalogEntry.knowledgeProfileKey), false);
  assert.equal(activityPackKeys.has(catalogEntry.activityPackKey), false);
  profileKeys.add(catalogEntry.knowledgeProfileKey);
  activityPackKeys.add(catalogEntry.activityPackKey);

  assert.equal(manifest.knowledgeProfile.pointerKey, catalogEntry.knowledgeProfileKey);
  assert.equal(manifest.identity.activityPackKey, catalogEntry.activityPackKey);
  assert.deepEqual(manifest.providerCompatibility, []);

  const firstValidation = validateActivityPackManifest(manifest);
  const secondValidation = validateActivityPackManifest(JSON.parse(JSON.stringify(manifest)));
  assert.match(firstValidation.checksumSha256, /^[a-f0-9]{64}$/);
  assert.equal(firstValidation.checksumSha256, secondValidation.checksumSha256);
  assert.equal(firstValidation.secretsIncluded, false);
  checksumByProfile.set(catalogEntry.knowledgeProfileKey, firstValidation.checksumSha256);

  const serializedManifest = JSON.stringify(firstValidation.manifest);
  for (const forbiddenKey of forbiddenKeys) {
    assert.equal(serializedManifest.includes(`"${forbiddenKey}"`), false);
  }

  const declaredCapabilities = new Set(firstValidation.manifest.capabilities.map(({ capabilityKey }) => capabilityKey));
  for (const workflow of firstValidation.manifest.workflows) {
    for (const node of workflow.nodes) {
      assert.equal(declaredCapabilities.has(node.capability), true, `${workflow.workflowKey}.${node.id} must reference a declared capability`);
    }
  }
}

assert.equal(checksumByProfile.size, expectedProfileKeys.length);
assert.equal(checksumByProfile.get("travel_knowledge_profile"), validateActivityPackManifest(travelManifest).checksumSha256);

const extensibleCatalog = {
  schemaVersion: 1,
  profiles: [
    {
      businessTypeKey: "future_service",
      knowledgeProfileKey: "future_service_knowledge_profile",
      activityPackKey: "future_service.reference_pack",
      version: 1,
      referenceMode: "baseline",
      engineCategories: [],
      routeKeys: [],
      workflowKeys: []
    }
  ]
};
const [futurePack] = createReferencePackCatalog(extensibleCatalog);
assert.equal(futurePack.manifest.knowledgeProfile.pointerKey, "future_service_knowledge_profile");
assert.deepEqual(futurePack.manifest.workflows, []);
assert.match(validateActivityPackManifest(futurePack.manifest).checksumSha256, /^[a-f0-9]{64}$/);

const duplicateProfileCatalog = JSON.parse(JSON.stringify(extensibleCatalog));
duplicateProfileCatalog.profiles.push(JSON.parse(JSON.stringify(duplicateProfileCatalog.profiles[0])));
assert.throws(() => validateReferencePackCatalog(duplicateProfileCatalog), /duplicate businessTypeKey/);

const mismatchedSpecializedCatalog = {
  schemaVersion: 1,
  profiles: [
    {
      businessTypeKey: "specialized_service",
      knowledgeProfileKey: "specialized_service_knowledge_profile",
      activityPackKey: "specialized_service.reference_pack",
      version: 1,
      referenceMode: "specialized",
      engineCategories: [],
      routeKeys: [],
      workflowKeys: []
    }
  ]
};
assert.throws(
  () => createReferencePackCatalog(mismatchedSpecializedCatalog, {
    specializedManifests: { specialized_service_knowledge_profile: travelManifest }
  }),
  /activityPackKey mismatch/
);

console.log("activity pack reference catalog tests passed");
