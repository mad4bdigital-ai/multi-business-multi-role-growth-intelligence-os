import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const foundation = read("http-generic-api/migrations/20260731_governed_policy_questionnaire_foundation.sql");
const registry = read("http-generic-api/migrations/20260731_governed_policy_registry_authority.sql");
const openapi = read("specs/012-tenant-activation-lifecycle/contracts/governed-policy-questionnaire.openapi.yaml");
const lifecycleSchema = JSON.parse(read("specs/012-tenant-activation-lifecycle/contracts/governed-policy-questionnaire.schema.json"));
const exposureSchema = JSON.parse(read("specs/012-tenant-activation-lifecycle/contracts/deployment-evidence-exposure-policy.schema.json"));
const attentionSchema = JSON.parse(read("specs/012-tenant-activation-lifecycle/contracts/activation-operational-attention-policy.schema.json"));
const tasks = read("specs/012-tenant-activation-lifecycle/tasks.md");

for (const migration of [foundation, registry]) {
  assert.match(migration, /intentionally (?:NOT|absent from)/i);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+`?governed_migration_authorization_registry`?/i);
  assert.doesNotMatch(migration, /allow_apply/i);
  assert.doesNotMatch(migration, /credential_ref/i);
  assert.doesNotMatch(migration, /provider[_ ]write/i);
  assert.match(migration, /secrets_included/);
}

for (const table of [
  "governed_policy_questionnaire_definitions",
  "governed_policy_sessions",
  "governed_policy_answers",
  "governed_policy_compilations",
  "governed_policy_proposals",
  "governed_policy_approvals",
  "governed_policy_versions",
  "governed_policy_invalidation_outbox",
  "governed_policy_rollbacks",
  "governed_policy_activations",
]) assert.match(foundation, new RegExp(`CREATE TABLE IF NOT EXISTS \\`${table}\\``));

assert.ok(foundation.indexOf("CREATE TABLE IF NOT EXISTS `governed_policy_invalidation_outbox`")
  < foundation.indexOf("CREATE TABLE IF NOT EXISTS `governed_policy_activations`"));
assert.match(foundation, /resource_uri_sha256/);
assert.match(registry, /governed_policy_safety_bounds/);
assert.match(registry, /governed_policy_domain_adoptions/);
assert.doesNotMatch(registry, /INSERT\s+INTO/i);

assert.equal(lifecycleSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.ok(lifecycleSchema.$defs.questionnaireDefinition);
assert.ok(lifecycleSchema.$defs.policyActivation);
assert.ok(lifecycleSchema.$defs.policyRollback);
assert.equal(exposureSchema.properties.deployment_mismatch_reconnect_required.const, false);
assert.equal(exposureSchema.properties.full_git_sha_tenant_visible.const, false);
assert.equal(attentionSchema.properties.cross_tenant_projection_allowed.const, false);
assert.equal(attentionSchema.properties.raw_error_message_exposed.const, false);
assert.equal(attentionSchema.properties.unknown_outcome_minimum_severity.const, "high");

assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /x-runtime-wired: false/);
assert.match(openapi, /x-migration-authorized: false/);
assert.match(openapi, /operationId: startTenantGovernedPolicyQuestionnaireSession/);
assert.match(openapi, /operationId: submitTenantGovernedPolicyQuestionnaireAnswers/);
assert.match(openapi, /operationId: submitTenantGovernedPolicyProposal/);
assert.match(openapi, /operationId: approveTenantGovernedPolicyProposal/);
assert.match(openapi, /operationId: activateTenantGovernedPolicyProposal/);
assert.match(openapi, /operationId: rollbackTenantGovernedPolicyVersion/);
assert.match(openapi, /Idempotency-Key/);
assert.match(openapi, /reconnect_required/);

assert.match(tasks, /- \[ \] \*\*T026\*\*/);
assert.doesNotMatch(read("http-generic-api/server.js"), /governedPolicyQuestionnaireService|governedPolicyLifecycleService/);
assert.doesNotMatch(read("http-generic-api/routes/index.js"), /governedPolicy/);

console.log("governed policy migration and contract tests passed");
