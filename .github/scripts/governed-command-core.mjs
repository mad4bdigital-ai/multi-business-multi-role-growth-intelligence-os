import fs from "node:fs";
import path from "node:path";

export const GATEWAY_WORKFLOW = "governed-command-gateway.yml";
export const REGISTRY_CONTRACT = "mad4b.governed-command-registry.v1";
export const REGISTRY_PATH = ".github/contracts/governed-command-registry.v1.json";
export const PARAMETER_SCHEMA_PREFIX = ".github/contracts/governed-command-parameters/";

export const ALLOWED_AUTHORITIES = new Set([
  "spec-kit-governance",
  "governed-production",
]);

export const ALLOWED_RISK_CLASSES = new Set([
  "low",
  "moderate",
  "elevated",
  "critical",
]);

export const ALLOWED_AUDIT_POLICIES = new Set(["workflow-run-evidence"]);
export const ALLOWED_PERMISSION_PROFILES = new Set(["dispatch-only"]);
export const ALLOWED_TARGET_WORKFLOWS = new Set([
  "spec-kit-work-map-autofix-recovery-dispatch.yml",
  "governed-production-promotion-request-launcher.yml",
]);

const RISK_WEIGHT = new Map([
  ["low", 1],
  ["moderate", 2],
  ["elevated", 3],
  ["critical", 4],
]);

const REGISTRY_KEYS = new Set(["contract", "version", "commands"]);
const COMMAND_KEYS = new Set([
  "id",
  "adapter",
  "authority",
  "risk_class",
  "requires_sha_pin",
  "parameter_schema",
  "audit_policy",
  "permission_profile",
  "enabled",
]);

export const ADAPTERS = Object.freeze({
  "spec-kit-work-map-recovery": Object.freeze({
    targetWorkflow: "spec-kit-work-map-autofix-recovery-dispatch.yml",
    targetRef: "main",
    confirmation: "RECOVER_SPEC_KIT_WORK_MAP_AUTOFIX",
    authority: "spec-kit-governance",
    minimumRiskClass: "elevated",
    parameterKeys: Object.freeze(["pr_number", "expected_head_sha"]),
    targetPrNumberKey: "pr_number",
    targetPrHeadShaKey: "expected_head_sha",
    gatewayShaParameterKey: null,
  }),
  "production-promotion-request": Object.freeze({
    targetWorkflow: "governed-production-promotion-request-launcher.yml",
    targetRef: "main",
    confirmation: "AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST",
    authority: "governed-production",
    minimumRiskClass: "critical",
    parameterKeys: Object.freeze([
      "request_pr",
      "expected_head_sha",
      "expected_request_head_sha",
      "release_branch_prefix",
      "validation_branch_prefix",
      "validation_base_branch_prefix",
      "review_mode",
    ]),
    targetPrNumberKey: "request_pr",
    targetPrHeadShaKey: "expected_request_head_sha",
    gatewayShaParameterKey: "expected_head_sha",
  }),
});

function fail(message) {
  throw new Error(message);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      fail(`${label} contains unsupported field: ${key}`);
    }
  }
}

function assertExactSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    fail(`${label} must be an exact lowercase 40-character SHA`);
  }
}

function resolveContractPath(rootDir, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.startsWith(PARAMETER_SCHEMA_PREFIX)) {
    fail(`parameter_schema must be under ${PARAMETER_SCHEMA_PREFIX}`);
  }
  if (path.posix.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").includes("..")) {
    fail(`parameter_schema must be a bounded repository-relative path: ${relativePath}`);
  }

  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || !normalized.endsWith(".json")) {
    fail(`parameter_schema must be a normalized JSON path: ${relativePath}`);
  }

  const resolved = path.resolve(rootDir, ...normalized.split("/"));
  const allowedRoot = path.resolve(rootDir, ...PARAMETER_SCHEMA_PREFIX.replace(/\/$/, "").split("/"));
  if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
    fail(`parameter_schema escapes the allowed contract directory: ${relativePath}`);
  }
  return resolved;
}

