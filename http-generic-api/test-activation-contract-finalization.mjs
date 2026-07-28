import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const featureRoot = path.join(
  repoRoot,
  "specs",
  "012-tenant-activation-lifecycle",
);

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(...parts), "utf8"));
}

function readYaml(...parts) {
  return YAML.parse(fs.readFileSync(path.join(...parts), "utf8"));
}

function sorted(values) {
  return [...values].sort();
}

function operationKey(operation) {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function normalizeOperation(operation) {
  return {
    method: operation.method.toUpperCase(),
    path: operation.path,
    operation_id: operation.operation_id,
  };
}

function normalizeOperations(operations) {
  return operations
    .map(normalizeOperation)
    .sort((left, right) => operationKey(left).localeCompare(operationKey(right)));
}

function extractOpenApiOperations(document) {
  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
  const operations = [];
  for (const [routePath, pathItem] of Object.entries(document.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!methods.has(method.toLowerCase()) || !operation?.operationId) continue;
      operations.push({
        method: method.toUpperCase(),
        path: routePath,
        operation_id: operation.operationId,
      });
    }
  }
  return normalizeOperations(operations);
}

function toOperationMap(operations) {
  return new Map(operations.map((operation) => [operationKey(operation), operation]));
}

function assertUniqueOperations(operations, label) {
  const routeKeys = operations.map(operationKey);
  const operationIds = operations.map((operation) => operation.operation_id);
  assert.equal(new Set(routeKeys).size, routeKeys.length, `${label} has duplicate method/path entries`);
  assert.equal(new Set(operationIds).size, operationIds.length, `${label} has duplicate operation IDs`);
}

const contract = readJson(
  featureRoot,
  "implementation",
  "pr-3-contract-finalization.json",
);
const inventory = readJson(
  featureRoot,
  "implementation",
  "pr-1-inventory.json",
);
const lifecycle = readJson(
  featureRoot,
  "implementation",
  "pr-2a-lifecycle-contracts.json",
);
const operationSchema = readJson(
  featureRoot,
  "contracts",
  "activation-operation.schema.json",
);
const targetOpenApi = readYaml(
  featureRoot,
  "contracts",
  "tenant-activation-lifecycle.openapi.yaml",
);
const servedOpenApi = readYaml(
  __dirname,
  "openapi",
  "openapi.tenant-gpt.activation.yaml",
);
const operationPathsMarkdown = fs.readFileSync(
  path.join(featureRoot, "operation-paths.md"),
  "utf8",
);
const narrative = fs.readFileSync(
  path.join(featureRoot, "implementation", "pr-3-contract-finalization.md"),
  "utf8",
);

assert.equal(contract.schema_version, "1.0.0");
assert.equal(contract.feature_key, "012-tenant-activation-lifecycle");
assert.equal(contract.implementation_slice, "pr-3-contract-finalization");
assert.deepEqual(sorted(contract.tasks), ["T010", "T011", "T012", "T013"]);
assert.equal(contract.contract_status, "final");
assert.equal(contract.runtime_authority, false);
assert.equal(contract.canonical_adoption_required, true);
assert.equal(contract.canonical_task, "T080");
assert.equal(contract.secrets_included, false);
assert.equal(contract.compatibility.target_paths_callable_before_canonical_adoption, false);
assert.match(narrative, /does not change canonical OpenAPI/i);
assert.match(narrative, /does not change.*runtime routes/i);
assert.match(narrative, /No invented public paths/i);

assert.equal(targetOpenApi.openapi, "3.1.0");
assert.equal(targetOpenApi.info.version, "1.0.0-contract");
assert.equal(targetOpenApi.info["x-specification-only"], true);
assert.equal(targetOpenApi.info["x-contract-status"], "final");
assert.equal(targetOpenApi.info["x-runtime-authority"], false);
assert.equal(
  targetOpenApi.info["x-contract-finalization-ref"],
  "../implementation/pr-3-contract-finalization.json",
);
assert.equal(operationSchema["x-contract-status"], "final");
assert.equal(operationSchema["x-runtime-authority"], false);
assert.equal(
  operationSchema["x-contract-finalization-ref"],
  "../implementation/pr-3-contract-finalization.json",
);

const runtimeCurrent = contract.layers.runtime_current;
const targetLifecycle = contract.layers.target_lifecycle;
assert.equal(runtimeCurrent.authority, "pr-1-inventory-and-served-openapi");
assert.equal(targetLifecycle.authority, "specification-only-openapi-and-json-schema");
assert.equal(runtimeCurrent.protected_resource, inventory.contract_authority.protected_resource);
assert.equal(runtimeCurrent.security_scheme, inventory.contract_authority.security_scheme);
assert.equal(runtimeCurrent.served_artifact, inventory.contract_authority.served_artifact);
assert.equal(runtimeCurrent.canonical_source, inventory.contract_authority.canonical_source);

