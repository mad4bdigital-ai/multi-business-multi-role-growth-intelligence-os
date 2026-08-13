import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const REGISTRY_PATH = "../canonicals/openapi/custom-gpt-surfaces.yaml";
const registry = YAML.parse(readFileSync(REGISTRY_PATH, "utf8"));
const GENERATED_SURFACES = Object.entries(registry.surfaces)
  .filter(([, surface]) => surface.mode === "generated_from_openapi")
  .map(([surfaceKey, surface]) => ({ surfaceKey, ...surface }));

function collectOperations(doc) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, method, operation });
    }
  }
  return operations;
}

function schemaPath(file) {
  const relocated = `openapi/${file}`;
  if (existsSync(relocated)) return relocated;
  return file;
}

function loadYaml(file) {
  return YAML.parse(readFileSync(schemaPath(file), "utf8"));
}

function resolveJsonPointer(doc, pointer) {
  if (typeof pointer !== "string" || !pointer.startsWith("#/")) return undefined;
  return pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((current, part) => current && current[part], doc);
}

function collectRefs(value, refs = new Set()) {
  if (!value || typeof value !== "object") return refs;
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs);
    return refs;
  }
  if (typeof value.$ref === "string") refs.add(value.$ref);
  for (const child of Object.values(value)) collectRefs(child, refs);
  return refs;
}

const mainText = readFileSync("openapi.yaml", "utf8");
const splitScript = readFileSync("scripts/split-openapi.mjs", "utf8");
const orchestrator = readFileSync("scripts/generate-custom-gpt-schemas.mjs", "utf8");

assert.equal(registry.version, 2);
assert.deepEqual(registry.shared_surface_allowlist, ["listSystemTools", "callSystemTool"]);
assert.equal(registry.oauth_client_contract.authorization_server, "https://auth.mad4b.com");
assert.equal(registry.oauth_client_contract.activation_gateway_alias, true);
assert.equal(registry.oauth_client_contract.consent_model, "one_client_resource_bound");
assert.equal(GENERATED_SURFACES.length, 4, "registry must define four generated Core/Activation surfaces");
for (const surface of GENERATED_SURFACES) {
  assert.deepEqual(surface.selector?.source_markers, [surface.surfaceKey], `${surface.surfaceKey} must use its source marker as the selector`);
  assert.equal(surface.candidate_policy?.mode, "marker_required");
  assert.equal(surface.candidate_policy?.required_marker, surface.surfaceKey);
  assert.equal(surface.candidate_policy?.omission, "fail");
}
assert.equal(registry.surfaces.admin_core.server_url, "https://auth.mad4b.com");
assert.equal(registry.surfaces.tenant_core.server_url, "https://auth.mad4b.com");
assert.equal(registry.surfaces.activation_admin.server_url, "https://activation.mad4b.com");
assert.equal(registry.surfaces.tenant_activation.server_url, "https://activation.mad4b.com");
assert.equal(registry.surfaces.tenant_activation.oauth_endpoints.authorization_url, "https://activation.mad4b.com/auth/oauth/authorize");
assert.equal(registry.surfaces.tenant_activation.oauth_endpoints.token_url, "https://activation.mad4b.com/auth/oauth/token");
assert.equal(registry.surfaces.tenant_activation.oauth_authority.authorization_server, "https://auth.mad4b.com");
assert.equal(registry.surfaces.tenant_activation.oauth_authority.gateway_alias, true);
assert.equal(registry.surfaces.tenant_activation.oauth_authority.same_client_id, true);
assert.equal(registry.surfaces.local_connector_admin.mode, "canonical_copy");
assert.equal(registry.surfaces.local_connector_admin.server_url, "https://connector.mad4b.com");
assert.equal(registry.gateway_policies.activation_gateway.upstream_origin, "https://auth.mad4b.com");

assert(mainText.includes("x-tenant-gpt-auth"), "main OpenAPI must retain the canonical tenant OAuth profile");
for (const requiredPath of [
  "/tenant/activation/session-context",
  "/tenant/platform/plugins/catalog",
  "/tenant/platform/plugins/install",
  "/tenant/platform/plugins/resolve",
]) {
  assert(mainText.includes(`${requiredPath}:`), `path must be declared in main OpenAPI: ${requiredPath}`);
}
for (const requiredAlias of ["activateSession", "listTools", "callTool", "writeSessionTurn", "endSession"]) {
  assert(mainText.includes(`x-tenant-gpt-operationId: ${requiredAlias}`), `tenant alias must be declared in main OpenAPI: ${requiredAlias}`);
}

const knownSurfaceKeys = new Set(GENERATED_SURFACES.map((surface) => surface.surfaceKey));
const sourceMarkedOperations = collectOperations(YAML.parse(mainText)).filter((entry) => Array.isArray(entry.operation?.["x-custom-gpt-surfaces"]));
assert(sourceMarkedOperations.length > 0, "source OpenAPI must contain dynamic Custom GPT surface markers");
for (const entry of sourceMarkedOperations) {
  for (const marker of entry.operation["x-custom-gpt-surfaces"]) {
    assert(knownSurfaceKeys.has(marker), `source marker must reference a generated surface: ${marker}`);
  }
}

