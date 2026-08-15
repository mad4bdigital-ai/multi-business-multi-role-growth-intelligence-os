import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateConfigurationEntryGuard } from "./maintenance-tools/platform-configuration-entry-guard.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseRegistry = {
  contract: "mad4b.platform-configuration-entry-registry.v1",
  schema_version: 1,
  entries: [],
  ignored_changed_path_prefixes: ["docs/", "scripts/", "http-generic-api/scripts/"],
  safety: {
    values_included: false,
    secrets_included: false,
    runtime_mutation_allowed: false,
    database_mutation_allowed: false,
    production_activation_allowed: false,
  },
};

const candidate = (candidateClass, suggestedConfigKey) => ({
  candidate_id: "fixture-candidate",
  path: "http-generic-api/routes/exampleRoutes.js",
  line: 12,
  candidate_class: candidateClass,
  suggested_config_key: suggestedConfigKey,
  secrets_included: false,
});

const docsOnly = evaluateConfigurationEntryGuard({
  repositoryRoot,
  registry: baseRegistry,
  candidates: { candidates: [candidate("runtime_setting", "quota.max")] },
  changedFiles: ["docs/example.md"],
});
assert.equal(docsOnly.ok, true);

const missingRegistration = evaluateConfigurationEntryGuard({
  repositoryRoot,
  registry: baseRegistry,
  candidates: { candidates: [candidate("runtime_setting", "quota.max")] },
  changedFiles: ["http-generic-api/routes/exampleRoutes.js"],
});
assert.equal(missingRegistration.ok, false);
assert(missingRegistration.findings.some((item) => item.code === "CONFIG_ENTRY_REGISTRATION_MISSING"));

const policyCandidate = evaluateConfigurationEntryGuard({
  repositoryRoot,
  registry: baseRegistry,
  candidates: { candidates: [candidate("policy_candidate", "operation.policy")] },
  changedFiles: ["http-generic-api/routes/exampleRoutes.js"],
});
assert.equal(policyCandidate.ok, false);
assert(policyCandidate.findings.some((item) => item.code === "NEW_POLICY_CONFIGURATION_CANDIDATE"));

const secretCandidate = evaluateConfigurationEntryGuard({
  repositoryRoot,
  registry: baseRegistry,
  candidates: { candidates: [candidate("secret_candidate", "provider.api.key")] },
  changedFiles: ["http-generic-api/routes/exampleRoutes.js"],
});
assert.equal(secretCandidate.ok, false);
assert(secretCandidate.findings.some((item) => item.code === "NEW_SECRET_CONFIGURATION_CANDIDATE"));

const registered = evaluateConfigurationEntryGuard({
  repositoryRoot,
  registry: {
    ...baseRegistry,
    entries: [{
      config_key: "quota.max",
      schema_ref: ".specify/schemas/platform-configuration-entry-registry.schema.json",
      owner: "platform-governance",
      risk_class: "medium",
      scope_types: ["platform", "tenant"],
      binding_ref: "http-generic-api/migrations/20260815_platform_configuration_catalog_and_resolver.sql",
      resolver_ref: "http-generic-api/test-platform-configuration-resolver.mjs",
      readback_ref: "http-generic-api/test-platform-configuration-registry-adapter.mjs",
      shadow_evidence_ref: "docs/staging-production-shadow-profile-2026-08-14.json",
      classification: "runtime_setting",
      status: "shadow",
      secrets_included: false,
    }],
  },
  candidates: { candidates: [candidate("runtime_setting", "quota.max")] },
  changedFiles: ["http-generic-api/routes/exampleRoutes.js"],
});
assert.equal(registered.ok, true);
assert.deepEqual(registered.safety, {
  values_included: false,
  secrets_included: false,
  runtime_mutation_allowed: false,
  database_mutation_allowed: false,
  production_activation_allowed: false,
});

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.platform-configuration-entry-guard-regression.v1",
  cases: 5,
  repository_mutation_executed: false,
  database_mutation_executed: false,
  production_activation_executed: false,
  secrets_included: false,
}, null, 2));
