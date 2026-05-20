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
import yaml from "js-yaml";

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
    requiredOperations: ["activateSession", "listTools", "callTool", "writeSessionTurn", "endSession"],
  },
  "openapi.gpt-action.dev-dispatcher.yaml": {
    serverUrl: "https://dev.mad4b.com",
    securityScheme: "backendBearerAuth",
    maxOperations: 10,
    requiredOperations: ["getDevHealth", "getDevDeploymentInfo", "getDevDbStatus"],
  },
  "openapi.gpt-action.local-connector.yaml": {
    serverUrl: "https://connector.mad4b.com",
    securityScheme: "backendBearerAuth",
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
  return yaml.load(readFileSync(resolve(__dirname, file), "utf8"));
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
  assert("tenant dispatcher POST operations are non-consequential",
    tenantPostOps.every((op) => op.operation["x-openai-isConsequential"] === false),
    tenantPostOps.filter((op) => op.operation["x-openai-isConsequential"] !== false).map((op) => op.pathKey).join(", "));

  const devOps = collectOperations(devDoc);
  const devOperationIds = new Set(devOps.map((op) => op.operation.operationId).filter(Boolean));
  assert("dev diagnostics exposes only passive diagnostic operations",
    ["getDevHealth", "getDevDeploymentInfo", "getDevDbStatus"].every((op) => devOperationIds.has(op)) &&
    devOps.every((op) => op.operation["x-openai-isConsequential"] === false));
  assert("parent OpenAPI documents dev diagnostics routes",
    Boolean(parentDoc.paths?.["/deployment-info"]) && Boolean(parentDoc.paths?.["/dev/db/status"]));
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
  const childDoc = yaml.load(readFileSync(resolve(__dirname, "schemas/http-generic-api/http-generic-api.yaml"), "utf8"));
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