export function loadRegistry(registryPath = REGISTRY_PATH, rootDir = process.cwd()) {
  const fullPath = path.resolve(rootDir, ...registryPath.split("/"));
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

export function loadParameterSchema(relativePath, rootDir = process.cwd()) {
  const fullPath = resolveContractPath(rootDir, relativePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    fail(`parameter_schema does not exist: ${relativePath}`);
  }
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function validateParameterSchemaContract(schema, schemaPath) {
  assertPlainObject(schema, `schema ${schemaPath}`);
  if (schema.type !== "object") fail(`schema ${schemaPath} must have type=object`);
  if (schema.additionalProperties !== false) fail(`schema ${schemaPath} must set additionalProperties=false`);
  assertPlainObject(schema.properties, `schema ${schemaPath}.properties`);
  if (!Array.isArray(schema.required)) fail(`schema ${schemaPath}.required must be an array`);

  const propertyNames = Object.keys(schema.properties);
  const required = new Set(schema.required);
  if (required.size !== schema.required.length) fail(`schema ${schemaPath} has duplicate required fields`);
  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(schema.properties, name)) {
      fail(`schema ${schemaPath} requires unknown property: ${name}`);
    }
  }

  for (const name of propertyNames) {
    const rule = schema.properties[name];
    assertPlainObject(rule, `schema ${schemaPath}.properties.${name}`);
    if (!new Set(["string", "integer", "boolean"]).has(rule.type)) {
      fail(`schema ${schemaPath} property ${name} has unsupported type: ${rule.type}`);
    }
    if (rule.pattern !== undefined) {
      if (rule.type !== "string" || typeof rule.pattern !== "string") {
        fail(`schema ${schemaPath} property ${name} has invalid pattern rule`);
      }
      new RegExp(rule.pattern);
    }
    if (rule.const !== undefined && typeof rule.const !== rule.type) {
      fail(`schema ${schemaPath} property ${name} has const/type mismatch`);
    }
  }

  return propertyNames.sort();
}

export function validateRegistry(registry, { rootDir = process.cwd(), adapters = ADAPTERS } = {}) {
  assertPlainObject(registry, "registry");
  assertExactKeys(registry, REGISTRY_KEYS, "registry");
  if (registry.contract !== REGISTRY_CONTRACT) fail(`registry contract must equal ${REGISTRY_CONTRACT}`);
  if (registry.version !== 1) fail("registry version must equal 1");
  if (!Array.isArray(registry.commands) || registry.commands.length === 0) fail("registry.commands must be a non-empty array");

  const seen = new Set();
  for (const command of registry.commands) {
    assertPlainObject(command, "command entry");
    assertExactKeys(command, COMMAND_KEYS, `command ${command.id ?? "<unknown>"}`);

    if (typeof command.id !== "string" || !/^[a-z][a-z0-9_]{2,79}$/.test(command.id)) {
      fail(`invalid command id: ${command.id}`);
    }
    if (seen.has(command.id)) fail(`duplicate command id: ${command.id}`);
    seen.add(command.id);

    if (typeof command.adapter !== "string" || !Object.prototype.hasOwnProperty.call(adapters, command.adapter)) {
      fail(`unknown adapter for ${command.id}: ${command.adapter}`);
    }
    const adapter = adapters[command.adapter];
    assertPlainObject(adapter, `adapter ${command.adapter}`);

    if (!ALLOWED_AUTHORITIES.has(command.authority)) fail(`unknown authority for ${command.id}: ${command.authority}`);
    if (adapter.authority !== command.authority) fail(`adapter authority mismatch for ${command.id}`);
    if (!ALLOWED_RISK_CLASSES.has(command.risk_class)) fail(`invalid risk class for ${command.id}: ${command.risk_class}`);
    if ((RISK_WEIGHT.get(command.risk_class) ?? 0) < (RISK_WEIGHT.get(adapter.minimumRiskClass) ?? 99)) {
      fail(`risk class for ${command.id} is below adapter minimum`);
    }
    if (typeof command.requires_sha_pin !== "boolean") fail(`requires_sha_pin must be boolean for ${command.id}`);
    if (["elevated", "critical"].includes(command.risk_class) && command.requires_sha_pin !== true) {
      fail(`sensitive command ${command.id} must require a SHA pin`);
    }
    if (!ALLOWED_AUDIT_POLICIES.has(command.audit_policy)) fail(`invalid audit policy for ${command.id}: ${command.audit_policy}`);
    if (!ALLOWED_PERMISSION_PROFILES.has(command.permission_profile)) {
      fail(`unbounded or unknown permission profile for ${command.id}: ${command.permission_profile}`);
    }
    if (typeof command.enabled !== "boolean") fail(`enabled must be boolean for ${command.id}`);

    if (adapter.targetRef !== "main") fail(`adapter ${command.adapter} must dispatch only from trusted main`);
    if (adapter.targetWorkflow === GATEWAY_WORKFLOW) fail(`recursive gateway dispatch is forbidden for ${command.id}`);
    if (!ALLOWED_TARGET_WORKFLOWS.has(adapter.targetWorkflow)) {
      fail(`unregistered execution target for ${command.id}: ${adapter.targetWorkflow}`);
    }
    if (typeof adapter.confirmation !== "string" || adapter.confirmation.length < 8) {
      fail(`adapter ${command.adapter} is missing a fixed authorization confirmation`);
    }
    if (!Array.isArray(adapter.parameterKeys) || adapter.parameterKeys.length === 0) {
      fail(`adapter ${command.adapter} must declare bounded parameter keys`);
    }
    if (!adapter.parameterKeys.includes(adapter.targetPrNumberKey) || !adapter.parameterKeys.includes(adapter.targetPrHeadShaKey)) {
      fail(`adapter ${command.adapter} must bind its protected-branch guard to declared parameters`);
    }
    if (adapter.gatewayShaParameterKey !== null && !adapter.parameterKeys.includes(adapter.gatewayShaParameterKey)) {
      fail(`adapter ${command.adapter} gateway SHA binding must reference a declared parameter`);
    }

    const schema = loadParameterSchema(command.parameter_schema, rootDir);
    const schemaProperties = validateParameterSchemaContract(schema, command.parameter_schema);
    const adapterProperties = [...adapter.parameterKeys].sort();
    if (schemaProperties.length !== adapterProperties.length || schemaProperties.some((value, index) => value !== adapterProperties[index])) {
      fail(`schema/adapter parameter mismatch for ${command.id}`);
    }
  }

  return { commandCount: registry.commands.length };
}