for (const surface of GENERATED_SURFACES) {
  const doc = loadYaml(surface.output_file);
  const operations = collectOperations(doc);
  assert.equal(doc["x-custom-gpt-generation"]?.registry_version, 2, `${surface.surfaceKey} must carry registry provenance`);
  assert.match(doc["x-custom-gpt-generation"]?.source_openapi_sha256 || "", /^[a-f0-9]{64}$/u);
  assert.match(doc["x-custom-gpt-generation"]?.registry_sha256 || "", /^[a-f0-9]{64}$/u);
  assert.equal(doc["x-custom-gpt-generation"]?.operation_count, operations.length);
  assert.equal(typeof doc["x-custom-gpt-generation"]?.warning_budget_exceeded, "boolean");
  assert(operations.length > 0, `${surface.output_file} must contain operations`);
  assert.equal(doc.servers?.[0]?.url, surface.server_url, `${surface.surfaceKey} server must match registry`);
  assert(operations.length <= surface.hard_operation_limit, `${surface.surfaceKey} must remain below its hard operation limit`);

  for (const entry of operations) {
    const pair = `${entry.method.toUpperCase()} ${entry.pathKey}`;
    assert(mainText.includes(`${entry.pathKey}:`), `${surface.output_file} contains a split-only path: ${pair}`);
    const operationId = entry.operation?.operationId;
    assert(operationId, `${surface.output_file} operation must define operationId: ${pair}`);
    assert(
      mainText.includes(`operationId: ${operationId}`) || mainText.includes(`x-tenant-gpt-operationId: ${operationId}`),
      `${surface.output_file} contains a split-only operationId: ${operationId}`,
    );
  }

  for (const ref of collectRefs(doc)) {
    assert(ref.startsWith("#/"), `${surface.output_file} contains a non-local ref: ${ref}`);
    assert(resolveJsonPointer(doc, ref) !== undefined, `${surface.output_file} contains an unresolved local ref: ${ref}`);
  }
}

const adminCore = loadYaml(registry.surfaces.admin_core.output_file);
const tenantCore = loadYaml(registry.surfaces.tenant_core.output_file);
const adminActivation = loadYaml(registry.surfaces.activation_admin.output_file);
const tenantActivation = loadYaml(registry.surfaces.tenant_activation.output_file);
assert.equal(Object.keys(adminCore.paths).some((path) => path.startsWith("/activation") || path.startsWith("/tenant/activation")), false);
assert.equal(Object.keys(tenantCore.paths).some((path) => path.startsWith("/activation") || path.startsWith("/tenant/activation")), false);
assert.equal(Object.keys(adminActivation.paths).every((path) => path.startsWith("/activation")), true);
assert.equal(
  Object.keys(tenantActivation.paths).every((path) => path.startsWith("/tenant/activation") || path.startsWith("/tenant/resolution")),
  true,
);
assert.equal(tenantCore.components.securitySchemes.userBearerAuth.flows.authorizationCode.authorizationUrl, "https://auth.mad4b.com/auth/oauth/authorize");
assert.equal(tenantCore.components.securitySchemes.userBearerAuth.flows.authorizationCode.tokenUrl, "https://auth.mad4b.com/auth/oauth/token");
assert.equal(tenantActivation.components.securitySchemes.userBearerAuth.flows.authorizationCode.authorizationUrl, "https://activation.mad4b.com/auth/oauth/authorize");
assert.equal(tenantActivation.components.securitySchemes.userBearerAuth.flows.authorizationCode.tokenUrl, "https://activation.mad4b.com/auth/oauth/token");

assert(splitScript.includes("SURFACE_REGISTRY_FILE"), "split generator must read the canonical surface registry");
assert(splitScript.includes("source_markers"), "split generator must support source marker selectors");
assert(splitScript.includes("validateSourceMarkerCoverage"), "split generator must validate source marker coverage");
assert(splitScript.includes("validateCandidatePolicy"), "split generator must fail closed on candidate omission");
assert(splitScript.includes("validateMarkerOverlapAllowlist"), "split generator must enforce shared marker allowlist");
assert(splitScript.includes("source_openapi_sha256"), "split generator must stamp source provenance");
assert(splitScript.includes("validateGeneratedDoc"), "split generator must validate generated operations against the source OpenAPI");
assert(splitScript.includes("validateUniqueTenantAliases"), "split generator must reject duplicate tenant aliases");
assert(splitScript.includes("selector.operation_ids") && splitScript.includes("selector.tenant_operation_ids") && splitScript.includes("selector.include_tags"));
assert(orchestrator.includes("generateGatewayPolicies"), "orchestrator must generate gateway policy from Activation surfaces");
assert(orchestrator.includes("materializeCanonicalCopies"), "orchestrator must materialize canonical-copy surfaces");
assert(!splitScript.includes("YAML.parse(fs.readFileSync(tenantPath"), "generated tenant artifacts must never become source-of-truth");
assert(!splitScript.includes("remoteMcp"), "Custom GPT splitter must remain independent from Remote MCP runtime");

