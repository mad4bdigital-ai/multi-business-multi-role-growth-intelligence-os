/**
 * test-custom-gpt-schemas.mjs
 *
 * Contract checks for the active Custom GPT OpenAPI action schemas.
 * These tests stay local and deterministic: no network, DB, or credentials.
 *
 * Run: node test-custom-gpt-schemas.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ACTIVE_SCHEMAS = {
  "openapi.custom-gpt.auth-dispatcher.yaml": {
    serverUrl: "https://auth.mad4b.com",
    securityScheme: "backendBearerAuth",
    maxOperations: 30,
    requiredOperations: ["listAdminTools", "callAdminTool", "repairLocalConnector"],
  },
  "openapi.tenant-gpt.auth.yaml": {
    serverUrl: "https://auth.mad4b.com",
    securityScheme: "userBearerAuth",
    maxOperations: 30,
    requiredOperations: [
      "activateSession",
      "listTools",
      "callTool",
      "tenantPlatformPluginCatalog",
      "tenantPlatformPluginInstall",
      "tenantPlatformPluginResolve",
      "writeSessionTurn",
      "endSession",
    ],
  },
  "openapi.gpt-action.dev-dispatcher.yaml": {
    serverUrl: "https://dev.mad4b.com",
    securityScheme: "backendBearerAuth",
    maxOperations: 10,
    requiredOperations: ["getDevHealth", "getDevDeploymentInfo", "getDevDbStatus"],
  },
  "openapi.gpt-action.local-connector.yaml": {
    serverUrl: "https://connector.mad4b.com",
    securityScheme: "connectorBearerAuth",
    maxOperations: 30,
    requiredOperations: ["connectorHealth", "connectorShell", "connectorCf"],
  },
};

const OBSOLETE_SCHEMAS = [
  "openapi.custom-gpt.runtime.yaml",
  "openapi.custom-gpt.identity.yaml",
  "openapi.custom-gpt.customers.yaml",
  "openapi.custom-gpt.systems.yaml",
  "openapi.custom-gpt.logic.yaml",
  "openapi.custom-gpt.observability.yaml",
  "openapi.custom-gpt.developer.yaml",
  "openapi.custom-gpt.admin-cli.yaml",
  "openapi.custom-gpt.ops.yaml",
];

const METHOD_NAMES = new Set(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
const MAX_DESCRIPTION_LENGTH = 300;

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function loadSchema(file) {
  return YAML.parse(readFileSync(resolve(__dirname, file), "utf8"));
}

function collectOperations(doc) {
  const operations = [];
  for (const [pathKey, pathItem] of Object.entries(doc.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (!METHOD_NAMES.has(method)) continue;
      operations.push({ pathKey, pathItem, method, operation });
    }
  }
  return operations;
}

function resolveLocalRef(doc, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return null;
    current = current[part];
  }
  return current;
}

function effectiveSchema(doc, schema) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.$ref) return effectiveSchema(doc, resolveLocalRef(doc, schema.$ref));
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.find((option) => effectiveSchema(doc, option)?.type === "object") || schema;
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.find((option) => effectiveSchema(doc, option)?.type === "object") || schema;
  }
  return schema;
}

function walkDescriptions(value, path = "$", out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkDescriptions(item, `${path}[${index}]`, out));
    return out;
  }
  if (typeof value.description === "string" && value.description.length > MAX_DESCRIPTION_LENGTH) {
    out.push({ path: `${path}.description`, length: value.description.length });
  }
  for (const [key, child] of Object.entries(value)) {
    walkDescriptions(child, `${path}.${key}`, out);
  }
  return out;
}

function parameterKey(parameter) {
  return `${parameter?.in || ""}:${parameter?.name || ""}`;
}

function assertToolArgsContract(doc, operationId) {
  const operation = collectOperations(doc).find((op) => op.operation.operationId === operationId)?.operation;
  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  assert(`${operationId} body requires name`, Array.isArray(schema?.required) && schema.required.includes("name"));
  assert(`${operationId} body exposes tool_args`, Boolean(schema?.properties?.tool_args));
  assert(`${operationId} body does not expose legacy arguments`, !schema?.properties?.arguments);
}

function assertNonConsequentialOperation(doc, operationId) {
  const operation = collectOperations(doc).find((op) => op.operation.operationId === operationId)?.operation;
  assert(`${operationId} is non-consequential`, operation?.["x-openai-isConsequential"] === false);
}

section("schema inventory");
for (const file of Object.keys(ACTIVE_SCHEMAS)) {
  assert(`${file} exists`, existsSync(resolve(__dirname, file)));
}
for (const file of OBSOLETE_SCHEMAS) {
  assert(`${file} is deleted`, !existsSync(resolve(__dirname, file)));
}

for (const [file, expected] of Object.entries(ACTIVE_SCHEMAS)) {
  const doc = loadSchema(file);
  const label = basename(file);
  const operations = collectOperations(doc);

  section(label);

  assert("uses OpenAPI 3.1", doc.openapi === "3.1.0", `got ${doc.openapi}`);
  assert("has exactly one server", Array.isArray(doc.servers) && doc.servers.length === 1);
  assert("server URL matches live host", doc.servers?.[0]?.url === expected.serverUrl, `got ${doc.servers?.[0]?.url}`);
  assert(`operation count <= ${expected.maxOperations}`, operations.length <= expected.maxOperations, `got ${operations.length}`);
  assert("has at least one operation", operations.length > 0);
  assert("does not expose root path operation", !operations.some((operation) => operation.pathKey === "/"));

  const securitySchemes = Object.keys(doc.components?.securitySchemes || {});
  assert("exposes expected security scheme", securitySchemes.includes(expected.securityScheme), `got ${securitySchemes.join(", ")}`);

  const operationIds = new Set(operations.map((op) => op.operation.operationId).filter(Boolean));
  for (const operationId of expected.requiredOperations) {
    assert(`exposes ${operationId}`, operationIds.has(operationId));
  }

  const longDescriptions = walkDescriptions(doc);
  assert("all descriptions are <= 300 chars", longDescriptions.length === 0,
    longDescriptions.map((item) => `${item.path}:${item.length}`).join(", "));

  for (const { pathKey, pathItem, method, operation } of operations) {
    const opLabel = `${method.toUpperCase()} ${pathKey} ${operation.operationId || ""}`.trim();
    assert(`${opLabel} path is absolute`, pathKey.startsWith("/"), pathKey);
    const combinedParameters = [
      ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
      ...(Array.isArray(operation.parameters) ? operation.parameters : []),
    ];
    const seen = new Set();
    const duplicates = [];
    for (const parameter of combinedParameters) {
      const key = parameterKey(parameter);
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    assert(`${opLabel} has no duplicate parameters`, duplicates.length === 0, duplicates.join(", "));

    const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
    if (requestSchema) {
      const schema = effectiveSchema(doc, requestSchema);
      assert(`${opLabel} request body schema is object`, schema?.type === "object", JSON.stringify(requestSchema));
    }
  }
}

section("dispatcher contracts");
{
  const adminDoc = loadSchema("openapi.custom-gpt.auth-dispatcher.yaml");
  const tenantDoc = loadSchema("openapi.tenant-gpt.auth.yaml");
  const devDoc = loadSchema("openapi.gpt-action.dev-dispatcher.yaml");
  const parentDoc = loadSchema("openapi.yaml");

  assertToolArgsContract(adminDoc, "callAdminTool");
  assertToolArgsContract(tenantDoc, "callTool");

  for (const operationId of ["callSystemTool", "callAdminSystemTool", "callAdminTool", "repairLocalConnector"]) {
    assertNonConsequentialOperation(adminDoc, operationId);
  }

  const adminOps = collectOperations(adminDoc);
  assert("admin dispatcher includes GPT tool catalog route",
    adminOps.some((op) => op.pathKey === "/gpt/tools" && op.method === "get"));
  assert("admin dispatcher includes GPT tool call route",
    adminOps.some((op) => op.pathKey === "/gpt/tools/call" && op.method === "post"));
  assert("admin dispatcher hides direct admin control route",
    !adminOps.some((op) => op.operation.operationId === "executeAdminControl"));
  assert("auth dispatcher does not expose dev-host diagnostic routes",
    !adminOps.some((op) => ["/deployment-info", "/dev/db/status"].includes(op.pathKey)));
  assert("admin dispatcher keeps device capability routes DB-backed",
    !adminOps.some((op) => [
      "/connector/{device_id}/dependencies",
      "/connector/{device_id}/apps",
      "/connector/{device_id}/browser",
      "/connector/{device_id}/ps",
      "/connector/{device_id}/win",
      "/connector/{device_id}/n8n",
      "/connector/{device_id}/cf",
    ].includes(op.pathKey)));
  const hiddenDirectAdminOperationIds = [
    "upsertAdminGoogleAuthPlatformTab",
    "upsertAdminApisServicesCredentials",
    "executeHostingerApiCall",
    "executeCloudflareApiCall",
    "upsertDnsRecord",
    "deleteDnsRecord",
    "issuePlatformJwtClientToken",
    "linkSessionContinuityUser",
    "importSchemaUpload",
    "importSchemaFromRepo",
  ];
  for (const operationId of hiddenDirectAdminOperationIds) {
    assert(`admin dispatcher hides direct ${operationId}`,
      !adminOps.some((op) => op.operation.operationId === operationId));
  }
  const adminMutatingOps = adminOps.filter((op) => ["post", "put", "patch", "delete"].includes(op.method));
  assert("admin dispatcher mutating operations are non-consequential or hidden",
    adminMutatingOps.every((op) => op.operation["x-openai-isConsequential"] === false),
    adminMutatingOps
      .filter((op) => op.operation["x-openai-isConsequential"] !== false)
      .map((op) => `${op.method.toUpperCase()} ${op.pathKey} ${op.operation.operationId}`)
      .join(", "));

  const tenantPostOps = collectOperations(tenantDoc).filter((op) => op.method === "post");
  const tenantAllowedConsequentialOps = new Set(["tenantPlatformPluginInstall"]);
  assert("tenant dispatcher POST operations are non-consequential except explicit install consent surfaces",
    tenantPostOps.every((op) => op.operation["x-openai-isConsequential"] === false || tenantAllowedConsequentialOps.has(op.operation.operationId)),
    tenantPostOps
      .filter((op) => op.operation["x-openai-isConsequential"] !== false && !tenantAllowedConsequentialOps.has(op.operation.operationId))
      .map((op) => op.pathKey)
      .join(", "));

  const devOps = collectOperations(devDoc);
  const devOperationIds = new Set(devOps.map((op) => op.operation.operationId).filter(Boolean));
  assert("dev dispatcher exposes only passive diagnostic operations",
    ["getDevHealth", "getDevDeploymentInfo", "getDevDbStatus"].every((op) => devOperationIds.has(op)) &&
    devOps.every((op) => op.operation["x-openai-isConsequential"] === false));
  assert("parent OpenAPI documents dev dispatcher routes",
    Boolean(parentDoc.paths?.["/deployment-info"]) && Boolean(parentDoc.paths?.["/dev/db/status"]));
}

section("admin and tenant OpenAI schema coverage for tool additions");
{
  const adminDoc = loadSchema("openapi.custom-gpt.auth-dispatcher.yaml");
  const tenantDoc = loadSchema("openapi.tenant-gpt.auth.yaml");
  const parentDoc = loadSchema("openapi.yaml");
  const parentSchema = readFileSync(resolve(__dirname, "openapi.yaml"), "utf8");
  const tenantInstructions = readFileSync(resolve(__dirname, "../GPT_Tenant_Connector_Instructions.md"), "utf8");
  const tenantKnowledge = readFileSync(resolve(__dirname, "../GPT_Tenant_Connector_Knowledge.md"), "utf8");
  const activationModePolicy = readFileSync(resolve(__dirname, "activationModePolicy.js"), "utf8");
  const dedicatedPolicy = readFileSync(resolve(__dirname, "dedicatedIntegrationPolicy.js"), "utf8");
  const hybridPolicy = readFileSync(resolve(__dirname, "hybridIntegrationPolicy.js"), "utf8");
  const connectRoutes = readFileSync(resolve(__dirname, "routes/connectRoutes.js"), "utf8");
  const systemLayerRoutes = readFileSync(resolve(__dirname, "routes/systemLayerRoutes.js"), "utf8");
  const localConnectorRoutes = readFileSync(resolve(__dirname, "routes/localConnectorRoutes.js"), "utf8");
  const remoteRuntime = readFileSync(resolve(__dirname, "remoteRuntime.js"), "utf8");
  const credentialIntakeRoutes = readFileSync(resolve(__dirname, "routes/credentialIntakeRoutes.js"), "utf8");
  const credentialRoutes = readFileSync(resolve(__dirname, "routes/credentialRoutes.js"), "utf8");
  const migration187 = readFileSync(resolve(__dirname, "migrations/187_sprint66_platform_secret_intake_promotion_tool.sql"), "utf8");
  const migration104 = readFileSync(resolve(__dirname, "migrations/104_sprint64_activation_mode_governance.sql"), "utf8");
  const migration105 = readFileSync(resolve(__dirname, "migrations/105_sprint64_dedicated_integration_flow.sql"), "utf8");
  const migration106 = readFileSync(resolve(__dirname, "migrations/106_sprint64_hybrid_integration_policy.sql"), "utf8");
  const migration182 = readFileSync(resolve(__dirname, "migrations/182_sprint66_platform_hostinger_ssh_db_credentials.sql"), "utf8");

  const adminOps = collectOperations(adminDoc);
  const adminOpIds = new Set(adminOps.map((op) => op.operation.operationId).filter(Boolean));
  for (const operationId of [
    "listAdminTools",
    "callAdminTool",
    "listAdminSystemTools",
    "callAdminSystemTool",
    "getPlatformDataSourceCensus",
    "listDeviceTools",
    "callDeviceTool",
  ]) {
    assert(`admin OpenAI schema exposes ${operationId}`, adminOpIds.has(operationId));
  }
  assert("admin OpenAI schema keeps direct DB diagnostics behind callAdminTool/admin_control",
    adminOpIds.has("callAdminTool") && !adminOpIds.has("executeAdminControl"));
  assert("admin OpenAI schema documents the direct SQL data-source census route",
    Boolean(adminDoc.paths?.["/admin/cli/data-source/census"]));

  const tenantOps = collectOperations(tenantDoc);
  const tenantOpIds = new Set(tenantOps.map((op) => op.operation.operationId).filter(Boolean));
  const activateSessionOp = tenantDoc.paths?.["/activation/session-context"]?.get;
  assert("tenant activateSession requires OAuth before the first API request",
    Array.isArray(activateSessionOp?.security) &&
    activateSessionOp.security.some((entry) => Object.prototype.hasOwnProperty.call(entry, "userBearerAuth")));
  const expectedTenantOps = [
    "activateSession",
    "listTools",
    "callTool",
    "tenantPlatformPluginCatalog",
    "tenantPlatformPluginInstall",
    "tenantPlatformPluginResolve",
    "writeSessionTurn",
    "endSession",
  ];
  assert("tenant OpenAI schema exposes MCP meta operations plus tenant Platform Plugin self-serve operations",
    expectedTenantOps.every((op) => tenantOpIds.has(op)) && tenantOps.length <= ACTIVE_SCHEMAS["openapi.tenant-gpt.auth.yaml"].maxOperations,
    `got ${Array.from(tenantOpIds).join(",")}`);
  assert("tenant OpenAI schema does not expose direct connect routes",
    !Object.keys(tenantDoc.paths || {}).some((path) => path.startsWith("/connect")));
  assert("tenant OpenAI schema exposes tenant Platform Plugin routes only under /tenant/platform/plugins",
    ["/tenant/platform/plugins/catalog", "/tenant/platform/plugins/install", "/tenant/platform/plugins/resolve"].every((path) => Boolean(tenantDoc.paths?.[path])));
  const tenantCallToolSchema = tenantDoc.paths?.["/system/tools/call"]?.post?.requestBody?.content?.["application/json"]?.schema;
  const tenantToolArgsSchema = tenantCallToolSchema?.properties?.tool_args;
  const tenantCallToolNames = new Set(tenantCallToolSchema?.properties?.name?.enum || []);
  assert("tenant OpenAI schema tells GPT to pass activation mode and integration_modes through callTool",
    JSON.stringify(tenantDoc.info || {}).includes("connect_activate") &&
    JSON.stringify(tenantDoc.paths?.["/system/tools/call"] || {}).includes("integration_modes"));
  for (const toolName of ["connect_status", "connect_activate", "connect_device_install", "local_gateway_tools_list", "local_gateway_tools_call"]) {
    assert(`tenant callTool name enum exposes ${toolName}`, tenantCallToolNames.has(toolName));
  }
  assert("tenant callTool explicitly exposes wrapper-safe tool_args.mode",
    tenantToolArgsSchema?.properties?.mode?.enum?.includes("managed") &&
    tenantToolArgsSchema?.properties?.mode?.enum?.includes("dedicated"));
  assert("tenant callTool explicitly exposes wrapper-safe tool_args.device_id",
    tenantToolArgsSchema?.properties?.device_id?.pattern === "^[a-z0-9-]{2,32}$");
  assert("connect device install handoff points to released Local Manager download page",
    connectRoutes.includes('download_url: "/app/local-manager#download"') &&
    connectRoutes.includes('download_page_url: "https://auth.mad4b.com/app/local-manager#download"') &&
    connectRoutes.includes('new_device_pairing_url: "https://auth.mad4b.com/app/local-manager#download"'));
  assert("connect status tells tenant GPT not to auto-install when a device exists",
    connectRoutes.includes('gpt_activation_guidance: buildTenantGptActivationGuidance') &&
    connectRoutes.includes('should_call_connect_device_install: !hasRegisteredDevice') &&
    connectRoutes.includes('Do not call connect_device_install automatically after connect_status'));
  assert("system tools/call forwards the original request context for tenant registry tools",
    systemLayerRoutes.includes('callSystemLayerTool(name, args, req.auth, { executionFacade, req })') &&
    systemLayerRoutes.includes('const req = deps.req || { auth, headers: deps.headers || {}, ip: deps.ip || null };'));
  assert("local connector health/devices derive tenant user identity from auth context",
    localConnectorRoutes.includes('function resolveLocalConnectorIdentity') &&
    localConnectorRoutes.includes('user_id: req.auth?.user_id || null') &&
    localConnectorRoutes.includes('tenant_id: req.auth?.tenant_id || null'));
  assert("tenant instructions tell GPT not to auto-install or pass user tenant ids",
    tenantInstructions.includes('should_call_connect_device_install') &&
    tenantInstructions.includes('never provide `user_id` or `tenant_id`'));
  assert("tenant knowledge documents JWT-scoped connector health",
    tenantKnowledge.includes('gpt_activation_guidance.should_call_connect_device_install') &&
    tenantKnowledge.includes('user and tenant IDs must come from the JWT'));
  assert("remote runtime validates Hostinger SSH via DB credential bindings, not server env",
    remoteRuntime.includes('loadHostingSshCredentialReadiness') &&
    remoteRuntime.includes('db_credential_bindings_present_pending_secret_values') &&
    remoteRuntime.includes('db_credential_values_present_ssh_not_probed'));
  assert("remote runtime credential binding join is collation-safe",
    remoteRuntime.includes('cb.credential_ref COLLATE utf8mb4_unicode_ci') &&
    remoteRuntime.includes('CONCAT(\'platform_secret:\', ps.secret_key) COLLATE utf8mb4_unicode_ci'));
  assert("migration 182 registers platform brand DB-encrypted Hostinger SSH refs",
    migration182.includes('@platform_brand_key := \'growth_intelligence_platform\'') &&
    migration182.includes('platform_secret:hostinger_ssh_prod_private_key') &&
    migration182.includes('storage_backend`, `secret_ref`, `value_sha256`, `value_ciphertext`') &&
    migration182.includes('store_type = \'db_encrypted\'') &&
    migration182.includes('credential_bindings'));
  assert("migration 182 uses MariaDB-compatible JSON mutation syntax",
    migration182.includes('COALESCE(config_json, JSON_OBJECT())') &&
    !migration182.includes('CAST(config_json AS JSON)'));

  for (const [path, operationId] of [
    ["/connect/activate", "postConnectActivate"],
    ["/connect/device-install", "postConnectDeviceInstall"],
    ["/connect/api/integration-policy", "updateConnectIntegrationPolicy"],
    ["/connect/api/credential-intake/sessions", "createConnectCredentialIntakeSession"],
    ["/connect/api/app-integrations", "listConnectApiAppIntegrations"],
    ["/connect/api/connections", "listConnectApiConnections"],
    ["/connect/api/connections/{connection_id}", "deleteConnectApiConnection"],
  ]) {
    assert(`parent OpenAPI documents ${path}`, Boolean(parentDoc.paths?.[path]));
    assert(`parent OpenAPI operation ${operationId} is present`, parentSchema.includes(operationId));
  }

  assert("tenant compact instructions stay under 8k characters",
    tenantInstructions.length < 8000,
    `got ${tenantInstructions.length}`);
  assert("tenant compact instructions point long guidance to knowledge file",
    tenantInstructions.includes("must stay **under 8,000 characters**") &&
    tenantInstructions.includes("GPT_Tenant_Connector_Knowledge.md"));
  assert("tenant knowledge file exists with detailed connector guidance",
    tenantKnowledge.includes("Mad4B Tenant Connector Knowledge") &&
    tenantKnowledge.includes("/connect frontend requirements"));
  assert("tenant instructions forbid standalone connector action",
    tenantInstructions.includes("Remove and never use a standalone `connector.mad4b.com` action") &&
    tenantInstructions.includes("not valid tenant evidence"));
  assert("tenant knowledge explains admin-hostname mismatch risk",
    tenantKnowledge.includes("admin Windows hostname `Essam`") &&
    tenantKnowledge.includes("not acceptable tenant evidence"));
  assert("tenant compact instructions stay under 8k characters",
    tenantInstructions.length < 8000,
    `got ${tenantInstructions.length}`);
  assert("tenant compact instructions point long guidance to knowledge file",
    tenantInstructions.includes("must stay **under 8,000 characters**") &&
    tenantInstructions.includes("GPT_Tenant_Connector_Knowledge.md"));
  assert("tenant knowledge file exists with detailed connector guidance",
    tenantKnowledge.includes("Mad4B Tenant Connector Knowledge") &&
    tenantKnowledge.includes("/connect frontend requirements"));
  assert("tenant instructions forbid standalone connector action",
    tenantInstructions.includes("Remove and never use a standalone `connector.mad4b.com` action") &&
    tenantInstructions.includes("not valid tenant evidence"));
  assert("tenant knowledge explains admin-hostname mismatch risk",
    tenantKnowledge.includes("admin Windows hostname `Essam`") &&
    tenantKnowledge.includes("not acceptable tenant evidence"));
  for (const toolKey of [
    "connect_activate",
    "connect_device_install",
    "connect_app_integrations_list",
    "connect_app_connections_list",
    "connect_credential_intake_create",
    "connect_app_connection_revoke",
    "connect_integration_policy_update",
  ]) {
    assert(`tenant instructions mention ${toolKey}`, tenantInstructions.includes(toolKey));
  }
  assert("tenant instructions preserve the no-third-hybrid-mode rule",
    tenantInstructions.includes("There is no third activation mode named `hybrid`") &&
    tenantInstructions.includes("integration_modes"));

  assert("activation mode policy is canonical managed/dedicated only",
    activationModePolicy.includes("CANONICAL_CONNECTION_MODES") &&
    activationModePolicy.includes("managed") && activationModePolicy.includes("dedicated") &&
    !activationModePolicy.includes('"hybrid"'));
  assert("dedicated policy requires tenant-owned Cloudflare and Hostinger readiness",
    dedicatedPolicy.includes('app_key: "cloudflare"') &&
    dedicatedPolicy.includes('app_key: "hostinger"') &&
    dedicatedPolicy.includes("user_app_connections"));
  assert("hybrid policy keeps mixed behavior per-app",
    hybridPolicy.includes("CANONICAL_INTEGRATION_SOURCE_MODES") &&
    hybridPolicy.includes("integration_modes") &&
    hybridPolicy.includes('mode: sourceModes.size > 1 ? "mixed"'));

  assert("migration 104 governs activation mode tool schema",
    migration104.includes("connect_activate") && migration104.includes('"required":["mode"]'));
  assert("migration 105 adds dedicated integration tenant tools",
    ["connect_app_integrations_list", "connect_credential_intake_create", "connect_app_connections_list", "connect_app_connection_revoke"]
      .every((toolKey) => migration105.includes(toolKey)));
  assert("migration 106 adds hybrid policy table and tenant update tool",
    migration106.includes("CREATE TABLE IF NOT EXISTS `tenant_integration_policies`") &&
    migration106.includes("connect_integration_policy_update") &&
    migration106.includes("integration_modes"));
}

section("DB tool registry fixtures");
{
  const migration = readFileSync(resolve(__dirname, "migrations/059_sprint54_local_connector_capability_tools.sql"), "utf8");
  const seed = readFileSync(resolve(__dirname, "seed-tool-registry.ps1"), "utf8");
  const dbBackedDeviceTools = [
    "connector_files",
    "connector_dependencies",
    "connector_apps",
    "connector_browser",
    "connector_ps",
    "connector_win",
    "connector_n8n",
    "connector_cf",
  ];
  for (const toolKey of dbBackedDeviceTools) {
    assert(`migration registers ${toolKey}`, migration.includes(`'${toolKey}'`));
    assert(`seed registers ${toolKey}`, seed.includes(`'${toolKey}'`));
  }
  assert("registry files schema includes drive and repo discovery",
    migration.includes('"list_drives"') && migration.includes('"locate_repo"') &&
    seed.includes('"list_drives"') && seed.includes('"locate_repo"'));
  assert("browser registry contract keeps URL scheme validation visible",
    migration.includes('"format":"uri"') && migration.includes("device,browser,interactive,classified"));
  assert("browser registry scale uses fraction units (0.1..1.0) in admin and tenant rows",
    (migration.match(/"scale":\{"type":"number","minimum":0\.1,"maximum":1\.0\}/g) || []).length >= 2 &&
    (seed.match(/"scale":\{"type":"number","minimum":0\.1,"maximum":1\.0\}/g) || []).length >= 2);
  assert("browser registry never uses 25..200 integer scale (old percent units)",
    !migration.includes('"minimum":25,"maximum":200') && !seed.includes('"minimum":25,"maximum":200'));
}

section("Sprint 55: admin scope-sharing controller");
{
  const migrationPath = resolve(__dirname, "migrations/060_sprint55_admin_scope_grants.sql");
  assert("migration 060 exists", existsSync(migrationPath));
  const migration060 = readFileSync(migrationPath, "utf8");
  const seed = readFileSync(resolve(__dirname, "seed-tool-registry.ps1"), "utf8");
  const parentSchema = readFileSync(resolve(__dirname, "openapi.yaml"), "utf8");

  assert("migration 060 creates admin_scope_grants table",
    migration060.includes("CREATE TABLE IF NOT EXISTS `admin_scope_grants`"));
  assert("admin_scope_grants table has audit-friendly columns",
    migration060.includes("`granted_by`") && migration060.includes("`revoked_at`") &&
    migration060.includes("`use_count`") && migration060.includes("`last_used_at`"));
  for (const toolKey of ["admin_scope_grant_create", "admin_scope_grant_list", "admin_scope_grant_revoke"]) {
    assert(`migration 060 registers admin tool ${toolKey}`, migration060.includes(`'${toolKey}'`));
    assert(`seed registers admin tool ${toolKey}`, seed.includes(`'${toolKey}'`));
  }
  assert("migration 060 registers tenant tool me_scope_grants_list",
    migration060.includes("'me_scope_grants_list'"));
  assert("seed registers tenant tool me_scope_grants_list",
    seed.includes("'me_scope_grants_list'"));

  assert("parent OpenAPI exposes /admin/scope-grants",
    parentSchema.includes("/admin/scope-grants:") && parentSchema.includes("createAdminScopeGrant") && parentSchema.includes("listAdminScopeGrants"));
  assert("parent OpenAPI exposes /admin/scope-grants/{grant_id} DELETE",
    parentSchema.includes("/admin/scope-grants/{grant_id}:") && parentSchema.includes("revokeAdminScopeGrant"));
  assert("parent OpenAPI exposes /me/scope-grants",
    parentSchema.includes("/me/scope-grants:") && parentSchema.includes("listMyScopeGrants"));

  const service = readFileSync(resolve(__dirname, "scopeGrantsService.js"), "utf8");
  assert("scopeGrantsService exports the dispatcher integration surface",
    service.includes("export async function findActiveGrantForTool") &&
    service.includes("export function validateArgsAgainstGrant") &&
    service.includes("export async function recordGrantUse"));
  assert("scopeGrantsService enforces revoked_at IS NULL AND expires_at gate",
    service.includes("revoked_at IS NULL") && service.includes("expires_at IS NULL OR expires_at > NOW()"));

  const dispatcher = readFileSync(resolve(__dirname, "routes/gptToolsRoutes.js"), "utf8");
  assert("dispatcher consults findActiveGrantForTool when tenant tool is missing",
    dispatcher.includes("findActiveGrantForTool") &&
    dispatcher.includes("validateArgsAgainstGrant") &&
    dispatcher.includes("recordGrantUse"));
  assert("dispatcher emits audit_log entry on grant dispatch",
    dispatcher.includes("admin_scope_grant_dispatch"));

  const routesFile = readFileSync(resolve(__dirname, "routes/adminScopeGrantsRoutes.js"), "utf8");
  assert("admin scope-grant routes are guarded by admin-only middleware",
    routesFile.includes("requireAdminPrincipal") && routesFile.includes("adminOnly"));
  assert("admin scope-grant routes never expose /me/scope-grants under admin-only guard",
    routesFile.includes('router.get("/me/scope-grants"') &&
    /router\.get\("\/me\/scope-grants",[^)]*userScopeOnly/.test(routesFile));
}

section("Sprint 56: device-tools MCP facade");
{
  const routesFile = readFileSync(resolve(__dirname, "routes/deviceToolsRoutes.js"), "utf8");
  const dispatcherSchema = readFileSync(resolve(__dirname, "openapi.custom-gpt.auth-dispatcher.yaml"), "utf8");
  const parentSchema = readFileSync(resolve(__dirname, "openapi.yaml"), "utf8");
  const gptToolsFile = readFileSync(resolve(__dirname, "routes/gptToolsRoutes.js"), "utf8");

  assert("device-tools route file exists with both endpoints",
    routesFile.includes('router.get("/device/tools"') &&
    routesFile.includes('router.post("/device/tools/call"'));
  assert("device-tools route enforces device-tag filter on dispatch",
    routesFile.includes("tool_not_in_device_surface") &&
    /isDeviceTagged/.test(routesFile));
  assert("device-tools route reuses gptToolsRoutes dispatcher",
    routesFile.includes("dispatchToolForCaller") &&
    routesFile.includes("fetchToolsForCaller") &&
    routesFile.includes("resolveCallerTypeForRequest"));
  assert("gptToolsRoutes exports the helpers used by deviceToolsRoutes",
    gptToolsFile.includes("export async function dispatchToolForCaller") &&
    gptToolsFile.includes("export async function fetchToolsForCaller") &&
    gptToolsFile.includes("export function resolveCallerTypeForRequest"));

  const dispatcherDoc = loadSchema("openapi.custom-gpt.auth-dispatcher.yaml");
  const dispatcherOps = collectOperations(dispatcherDoc);
  const dispatcherOpIds = new Set(dispatcherOps.map((op) => op.operation.operationId).filter(Boolean));
  assert("auth-dispatcher schema exposes listDeviceTools", dispatcherOpIds.has("listDeviceTools"));
  assert("auth-dispatcher schema exposes callDeviceTool", dispatcherOpIds.has("callDeviceTool"));
  assert("auth-dispatcher op count stays under 30 cap", dispatcherOps.length <= 30, `got ${dispatcherOps.length}`);

  assert("parent OpenAPI exposes /device/tools and /device/tools/call",
    parentSchema.includes("/device/tools:") && parentSchema.includes("/device/tools/call:") &&
    parentSchema.includes("listDeviceTools") && parentSchema.includes("callDeviceTool"));
}

section("Sprint 57: Local Manager device-link schema coverage");
{
  const parentDoc = loadSchema("openapi.yaml");
  const childDoc = YAML.parse(readFileSync(resolve(__dirname, "schemas/http-generic-api/http-generic-api.yaml"), "utf8"));
  const expectedPaths = [
    "/local-manager/device-link/start",
    "/local-manager/device-link/preview",
    "/local-manager/device-link/poll",
    "/local-manager/device-link/approve",
    "/local-manager/device-link/devices",
    "/local-manager/device/session",
    "/local-manager/device/controls",
    "/app/local-manager/update/windows",
    "/local-manager/beta/status",
  ];
  const expectedOperationIds = [
    "startLocalManagerDeviceLink",
    "previewLocalManagerDeviceLink",
    "pollLocalManagerDeviceLink",
    "approveLocalManagerDeviceLink",
    "listLocalManagerLinkedDevices",
    "getLocalManagerDeviceSession",
    "getLocalManagerDeviceControls",
    "getLocalManagerWindowsUpdate",
    "getLocalManagerBetaStatus",
  ];
  for (const [docLabel, doc] of [["parent", parentDoc], ["child", childDoc]]) {
    const ops = collectOperations(doc);
    const operationIds = new Set(ops.map((op) => op.operation.operationId).filter(Boolean));
    assert(`${docLabel} schema defines local-manager tag`,
      (doc.tags || []).some((tag) => tag.name === "local-manager"));
    assert(`${docLabel} schema defines localManagerBearerAuth`,
      Boolean(doc.components?.securitySchemes?.localManagerBearerAuth));
    for (const path of expectedPaths) {
      assert(`${docLabel} schema exposes ${path}`, Boolean(doc.paths?.[path]));
    }
    for (const operationId of expectedOperationIds) {
      assert(`${docLabel} schema exposes ${operationId}`, operationIds.has(operationId));
    }
    assert(`${docLabel} preview response is secret-free by contract`,
      Boolean(doc.components?.schemas?.LocalManagerDeviceLinkPreviewResponse) &&
      JSON.stringify(doc.components.schemas.LocalManagerDeviceLinkPublicSession || {}).includes("must not include user_id") &&
      JSON.stringify(doc.components.schemas.LocalManagerDeviceLinkPublicSession || {}).includes("device token"));
    assert(`${docLabel} Windows update response is secret-free`,
      JSON.stringify(doc.components?.schemas?.LocalManagerWindowsUpdateResponse || {}).includes("secrets_included"));
  }

  const adminDispatcher = loadSchema("openapi.custom-gpt.auth-dispatcher.yaml");
  const adminDispatcherPaths = Object.keys(adminDispatcher.paths || {});
  assert("active admin GPT dispatcher does not expose direct Local Manager device-link routes",
    !adminDispatcherPaths.some((path) => path.startsWith("/local-manager/device-link")));
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL CUSTOM GPT SCHEMA TESTS PASS");
