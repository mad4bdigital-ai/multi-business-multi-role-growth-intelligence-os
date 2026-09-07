import fs from "node:fs";

const routesPath = "http-generic-api/routes/systemLayerRoutes.js";
const kernelPath = "http-generic-api/recoveryKernel.js";
const fixedToolTestPath = "http-generic-api/test-fixed-host-local-system-tool.mjs";

function fail(message) {
  throw new Error(`P0_PATCH_FAILED: ${message}`);
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) fail(`${label}: anchor missing`);
  if (text.indexOf(before, first + before.length) >= 0) fail(`${label}: anchor is not unique`);
  return `${text.slice(0, first)}${after}${text.slice(first + before.length)}`;
}

function replaceAllExact(text, before, after, expectedCount, label) {
  const parts = text.split(before);
  const count = parts.length - 1;
  if (count !== expectedCount) fail(`${label}: expected ${expectedCount} anchors, found ${count}`);
  return parts.join(after);
}

function replaceInSection(text, startMarker, endMarker, before, after, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) fail(`${label}: start marker missing`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) fail(`${label}: end marker missing`);
  const section = text.slice(start, end);
  const patched = replaceOnce(section, before, after, label);
  return `${text.slice(0, start)}${patched}${text.slice(end)}`;
}

let routes = fs.readFileSync(routesPath, "utf8");
let kernel = fs.readFileSync(kernelPath, "utf8");
let fixedToolTest = fs.readFileSync(fixedToolTestPath, "utf8");

routes = replaceOnce(
  routes,
  'import { issueAndExecuteApprovedRecoveryStep, sanitizeRecoveryActionBridgeOutput } from "../recoveryActionBridge.js";\n',
  'import { issueAndExecuteApprovedRecoveryStep, sanitizeRecoveryActionBridgeOutput } from "../recoveryActionBridge.js";\nimport { STAGING_RECOVERY_SYSTEM_TOOLS } from "../stagingRecoverySystemSurface.js";\nimport * as StagingRecoverySystemSurfaceRuntime from "../stagingRecoverySystemSurface.js";\n',
  "staging recovery imports",
);

routes = replaceOnce(
  routes,
  '  ...CAPABILITY_ENABLEMENT_SYSTEM_TOOLS,\n  ...GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PROVISIONING_SYSTEM_TOOLS,\n];',
  '  ...STAGING_RECOVERY_SYSTEM_TOOLS,\n  ...CAPABILITY_ENABLEMENT_SYSTEM_TOOLS,\n  ...GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_PROVISIONING_SYSTEM_TOOLS,\n];',
  "staging recovery tool descriptors",
);

routes = replaceOnce(
  routes,
  '  {\n    source_key: "capability_enablement_broker_v1",\n    tools: CAPABILITY_ENABLEMENT_SYSTEM_TOOLS,\n    handlers: CapabilityEnablementBrokerRuntime,\n    readiness_tool: "capability_enablement_readiness_smoke",\n    readiness_args: {},\n  },\n];',
  '  {\n    source_key: "staging_recovery_system_surface_v1",\n    tools: STAGING_RECOVERY_SYSTEM_TOOLS,\n    handlers: StagingRecoverySystemSurfaceRuntime,\n    readiness_tool: "staging_recovery_surface_readiness_smoke",\n    readiness_args: {},\n  },\n  {\n    source_key: "capability_enablement_broker_v1",\n    tools: CAPABILITY_ENABLEMENT_SYSTEM_TOOLS,\n    handlers: CapabilityEnablementBrokerRuntime,\n    readiness_tool: "capability_enablement_readiness_smoke",\n    readiness_args: {},\n  },\n];',
  "staging recovery descriptor source",
);

routes = replaceOnce(
  routes,
  'function toolsForPrincipal(auth) {\n  if (isAdminPrincipal(auth)) return SYSTEM_LAYER_TOOLS;\n  return SYSTEM_LAYER_TOOLS.filter((tool) => tool.requires_admin !== true && !TENANT_BLOCKED_SYSTEM_TOOL_NAMES.has(tool.name));\n}\n',
  `function recoveryEnvironmentIsStaging(env = process.env) {\n  const values = [env.DEPLOYMENT_ENVIRONMENT, env.REMOTE_MCP_ENVIRONMENT, env.NODE_ENV]\n    .map((value) => String(value || "").trim().toLowerCase())\n    .filter(Boolean);\n  if (values.some((value) => ["production", "prod", "production_hostinger_autodeploy"].includes(value))) return false;\n  return values.some((value) => ["staging", "stage", "staging_local_windows_docker"].includes(value));\n}\n\nfunction systemToolVisibleInEnvironment(tool = {}, env = process.env) {\n  const environments = Array.isArray(tool.environments) ? tool.environments.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean) : [];\n  if (!environments.length) return true;\n  if (environments.includes("staging")) return recoveryEnvironmentIsStaging(env);\n  return false;\n}\n\nfunction toolsForPrincipal(auth, env = process.env) {\n  const environmentVisible = SYSTEM_LAYER_TOOLS.filter((tool) => systemToolVisibleInEnvironment(tool, env));\n  if (isAdminPrincipal(auth)) return environmentVisible;\n  return environmentVisible.filter((tool) => tool.requires_admin !== true && !TENANT_BLOCKED_SYSTEM_TOOL_NAMES.has(tool.name));\n}\n\nfunction assertSystemToolEnvironmentAccess(name, env = process.env) {\n  const descriptor = SYSTEM_LAYER_TOOLS.find((tool) => tool.name === name);\n  if (!descriptor || systemToolVisibleInEnvironment(descriptor, env)) return;\n  const err = new Error("This system-layer tool is not available in the active runtime environment.");\n  err.status = 404;\n  err.code = "system_tool_environment_not_available";\n  err.details = { tool_name: name, secrets_included: false };\n  throw err;\n}\n`,
  "environment scoped discovery",
);