const contractOauth = normalizeOperations(runtimeCurrent.oauth_handoffs);
const inventoryOauth = normalizeOperations(inventory.oauth_handoffs);
assert.deepEqual(contractOauth, inventoryOauth, "OAuth handoffs must match PR-1 inventory");
assert.equal(contractOauth.length, 3);

const contractCurrentOperations = normalizeOperations(runtimeCurrent.public_operations);
const inventoryCurrentOperations = normalizeOperations(inventory.public_operations);
assert.deepEqual(
  contractCurrentOperations,
  inventoryCurrentOperations,
  "runtime-current public operations must match PR-1 inventory",
);
assert.equal(contractCurrentOperations.length, 15);
for (const operation of runtimeCurrent.public_operations) {
  const inventoryOperation = inventory.public_operations.find(
    (candidate) => operationKey(candidate) === operationKey(operation),
  );
  assert(inventoryOperation, `missing inventory operation: ${operationKey(operation)}`);
  assert.equal(operation.operation_id, inventoryOperation.operation_id);
  assert.equal(operation.consequential, inventoryOperation.consequential);
}

assert.deepEqual(
  normalizeOperations(runtimeCurrent.runtime_discovered_not_declared_in_served_schema),
  normalizeOperations(inventory.runtime_discovered_not_declared_in_tenant_activation_schema),
);
assert.deepEqual(sorted(runtimeCurrent.scopes), sorted(inventory.current_scope_catalog));

const servedOperations = extractOpenApiOperations(servedOpenApi);
const servedOperationMap = toOperationMap(servedOperations);
for (const operation of contractCurrentOperations) {
  const served = servedOperationMap.get(operationKey(operation));
  assert(served, `served OpenAPI is missing ${operationKey(operation)}`);
  assert.equal(
    served.operation_id,
    operation.operation_id,
    `served operationId mismatch for ${operationKey(operation)}`,
  );
}
for (const operation of runtimeCurrent.runtime_discovered_not_declared_in_served_schema) {
  assert.equal(
    servedOperationMap.has(operationKey(operation)),
    false,
    `inventory-only discovered route unexpectedly became declared without contract refresh: ${operationKey(operation)}`,
  );
}

const targetContractOperations = normalizeOperations(targetLifecycle.operations);
const targetOpenApiOperations = extractOpenApiOperations(targetOpenApi);
assert.deepEqual(
  targetContractOperations,
  targetOpenApiOperations,
  "target lifecycle operations must exactly match final target OpenAPI",
);
assert.equal(targetContractOperations.length, 6);
assertUniqueOperations(contractOauth, "runtime OAuth handoffs");
assertUniqueOperations(contractCurrentOperations, "runtime-current public operations");
assertUniqueOperations(targetContractOperations, "target lifecycle operations");

const currentRouteMap = toOperationMap([...contractOauth, ...contractCurrentOperations]);
const targetRouteMap = toOperationMap(targetContractOperations);
const overlappingRouteKeys = [...targetRouteMap.keys()].filter((key) => currentRouteMap.has(key));
const aliasRouteKeys = targetLifecycle.operation_aliases.map((alias) =>
  operationKey({ method: alias.method, path: alias.path }),
);
assert.deepEqual(sorted(overlappingRouteKeys), sorted(aliasRouteKeys));
for (const alias of targetLifecycle.operation_aliases) {
  const key = operationKey(alias);
  assert.equal(currentRouteMap.get(key)?.operation_id, alias.runtime_operation_id);
  assert.equal(targetRouteMap.get(key)?.operation_id, alias.target_operation_id);
  assert.notEqual(alias.runtime_operation_id, alias.target_operation_id);
  assert.match(alias.reason, /must coordinate/i);
}

assert.equal(targetOpenApi.servers?.[0]?.url, runtimeCurrent.protected_resource);
const targetScopes = Object.keys(
  targetOpenApi.components.securitySchemes.userBearerAuth.flows.authorizationCode.scopes,
);
assert.deepEqual(sorted(targetLifecycle.scopes), sorted(targetScopes));
assert.equal(
  targetLifecycle.resolution_scope_runtime_status,
  "not_active_pending_dynamic_policy_implementation",
);

const expectedOperationPaths = Array.from(
  { length: 18 },
  (_, index) => `OP-${String(index + 1).padStart(3, "0")}`,
);
const documentedOperationPaths = sorted(
  new Set(operationPathsMarkdown.match(/\bOP-\d{3}\b/g) || []),
);
assert.deepEqual(documentedOperationPaths, expectedOperationPaths);
const coveredOperationPaths = contract.operation_path_coverage.map(
  (entry) => entry.operation_path,
);
assert.deepEqual(sorted(coveredOperationPaths), expectedOperationPaths);
assert.equal(new Set(coveredOperationPaths).size, expectedOperationPaths.length);

