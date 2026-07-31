import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canonicalizeShadowValue,
  compareGrowthControlShadowParity,
  hashShadowValue
} from "./src/domain/growthControlPlane/growthControlShadowParity.js";
import { createGrowthControlShadowParityService } from "./src/application/growthControlPlane/growthControlShadowParityService.js";
import { createGrowthControlShadowParityRepository } from "./src/infrastructure/growthControlPlane/growthControlShadowParityRepository.js";

const SECRET = "secret-raw-value-must-never-persist";
const CONFIG_KEY = "growth.execution.policy";
const LEGACY_KEY = "legacy.growth.execution.policy";
const BASE_MAPPING = Object.freeze({
  growthConfigKey: CONFIG_KEY,
  legacyConfigKey: LEGACY_KEY,
  growthPath: "policy",
  legacyPath: "policy",
  privilegePaths: ["allowExternalWrite", "capabilities"]
});

assert.equal(
  canonicalizeShadowValue({ b: 2, a: { z: true, y: [2, 1] } }),
  canonicalizeShadowValue({ a: { y: [2, 1], z: true }, b: 2 })
);
assert.equal(
  hashShadowValue({ b: 2, a: 1 }),
  hashShadowValue({ a: 1, b: 2 })
);

const match = compareGrowthControlShadowParity({
  mapping: BASE_MAPPING,
  growthValue: { policy: { allowExternalWrite: false, capabilities: ["read"] } },
  legacyValue: { policy: { capabilities: ["read"], allowExternalWrite: false } }
});
assert.equal(match.classification, "match");
assert.equal(match.action, "accept_shadow_match");
assert.equal(match.blocksCutover, false);

const translated = compareGrowthControlShadowParity({
  mapping: {
    ...BASE_MAPPING,
    normalizeLegacy: (value) => ({ ...value, enabled: value.enabled === "yes" })
  },
  growthValue: { policy: { enabled: true } },
  legacyValue: { policy: { enabled: "yes" } }
});
assert.equal(translated.classification, "expected_semantic_translation");
assert.equal(translated.explanationCode, "registered_normalization_matches");

const privilegeExpansion = compareGrowthControlShadowParity({
  mapping: BASE_MAPPING,
  growthValue: { policy: { allowExternalWrite: true, capabilities: ["read", "send"] } },
  legacyValue: { policy: { allowExternalWrite: false, capabilities: ["read"] } }
});
assert.equal(privilegeExpansion.classification, "privilege_expansion");
assert.equal(privilegeExpansion.severity, "critical");
assert.equal(privilegeExpansion.action, "block_rollout");
assert.equal(privilegeExpansion.blocksCutover, true);

const missing = compareGrowthControlShadowParity({
  mapping: BASE_MAPPING,
  growthValue: { policy: { allowExternalWrite: false } },
  legacyValue: undefined,
  legacyPresent: false
});
assert.equal(missing.classification, "missing_evidence");
assert.equal(missing.blocksCutover, true);

const notComparable = compareGrowthControlShadowParity({
  mapping: null,
  growthValue: { policy: { token: SECRET } }
});
assert.equal(notComparable.classification, "not_comparable");
assert.equal(notComparable.action, "skip_not_comparable");
assert.equal(notComparable.legacyHash, null);

const policyDifference = compareGrowthControlShadowParity({
  mapping: { ...BASE_MAPPING, expectedDifference: "policy_difference" },
  growthValue: { policy: { threshold: 2 } },
  legacyValue: { policy: { threshold: 1 } }
});
assert.equal(policyDifference.classification, "policy_difference");
assert.equal(policyDifference.action, "require_human_review");

for (const comparison of [match, translated, privilegeExpansion, missing, notComparable, policyDifference]) {
  const serialized = JSON.stringify(comparison);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(comparison.providerApplyAllowed, false);
  assert.equal(comparison.externalWriteAllowed, false);
  assert.equal(comparison.mutationAllowed, false);
  assert.equal(comparison.enforcementCutover, false);
  assert.equal(comparison.secretsIncluded, false);
  assert.equal(comparison.rawPayloadIncluded, false);
  assert.equal(comparison.promptIncluded, false);
}

const recorded = [];
const observer = createGrowthControlShadowParityService({
  repository: {
    async getMapping(configKey) {
      assert.equal(configKey, CONFIG_KEY);
      return BASE_MAPPING;
    },
    async readLegacyRuntimeConfig(configKey) {
      assert.equal(configKey, LEGACY_KEY);
      return { value: { policy: { allowExternalWrite: false, capabilities: ["read"], hidden: SECRET } } };
    },
    async recordEvidence(evidence) {
      recorded.push(evidence);
      return { evidenceId: evidence.evidenceId, recorded: true };
    }
  },
  uuid: () => "11111111-1111-4111-8111-111111111111",
  now: () => new Date("2026-07-25T18:00:00.000Z")
});
const observation = await observer.observe({
  configKey: CONFIG_KEY,
  resolutionId: "22222222-2222-4222-8222-222222222222",
  context: {
    tenantId: "33333333-3333-4333-8333-333333333333",
    workspaceId: "44444444-4444-4444-8444-444444444444",
    brandKey: "example-brand"
  },
  growthValue: { policy: { allowExternalWrite: false, capabilities: ["read"], hidden: SECRET } }
});
assert.equal(observation.observed, true);
assert.equal(observation.authoritativeResultUnchanged, true);
assert.equal(recorded.length, 1);
assert.equal(recorded[0].classification, "match");
assert.equal(JSON.stringify(recorded[0]).includes(SECRET), false);
assert.equal(Object.hasOwn(recorded[0], "growthValue"), false);
assert.equal(Object.hasOwn(recorded[0], "legacyValue"), false);