export function validateParameters(schema, parameters, label = "parameters") {
  assertPlainObject(schema, "parameter schema");
  assertPlainObject(parameters, label);

  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(parameters, key)) fail(`${label} is missing required field: ${key}`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(parameters)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(`${label} contains unsupported field: ${key}`);
    }
  }

  for (const [key, value] of Object.entries(parameters)) {
    const rule = properties[key];
    if (!rule) continue;
    if (rule.type === "integer") {
      if (!Number.isInteger(value)) fail(`${label}.${key} must be an integer`);
    } else if (typeof value !== rule.type) {
      fail(`${label}.${key} must be a ${rule.type}`);
    }
    if (rule.type === "string") {
      if (rule.minLength !== undefined && value.length < rule.minLength) fail(`${label}.${key} is shorter than minLength`);
      if (rule.maxLength !== undefined && value.length > rule.maxLength) fail(`${label}.${key} exceeds maxLength`);
      if (rule.pattern !== undefined && !new RegExp(rule.pattern).test(value)) fail(`${label}.${key} does not match its required pattern`);
    }
    if (rule.const !== undefined && value !== rule.const) fail(`${label}.${key} must equal its contract constant`);
  }
  return true;
}

export function resolveCommandPlan({
  registry,
  command: commandId,
  parameters,
  authorization,
  expectedHeadSha,
  currentHeadSha,
  currentRef,
  rootDir = process.cwd(),
  adapters = ADAPTERS,
}) {
  validateRegistry(registry, { rootDir, adapters });
  assertExactSha(expectedHeadSha, "expected_head_sha");
  assertExactSha(currentHeadSha, "current_head_sha");
  if (expectedHeadSha !== currentHeadSha) fail("expected head SHA mismatch");
  if (currentRef !== "main") fail("governed command gateway must execute from trusted main");

  if (typeof commandId !== "string") fail("command must be a string");
  const command = registry.commands.find((entry) => entry.id === commandId);
  if (!command) fail(`unknown command: ${commandId}`);
  if (!command.enabled) fail(`command is disabled: ${commandId}`);

  const adapter = adapters[command.adapter];
  if (authorization !== adapter.confirmation) fail(`authorization mismatch for command: ${commandId}`);

  const schema = loadParameterSchema(command.parameter_schema, rootDir);
  validateParameters(schema, parameters, `parameters for ${commandId}`);
  if (adapter.gatewayShaParameterKey && parameters[adapter.gatewayShaParameterKey] !== currentHeadSha) {
    fail(`command ${commandId} must pin the same trusted main SHA as the gateway`);
  }

  const boundedInputs = {};
  for (const key of adapter.parameterKeys) boundedInputs[key] = parameters[key];
  boundedInputs.confirmation = authorization;

  return {
    contract: "mad4b.governed-command-dispatch-plan.v1",
    command: command.id,
    adapter: command.adapter,
    authority: command.authority,
    risk_class: command.risk_class,
    permission_profile: command.permission_profile,
    audit_policy: command.audit_policy,
    target_workflow: adapter.targetWorkflow,
    target_ref: adapter.targetRef,
    inputs: boundedInputs,
    protected_branch_guard: {
      pr_number: parameters[adapter.targetPrNumberKey],
      expected_pr_head_sha: parameters[adapter.targetPrHeadShaKey],
      required_base_ref: "main",
      require_same_repository: true,
      forbidden_branches: ["main", "Production"],
    },
    evidence: {
      gateway_sha: currentHeadSha,
      authorization_verified: true,
      sha_pin_verified: true,
      registry_validated: true,
      schema_validated: true,
      direct_production_mutation: false,
      arbitrary_workflow_execution: false,
      arbitrary_code_execution: false,
    },
  };
}