routes = replaceOnce(
  routes,
  '  assertAdminToolAccess(name, auth);\n\n  const descriptorSystemTool = await callDescriptorSystemToolIfAvailable(name, args, auth, deps);',
  '  assertAdminToolAccess(name, auth);\n  assertSystemToolEnvironmentAccess(name, deps.env || deps.recoveryKernelEnv || process.env);\n\n  const descriptorSystemTool = await callDescriptorSystemToolIfAvailable(name, args, auth, deps);',
  "environment scoped call guard",
);

routes = replaceInSection(
  routes,
  '    name: "recovery_kernel_execute_approved_step",',
  '  {\n    name: "recovery_kernel_create_approval_challenge",',
  '      required: ["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key"],\n      properties: {\n        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{16,64}$" },\n        plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },\n        step_id: { type: "string", pattern: "^step:[0-9a-f]{16,64}$" },\n        approval_token: { type: "string", minLength: 16, maxLength: 512 },\n        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },\n      },',
  '      required: ["plan_id", "plan_hash", "step_id", "approval_id", "expected_sha", "typed_confirmation", "idempotency_key"],\n      properties: {\n        plan_id: { type: "string", pattern: "^plan:[0-9a-f]{16,64}$" },\n        plan_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },\n        step_id: { type: "string", pattern: "^step:[0-9a-f]{16,64}$" },\n        approval_id: { type: "string", pattern: "^approval:[0-9a-f]{16,64}$" },\n        expected_sha: { type: "string", pattern: "^[0-9a-fA-F]{40}$" },\n        typed_confirmation: { type: "string", pattern: "^APPROVE PRODUCTION RECOVERY approval:[0-9a-f]{16,64} step:[0-9a-f]{16,64} [0-9a-f]{40}$", maxLength: 512 },\n        idempotency_key: { type: "string", minLength: 8, maxLength: 160 },\n      },',
  "recovery bridge v2 descriptor",
);

routes = replaceInSection(
  routes,
  '    case "recovery_kernel_execute_approved_step": {',
  '    case "recovery_kernel_call": {',
  '      const allowedKeys = new Set(["plan_id", "plan_hash", "step_id", "approval_token", "idempotency_key"]);',
  '      const allowedKeys = new Set(["plan_id", "plan_hash", "step_id", "approval_id", "expected_sha", "typed_confirmation", "idempotency_key"]);',
  "recovery bridge v2 handler keys",
);

routes = replaceInSection(
  routes,
  '    case "recovery_kernel_execute_approved_step": {',
  '    case "recovery_kernel_call": {',
  '        approvalVerifier: deps.approvalVerifier,\n        approvalStore: deps.approvalStore,',
  '        approvalIssuer: deps.approvalIssuer,\n        approvalVerifier: deps.approvalVerifier,\n        approvalStore: deps.approvalStore,',
  "recovery bridge approval resolver",
);

routes = replaceOnce(
  routes,
  '    readbackVerifier,\n    executionTicketSigner,\n    hostBreakglassMutationExecutor,\n    systemToolLookup,',
  '    readbackVerifier,\n    executionTicketSigner,\n    deploymentIdentityProvider,\n    migrationLedger,\n    hostBreakglassMutationExecutor,\n    systemToolLookup,',
  "system route recovery dependency destructure",
);

routes = replaceAllExact(
  routes,
  '          readbackVerifier,\n          executionTicketSigner,\n          hostBreakglassMutationExecutor,\n          systemToolLookup,',
  '          readbackVerifier,\n          executionTicketSigner,\n          deploymentIdentityProvider,\n          migrationLedger,\n          hostBreakglassMutationExecutor,\n          systemToolLookup,',
  2,
  "system route recovery dependency forwarding",
);