const promotionReadModels = loadYaml("session-insight-promotion-read-models.yaml");

function migrationEnumValues(file, column) {
  const sql = readFileSync(`migrations/${file}`, "utf8");
  const match = sql.match(new RegExp(`\`${column}\`\\s+ENUM\\(([^)]+)\\)`, "i"));
  assert(match, `migration enum must exist: ${file}#${column}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

for (const contract of [
  ["279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql", "actual_request_status", "CapabilityEnvelopeActualRequest", "actual_request_status"],
  ["279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql", "actual_request_policy_status", "CapabilityEnvelopeActualRequest", "actual_request_policy_status"],
  ["279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql", "actual_request_status", "CapabilityEnvelopeActualRequestSummary", "actual_request_status"],
  ["279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql", "actual_request_policy_status", "CapabilityEnvelopeActualRequestSummary", "actual_request_policy_status"],
  ["280_sprint68_session_insight_capability_envelope_approval_gate.sql", "approval_decision_status", "CapabilityEnvelopeApprovalDecision", "approval_decision_status"],
  ["280_sprint68_session_insight_capability_envelope_approval_gate.sql", "approval_policy_status", "CapabilityEnvelopeApprovalDecision", "approval_policy_status"],
  ["280_sprint68_session_insight_capability_envelope_approval_gate.sql", "approval_decision_status", "CapabilityEnvelopeApprovalSummary", "approval_decision_status"],
  ["280_sprint68_session_insight_capability_envelope_approval_gate.sql", "approval_policy_status", "CapabilityEnvelopeApprovalSummary", "approval_policy_status"],
  ["281_sprint68_session_insight_capability_envelope_dispatch_readback.sql", "dispatch_readback_status", "CapabilityEnvelopeDispatchReadback", "dispatch_readback_status"],
  ["281_sprint68_session_insight_capability_envelope_dispatch_readback.sql", "dispatch_readback_policy_status", "CapabilityEnvelopeDispatchReadback", "dispatch_readback_policy_status"],
  ["281_sprint68_session_insight_capability_envelope_dispatch_readback.sql", "dispatch_readback_status", "CapabilityEnvelopeDispatchReadbackSummary", "dispatch_readback_status"],
  ["281_sprint68_session_insight_capability_envelope_dispatch_readback.sql", "dispatch_readback_policy_status", "CapabilityEnvelopeDispatchReadbackSummary", "dispatch_readback_policy_status"],
  ["282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql", "adapter_execution_gate_status", "CapabilityEnvelopeAdapterExecutionGate", "adapter_execution_gate_status"],
  ["282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql", "adapter_execution_policy_status", "CapabilityEnvelopeAdapterExecutionGate", "adapter_execution_policy_status"],
  ["282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql", "adapter_execution_gate_status", "CapabilityEnvelopeAdapterExecutionGateSummary", "adapter_execution_gate_status"],
  ["282_sprint68_session_insight_capability_envelope_adapter_execution_gate.sql", "adapter_execution_policy_status", "CapabilityEnvelopeAdapterExecutionGateSummary", "adapter_execution_policy_status"],
  ["284_sprint68_session_insight_backlog_target_write_executor.sql", "target_write_status", "BacklogTargetWrite", "target_write_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "completion_status", "RemainingScopeCompletion", "completion_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "completion_policy_status", "RemainingScopeCompletion", "completion_policy_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "adapter_apply_dispatch_gate_status", "RemainingScopeCompletion", "adapter_apply_dispatch_gate_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "adapter_apply_readback_status", "RemainingScopeCompletion", "adapter_apply_readback_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "target_write_gate_status", "RemainingScopeCompletion", "target_write_gate_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "target_write_readback_status", "RemainingScopeCompletion", "target_write_readback_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "rollback_plan_status", "RemainingScopeCompletion", "rollback_plan_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "generalized_registry_status", "RemainingScopeCompletion", "generalized_registry_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "ui_review_queue_status", "RemainingScopeCompletion", "ui_review_queue_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "orchestration_test_status", "RemainingScopeCompletion", "orchestration_test_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "completion_status", "RemainingScopeCompletionSummary", "completion_status"],
  ["283_sprint68_session_insight_capability_envelope_remaining_scope_completion.sql", "completion_policy_status", "RemainingScopeCompletionSummary", "completion_policy_status"],
]) {
  const [migrationFile, migrationColumn, schemaName, propertyName] = contract;
  assert.deepEqual(
    promotionReadModels.components.schemas[schemaName].properties[propertyName].enum,
    migrationEnumValues(migrationFile, migrationColumn),
    `${schemaName}.${propertyName} must accept every persisted migration enum value`,
  );
}

console.log("OpenAPI surface registry governance tests passed.");