const isolatedFailure = createGrowthControlShadowParityService({
  repository: {
    async getMapping() {
      throw new Error(`database failed with ${SECRET}`);
    }
  }
});
const failedObservation = await isolatedFailure.observeSafely({
  configKey: CONFIG_KEY,
  growthValue: { policy: { token: SECRET } }
});
assert.equal(failedObservation.observed, false);
assert.equal(failedObservation.classification, "adaptive_error");
assert.equal(failedObservation.authoritativeResultUnchanged, true);
assert.equal(JSON.stringify(failedObservation).includes(SECRET), false);

const sqlCalls = [];
const repository = createGrowthControlShadowParityRepository({
  pool: {
    async query(statement, params) {
      sqlCalls.push({ statement, params });
      if (statement.includes("FROM growth_control_shadow_parity_mappings")) {
        return [[{
          growthConfigKey: CONFIG_KEY,
          legacyConfigKey: LEGACY_KEY,
          growthPath: "policy",
          legacyPath: "policy",
          privilegePathsJson: JSON.stringify(["allowExternalWrite"]),
          expectedDifference: null
        }]];
      }
      if (statement.includes("FROM platform_runtime_config")) {
        return [[{ configJson: JSON.stringify({ policy: { allowExternalWrite: false, token: SECRET } }), updatedAt: null }]];
      }
      return [{ affectedRows: 1 }];
    }
  }
});
const storedMapping = await repository.getMapping(CONFIG_KEY);
assert.deepEqual(storedMapping.privilegePaths, ["allowExternalWrite"]);
const legacyRecord = await repository.readLegacyRuntimeConfig(LEGACY_KEY);
assert.equal(legacyRecord.value.policy.token, SECRET);
await repository.recordEvidence(recorded[0]);
assert.match(sqlCalls[0].statement, /growth_config_key = \?/);
assert.deepEqual(sqlCalls[0].params, [CONFIG_KEY]);
assert.match(sqlCalls[1].statement, /config_key = \?/);
assert.deepEqual(sqlCalls[1].params, [LEGACY_KEY]);
const insertCall = sqlCalls.at(-1);
assert.match(insertCall.statement, /INSERT INTO growth_control_shadow_parity_evidence/);
assert.equal(insertCall.statement.includes("config_json"), false);
assert.equal(insertCall.statement.includes("raw_payload"), true);
assert.equal(insertCall.params.some((value) => typeof value === "string" && value.includes(SECRET)), false);

const migration = readFileSync("migrations/20260725_growth_control_shadow_parity.sql", "utf8");
assert(migration.includes("growth_control_shadow_parity_mappings"));
assert(migration.includes("growth_control_shadow_parity_evidence"));
assert(migration.includes("v_growth_control_shadow_parity_summary"));
assert(migration.includes("critical_mismatch_count"));
assert.equal(/\bDROP\s+(TABLE|VIEW)\b/i.test(migration), false);
assert.equal(/\bALTER\s+TABLE\b/i.test(migration), false);
assert.equal(migration.includes(SECRET), false);

const repositorySource = readFileSync("src/infrastructure/growthControlPlane/growthControlShadowParityRepository.js", "utf8");
assert(repositorySource.includes("platform_runtime_config"));
assert(repositorySource.includes("growth_control_shadow_parity_evidence"));
assert.equal(repositorySource.includes("providerApplyAllowed: true"), false);
assert.equal(repositorySource.includes("externalWriteAllowed: true"), false);

const controlPlaneServiceSource = readFileSync("src/application/growthControlPlane/growthControlPlaneService.js", "utf8");
assert(controlPlaneServiceSource.includes("shadowParityObserver = null"));
assert(controlPlaneServiceSource.includes("await shadowParityObserver.observeSafely"));
assert(controlPlaneServiceSource.includes("growthValue: result"));
assert.equal(controlPlaneServiceSource.includes("shadowParity:"), false);
assert(
  controlPlaneServiceSource.indexOf("await shadowParityObserver.observeSafely")
    < controlPlaneServiceSource.indexOf("return Object.freeze({ ...snapshot, scopeHierarchy")
);

const routeSource = readFileSync("routes/dynamicGrowthControlPlaneRoutes.js", "utf8");
assert(routeSource.includes("GROWTH_CONTROL_SHADOW_PARITY_ENABLED"));
assert(routeSource.includes("=== \"true\""));
assert(routeSource.includes("service || !shadowParityEnabled"));
assert(routeSource.includes("createGrowthControlShadowParityRepository"));
assert(routeSource.includes("createGrowthControlShadowParityService"));
assert(routeSource.includes("createGrowthControlPlaneService({ repository, shadowParityObserver })"));
assert.equal(routeSource.includes("shadowParityEnabled = true"), false);

console.log("growth control shadow parity tests passed");