kernel = replaceOnce(
  kernel,
  '\n]);\n\nconst CAPABILITY_INDEX = new Map(RECOVERY_KERNEL_CAPABILITIES.map((entry) => [entry.capability_key, entry]));',
  '\n  capability("staging.certification.canary.plan_create", "C1", "Create the exact-main Staging certification canary plan in the durable Recovery control-plane store without executing it or mutating a database/provider.", { dependencies: ["exact_staging_sha", "staging_target_fingerprint", "durable_recovery_store"], environments: ["staging"] }),\n  capability("staging_database_access_repair.prepare", "C1", "Create the bounded Staging database-access repair approval plan with server-resolved target identity; no SQL, command, database identifier, provider call, or Production target is caller-controlled.", { dependencies: ["exact_staging_sha", "grant_binding_hash", "durable_recovery_store"], environments: ["staging"] }),\n  capability("staging_database_access_repair.approve", "C1", "Consume the exact Staging access-repair typed confirmation and issue the single-use signed execution ticket inside the server-managed authority; no database mutation occurs at this stage.", { dependencies: ["staging_access_repair_plan", "typed_confirmation", "execution_ticket_signer"], environments: ["staging"] }),\n]);\n\nconst CAPABILITY_INDEX = new Map(RECOVERY_KERNEL_CAPABILITIES.map((entry) => [entry.capability_key, entry]));',
  "staging recovery capability declarations",
);

kernel = replaceOnce(
  kernel,
  '  const visibleKeys = staging ? new Set(["recovery_capabilities", "system_tool_get", "system_tools_search"]) : null;',
  '  const visibleKeys = staging ? new Set(["recovery_capabilities", "system_tool_get", "system_tools_search", "staging.certification.canary.plan_create", "staging_database_access_repair.prepare", "staging_database_access_repair.approve"]) : null;',
  "staging recovery visible capabilities",
);

kernel = replaceOnce(
  kernel,
  '    environment_view: staging ? "staging_discovery_only" : "production_private_recovery",',
  '    environment_view: staging ? "staging_governed_control_plane" : "production_private_recovery",',
  "staging environment semantics",
);

kernel = replaceOnce(
  kernel,
  '    fixed_aliases: staging ? { recovery_capabilities: "recovery_capabilities", system_tool_get: "system_tool_get", system_tools_search: "system_tools_search" } : CAPABILITY_ALIASES,\n    capabilities,',
  '    fixed_aliases: staging ? { recovery_capabilities: "recovery_capabilities", system_tool_get: "system_tool_get", system_tools_search: "system_tools_search" } : CAPABILITY_ALIASES,\n    system_surface_tools: staging ? ["staging_certification_canary_plan_create", "staging_recovery_access_repair_prepare", "staging_recovery_access_repair_approve"] : [],\n    capabilities,',
  "staging system surface declaration",
);

fixedToolTest = replaceOnce(
  fixedToolTest,
  'test("Staging recovery capability view is discovery-only and omits Production private names", async () => {\n  const staging = await callSystemLayerTool("recovery_kernel_capabilities", {}, ADMIN, { recoveryKernelEnv: { NODE_ENV: "staging" } });\n  assert.equal(staging.environment_view, "staging_discovery_only");\n  assert.deepEqual(staging.capabilities.map((entry) => entry.capability_key).sort(), ["recovery_capabilities", "system_tool_get", "system_tools_search"]);\n  assert.equal(staging.secrets_included, false);\n});',
  'test("Staging recovery capability view exposes bounded governed control-plane capabilities and omits Production private names", async () => {\n  const staging = await callSystemLayerTool("recovery_kernel_capabilities", {}, ADMIN, { recoveryKernelEnv: { NODE_ENV: "staging" } });\n  assert.equal(staging.environment_view, "staging_governed_control_plane");\n  assert.deepEqual(staging.system_surface_tools, ["staging_certification_canary_plan_create", "staging_recovery_access_repair_prepare", "staging_recovery_access_repair_approve"]);\n  assert.deepEqual(staging.capabilities.map((entry) => entry.capability_key).sort(), ["recovery_capabilities", "staging.certification.canary.plan_create", "staging_database_access_repair.approve", "staging_database_access_repair.prepare", "system_tool_get", "system_tools_search"].sort());\n  assert.equal(staging.mutation_capabilities.length, 0);\n  assert.equal(staging.secrets_included, false);\n});',
  "staging capability semantics test",
);

fs.writeFileSync(routesPath, routes);
fs.writeFileSync(kernelPath, kernel);
fs.writeFileSync(fixedToolTestPath, fixedToolTest);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-recovery-system-surface-p0-patch.v1",
  files: [routesPath, kernelPath, fixedToolTestPath],
  production_mutation_performed: false,
  database_mutation_performed: false,
  provider_mutation_performed: false,
  secrets_included: false,
}));