const nonRouteByKey = new Map(
  contract.non_route_contracts.map((entry) => [entry.key, entry]),
);
for (const entry of contract.non_route_contracts) {
  assert(entry.authority, `non-route contract lacks authority: ${entry.key}`);
  for (const operationPath of entry.operation_paths) {
    assert(expectedOperationPaths.includes(operationPath));
  }
  for (const task of entry.tasks) {
    assert(contract.tasks.includes(task));
  }
}

const allDeclaredRoutes = new Set([
  ...currentRouteMap.keys(),
  ...targetRouteMap.keys(),
]);
for (const coverage of contract.operation_path_coverage) {
  assert(contract.tasks.includes(coverage.task));
  assert(Array.isArray(coverage.refs) && coverage.refs.length > 0);
  for (const ref of coverage.refs) {
    if (/^(GET|POST|PUT|PATCH|DELETE)\s+\//.test(ref)) {
      assert(allDeclaredRoutes.has(ref), `coverage references undeclared route: ${ref}`);
      continue;
    }
    if (ref === "DeploymentSummary") {
      assert(targetOpenApi.components.schemas.DeploymentSummary);
      continue;
    }
    assert(nonRouteByKey.has(ref), `coverage references unknown non-route contract: ${ref}`);
  }
}
for (const entry of contract.non_route_contracts) {
  for (const operationPath of entry.operation_paths) {
    const coverage = contract.operation_path_coverage.find(
      (candidate) => candidate.operation_path === operationPath,
    );
    assert(coverage, `non-route contract is not covered: ${entry.key}/${operationPath}`);
    assert(coverage.refs.includes(entry.key));
  }
}

const lifecycleErrorCodes = lifecycle.errors.map((entry) => entry.code);
assert.deepEqual(sorted(contract.stable_error_codes), sorted(lifecycleErrorCodes));
assert.equal(
  contract.lifecycle_authority.active_requires_same_operation_evidence,
  lifecycle.operation.rules.active_requires_same_operation_evidence,
);
assert.equal(
  contract.lifecycle_authority.unknown_outcome_requires_reconcile_before_replay,
  lifecycle.operation.rules.unknown_outcome_requires_reconcile_before_replay,
);
assert.equal(contract.lifecycle_authority.delivery_rewrites_execution_outcome, false);
assert.equal(contract.lifecycle_authority.acknowledgement_rewrites_execution_outcome, false);
assert.equal(contract.lifecycle_authority.deployment_mismatch_reconnect_required, false);
assert.equal(lifecycle.reconnect_policy.deployment_mismatch_reconnect_required, false);

const targetActivationStatuses = targetOpenApi.components.schemas.ActivationStatus.enum;
assert.deepEqual(
  sorted(targetActivationStatuses),
  sorted(lifecycle.operation.declared_statuses),
);
assert.deepEqual(
  sorted(operationSchema.properties.status.enum),
  sorted(lifecycle.operation.declared_statuses),
);

const deploymentSchema = targetOpenApi.components.schemas.DeploymentSummary;
const deploymentProperties = Object.keys(deploymentSchema.properties);
assert.deepEqual(
  sorted(contract.deployment_exposure.tenant_statuses),
  sorted(deploymentSchema.properties.status.enum),
);
assert.deepEqual(
  sorted(contract.deployment_exposure.tenant_exposure_levels),
  sorted(deploymentSchema.properties.exposure_level.enum),
);
assert.deepEqual(
  sorted(contract.deployment_exposure.tenant_allowed_fields),
  sorted(deploymentProperties),
);
assert.equal(deploymentSchema.properties.reconnect_required.enum[0], false);
assert.equal(contract.deployment_exposure.reconnect_required, false);
assert.equal(contract.deployment_exposure.admin_full_evidence_separate, true);
const serializedDeploymentSchema = JSON.stringify(deploymentSchema).toLowerCase();
for (const forbiddenField of contract.deployment_exposure.tenant_forbidden_fields) {
  assert.equal(
    Object.hasOwn(deploymentSchema.properties, forbiddenField),
    false,
    `forbidden deployment field is public: ${forbiddenField}`,
  );
  assert.equal(
    serializedDeploymentSchema.includes(`\"${forbiddenField.toLowerCase()}\"`),
    false,
    `forbidden deployment field is serialized as a public property: ${forbiddenField}`,
  );
}

assert.equal(contract.compatibility.additive_response_fields_optional, true);
assert.equal(contract.compatibility.existing_required_fields_removal_allowed, false);
assert.equal(contract.compatibility.existing_required_fields_rename_allowed, false);
assert.equal(contract.compatibility.existing_operation_id_silent_rename_allowed, false);

console.log("activation contract finalization parity tests passed");
