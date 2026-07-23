import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const inventory = JSON.parse(readFileSync(resolve(repoRoot, "specs/012-tenant-activation-lifecycle/implementation/pr-1-inventory.json"), "utf8"));
const schema = YAML.parse(readFileSync(resolve(__dirname, "openapi/openapi.tenant-gpt.activation.yaml"), "utf8"));
const gatewaySource = readFileSync(resolve(__dirname, "routes/activationHostGatewayRoutes.js"), "utf8");
const methodNames = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

function key(row) {
  return `${row.method.toUpperCase()} ${row.path} ${row.operation_id}`;
}

function collectTenantOperations(doc) {
  const rows = [];
  for (const [path, pathItem] of Object.entries(doc.paths || {})) {
    if (!path.startsWith("/tenant/activation/") && !path.startsWith("/tenant/resolution/")) continue;
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!methodNames.has(method)) continue;
      rows.push({
        method: method.toUpperCase(),
        path,
        operation_id: operation.operationId,
        consequential: operation["x-openai-isConsequential"],
        security: operation.security || doc.security || [],
      });
    }
  }
  return rows;
}

const declared = collectTenantOperations(schema);
const inventoried = inventory.public_operations;

assert.equal(schema.openapi, "3.1.0");
assert.equal(schema.servers?.[0]?.url, "https://activation.mad4b.com");
assert.equal(inventory.contract_authority.registry_row_role, "inventory_only_not_runtime_authority");
assert.equal(inventory.scope.runtime_mutation, false);
assert.equal(inventory.scope.database_migration, false);
assert.equal(inventory.scope.provider_write, false);

const activationRoutesSource = readFileSync(resolve(__dirname, "routes/activationRoutes.js"), "utf8");
const systemLayerRoutesSource = readFileSync(resolve(__dirname, "routes/systemLayerRoutes.js"), "utf8");
assert.equal(inventory.bootstrap_authority.authoritative_source, "backend_runtime/db_runtime");
assert.equal(inventory.bootstrap_authority.sheets_required, false);
assert.equal(inventory.bootstrap_authority.provider_validation_tool, "activation_provider_bootstrap_validate");
assert(activationRoutesSource.includes('router.get("/activation/bootstrap-config"'));
assert(activationRoutesSource.includes("resolveActivationBootstrapConfig"));
assert(systemLayerRoutesSource.includes("activation_provider_bootstrap_validate"));
assert(systemLayerRoutesSource.includes("Google Sheets is deprecated and not called"));
assert(systemLayerRoutesSource.includes("activation_sheets_bootstrap_read"));
assert(systemLayerRoutesSource.includes("Google Sheets is no longer a valid bootstrap source and is not called"));

assert.deepEqual(declared.map(key).sort(), inventoried.map(key).sort(), "OpenAPI and inventory operations must match exactly");

const seen = new Set();
for (const entry of inventoried) {
  const operationKey = key(entry);
  assert(!seen.has(operationKey), `duplicate inventory operation: ${operationKey}`);
  seen.add(operationKey);
  const contract = declared.find((row) => key(row) === operationKey);
  assert(contract, `missing contract operation: ${operationKey}`);
  assert.equal(contract.consequential, entry.consequential, `consequential mismatch: ${operationKey}`);
  assert(contract.security.some((requirement) => Object.hasOwn(requirement, "userBearerAuth")), `userBearerAuth required: ${operationKey}`);
  assert.equal(entry.external_provider_write, false, `provider writes are outside PR-1: ${operationKey}`);
  assert.equal(entry.registry_row_classification, "inventory_only_not_runtime_authority");

  const routePath = resolve(repoRoot, entry.route_file);
  assert(existsSync(routePath), `missing route file: ${entry.route_file}`);
  const routeSource = readFileSync(routePath, "utf8");
  const routeToken = `router.${entry.method.toLowerCase()}(\"${entry.route_literal}\"`;
  assert(routeSource.includes(routeToken), `route literal missing for ${operationKey}: ${routeToken}`);

  if (entry.gateway_group === "tenant_activation_prefix") {
    assert(gatewaySource.includes('"/tenant/activation/"'));
  } else {
    assert(gatewaySource.includes("ALLOWED_TENANT_RESOLUTION_ROUTES"));
    if (entry.gateway_group === "resolution_problem_cards") assert(gatewaySource.includes("problem-cards"));
    if (entry.gateway_group === "resolution_case_actions") assert(gatewaySource.includes("(?:transitions|diagnostics)"));
    if (entry.gateway_group === "resolution_task_source_repair") assert(gatewaySource.includes("task-source-repair"));
  }
}

const publicIds = new Set(declared.map((row) => row.operation_id));
for (const observation of inventory.runtime_discovered_not_declared_in_tenant_activation_schema) {
  assert(!publicIds.has(observation.operation_id), `non-public operation became public without reclassification: ${observation.operation_id}`);
}

assert.equal(inventory.oauth_handoffs.length, 3);
const authRoutesSource = readFileSync(resolve(__dirname, "routes/authRoutes.js"), "utf8");
for (const handoff of inventory.oauth_handoffs) {
  assert(gatewaySource.includes(`${handoff.method} ${handoff.path}`), `gateway handoff missing: ${handoff.operation_id}`);
  assert(gatewaySource.includes(handoff.operation_id), `gateway operation ID missing: ${handoff.operation_id}`);
  const upstreamToken = `router.${handoff.method.toLowerCase()}(\"${handoff.upstream_route_literal}\"`;
  assert(authRoutesSource.includes(upstreamToken), `upstream OAuth route missing: ${upstreamToken}`);
}

for (const mappingKey of [
  "general_operation_identity",
  "activation_operation_projection",
  "activation_stage_attempt",
  "activation_evidence_item",
  "activation_delivery",
  "activation_acknowledgement",
  "activation_reconciliation_attempt",
  "deployment_observation",
  "activation_attention_item",
  "oauth_authorization_code",
  "tenant_resolution_case_lifecycle",
  "dynamic_resolution_operation_policy",
]) {
  const mapping = inventory.physical_mappings[mappingKey];
  assert(mapping, `missing physical mapping: ${mappingKey}`);
  assert(typeof mapping.disposition === "string" && mapping.disposition.length > 0, `missing disposition: ${mappingKey}`);
  assert(Array.isArray(mapping.tables) && mapping.tables.length > 0, `missing source tables: ${mappingKey}`);
}

for (const code of ["canonical_source_not_designated", "resolution_scope_policy_not_active", "general_operation_ledger_incomplete_for_activation"]) {
  assert(inventory.known_gaps.some((gap) => gap.code === code), `missing known gap: ${code}`);
}

console.log(`tenant activation contract inventory parity passed (${declared.length} public operations)`);
