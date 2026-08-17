import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const contractPath = path.join(root, "specs/020-platform-resource-identity-brand-governance/contracts/custom-gpt-environment-aware-contract.json");
const instructionPath = path.join(root, "docs/custom-gpt-environment-routing-instructions.md");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const instructions = fs.readFileSync(instructionPath, "utf8");

function loadOpenApi(relativePath) {
  return YAML.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function operations(document) {
  const allowed = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
  return Object.entries(document.paths || {}).flatMap(([route, item]) => Object.entries(item || {})
    .filter(([method]) => allowed.has(method))
    .map(([method, operation]) => ({ route, method: method.toUpperCase(), operation })));
}

assert.equal(contract.schema_version, "mad4b.custom-gpt-environment-aware-contract.v1");
assert.equal(contract.contract_status, "prepared_only");
assert.equal(contract.default_environment, "staging");
assert.deepEqual(contract.environment_selection.allowed_values, ["staging", "production"]);
assert.equal(contract.environment_selection.missing_environment_action, "deny_and_request_explicit_selection");
assert.equal(contract.environment_selection.unknown_environment_action, "deny_and_do_not_fallback");
assert.equal(contract.environment_selection.cross_environment_fallback, false);

const staging = contract.environments.staging;
const production = contract.environments.production;
assert.equal(staging.server_url, "https://dev.mad4b.com");
assert.equal(production.server_url, "https://auth.mad4b.com");
assert.equal(staging.credential_namespace, "staging.auth");
assert.equal(production.credential_namespace, "production.auth");
assert.deepEqual(staging.allowed_methods, ["GET"]);
assert.deepEqual(production.allowed_methods, ["GET"]);
assert.equal(staging.read_only, true);
assert.equal(production.read_only, true);
assert.equal(production.promotion_required_for_non_get, true);
assert.equal(contract.activation_boundary.route_wiring, false);
assert.equal(contract.activation_boundary.runtime_authority, false);
assert.equal(contract.activation_boundary.production_activation, false);
assert.equal(contract.activation_boundary.migrations, false);
assert.equal(contract.activation_boundary.grants, false);
assert.equal(contract.activation_boundary.db_provider_mutations, false);
assert.equal(contract.activation_boundary.deployment, false);

const stagingSchema = loadOpenApi(staging.schema_file);
const productionSchema = loadOpenApi(production.schema_file);
assert.equal(stagingSchema.servers?.[0]?.url, staging.server_url);
assert.equal(productionSchema.servers?.[0]?.url, production.server_url);
assert.equal(stagingSchema["x-mad4b-environment"], "staging");
assert.equal(stagingSchema["x-mad4b-surface"], "admin-custom-gpt-read-only");
assert.ok(operations(stagingSchema).length > 0);
assert.ok(operations(stagingSchema).every(({ method }) => method === "GET"));
assert.ok(operations(productionSchema).some(({ method }) => method !== "GET"));

for (const phrase of [
  "environment",
  "staging",
  "Production",
  "deny_and_do_not_fallback",
  "production credentials",
  "production activation",
  "migrations",
  "grants",
]) assert.ok(instructions.toLowerCase().includes(phrase.toLowerCase()), `missing instruction phrase: ${phrase}`);

console.log(JSON.stringify({
  ok: true,
  contract: contract.schema_version,
  environments: ["staging", "production"],
  staging_operation_count: operations(stagingSchema).length,
  staging_methods: ["GET"],
  production_non_get_detected: true,
  cross_environment_fallback: false,
  production_promotion_required_for_non_get: true,
  activation_boundary: contract.activation_boundary,
}, null, 2));
