/**
 * test-connect-routes.mjs
 *
 * Fast validation checks for tenant connection onboarding routes.
 * These tests stay before DB/provisioning work so they are deterministic.
 *
 * Run: node test-connect-routes.mjs
 */

import express from "express";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { buildConnectRoutes, _testingSanitizeMetadataPayload, _testingAllowlists } from "./routes/connectRoutes.js";
import { buildConnectApiRoutes } from "./routes/connectApiRoutes.js";
import { buildOnboardingRoutes } from "./routes/onboardingRoutes.js";

const TENANT_SCOPE_LINKS = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];

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

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, text };
  }
}

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

async function getRaw(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    body,
  };
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = {
    mode: "user_jwt",
    user_id: "test-user",
    tenant_id: "test-tenant",
    is_admin: false,
  };
  next();
});

// Regression guard: legacy onboarding is mounted first to prove it cannot shadow /connect.
app.use(buildOnboardingRoutes({}));
app.use(buildConnectRoutes({
  requireBackendApiKey: (_req, _res, next) => next(),
}));

const { server, baseUrl } = await startServer(app);

try {
  section("connect page public assets");

  {
    const result = await getRaw(baseUrl, "/connect/assets/mad4b-logo-1080.png");
    assert("serves raster MAD4B logo asset", result.status === 200, `${result.status}`);
    assert("logo asset is png", result.contentType === "image/png", result.contentType);
    assert("logo asset is cacheable", result.cacheControl.includes("max-age=86400"), result.cacheControl);
    assert("logo asset has png signature", result.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  }

  {
    const result = await getRaw(baseUrl, "/connect");
    assert("connect shell references app bundle", result.status === 200, `${result.status}`);
    const html = result.body.toString("utf8");
    assert("connect shell title matches OAuth app name", html.includes("<title>Growth Intelligence Platform · Connect</title>"));
    assert("connect shell includes exact OAuth app name", html.includes("Growth Intelligence Platform"));
    assert("connect shell is not legacy onboarding page", !html.includes("Mad4B Connector Setup"));
    assert("connect shell links privacy policy", html.includes('href="/privacy-policy"'));
    assert("connect shell links terms of use", html.includes('href="/terms-of-use"'));
  }

  section("auth openapi contract");

  {
    // MCP-style tenant schema: five meta-operations replace all explicit paths.
    // Connect/system operations are now accessed via callTool (discovered through listTools).
    const doc = yaml.load(readFileSync("openapi.tenant-gpt.auth.yaml", "utf8"));
    const exposedPaths = Object.keys(doc.paths || {});
    const securityScheme = doc.components?.securitySchemes?.userBearerAuth;
    const callToolSchema = doc.paths?.["/gpt/tools/call"]?.post?.requestBody?.content?.["application/json"]?.schema;
    const allOperations = exposedPaths.flatMap((pathKey) => {
      const pathItem = doc.paths[pathKey] || {};
      return Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "delete", "patch"].includes(method))
        .map(([method, operation]) => ({ pathKey, method, operation }));
    });
    const postOps = allOperations.filter(({ method }) => method === "post");

    assert("tenant GPT schema uses OAuth action auth", securityScheme?.type === "oauth2", JSON.stringify(securityScheme));
    assert("tenant GPT schema declares authorization code flow", Boolean(securityScheme?.flows?.authorizationCode), JSON.stringify(securityScheme));

    const scopeKeys = Object.keys(securityScheme?.flows?.authorizationCode?.scopes || {});
    assert("tenant GPT schema declares linked tenant scopes", TENANT_SCOPE_LINKS.every((scope) => scopeKeys.includes(scope)), JSON.stringify(scopeKeys));

    // MCP schema: scopes are declared in the flows object; individual operations use userBearerAuth: []
    // (no per-operation scope arrays — authentication is enforced, scope grant is in the OAuth consent)
    assert("tenant GPT schema root security uses userBearerAuth", "userBearerAuth" in (doc.security?.[0] ?? {}), JSON.stringify(doc.security));
    assert("tenant GPT schema all operations require userBearerAuth",
      allOperations.every(({ operation }) => "userBearerAuth" in (operation.security?.[0] ?? {})),
      allOperations.filter(({ operation }) => !("userBearerAuth" in (operation.security?.[0] ?? {}))).map(({ pathKey }) => pathKey).join(", "));

    assert("tenant GPT schema carries action auth preset", doc["x-gpt-action-auth-preset"]?.client_id === "mad4b-tenant-gpt", JSON.stringify(securityScheme));
    assert("tenant GPT schema preset carries scope links", TENANT_SCOPE_LINKS.every((scope) => doc["x-gpt-action-auth-preset"]?.scope_links?.includes(scope)), JSON.stringify(doc["x-gpt-action-auth-preset"]));
    assert("tenant GPT schema hides OAuth plumbing operations", !exposedPaths.some((path) => path.startsWith("/auth/")), exposedPaths.join(", "));

    // MCP meta-operations (connect/system tools are now accessible via callTool)
    assert("tenant GPT schema exposes activateSession", exposedPaths.includes("/activation/session-context"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes listTools", exposedPaths.includes("/gpt/tools"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes callTool", exposedPaths.includes("/gpt/tools/call"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes writeSessionTurn", exposedPaths.includes("/gpt/sessions/{id}/turn"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes endSession", exposedPaths.includes("/gpt/sessions/{id}/end"), exposedPaths.join(", "));

    assert("tenant GPT callTool body requires name", Array.isArray(callToolSchema?.required) && callToolSchema.required.includes("name"));
    assert("tenant GPT all POST operations are non-consequential",
      postOps.every(({ operation }) => operation["x-openai-isConsequential"] === false),
      postOps.filter(({ operation }) => operation["x-openai-isConsequential"] !== false).map(({ pathKey }) => pathKey).join(", "));
    assert("tenant GPT schema does not expose admin provider-bootstrap paths", !exposedPaths.some((p) => p.startsWith("/admin/")), exposedPaths.join(", "));
  }

  section("connect activation validation");

  {
    const result = await post(baseUrl, "/connect/activate", {
      mode: "unsupported",
      n8n_activation_mode: "managed_main_server",
    });
    assert("activate rejects invalid connection mode", result.status === 400, JSON.stringify(result.body));
    assert("invalid connection mode has stable code", result.body?.error?.code === "invalid_mode", JSON.stringify(result.body));
  }

  {
    const result = await post(baseUrl, "/connect/activate", {
      mode: "managed",
      n8n_activation_mode: "desktop",
    });
    assert("activate rejects invalid n8n activation mode", result.status === 400, JSON.stringify(result.body));
    assert("invalid n8n activation mode has stable code", result.body?.error?.code === "invalid_n8n_activation_mode", JSON.stringify(result.body));
  }

  {
    const source = readFileSync("routes/connectRoutes.js", "utf8");
    const policySource = readFileSync("activationModePolicy.js", "utf8");
    assert("connect activation uses centralized activation mode policy",
      source.includes("resolveActivationModePolicy(req.body || {})") &&
      source.includes("activationModeCatalog()") &&
      policySource.includes("CANONICAL_CONNECTION_MODES") &&
      policySource.includes("managed") &&
      policySource.includes("dedicated"));
    assert("activation mode policy normalizes aliases for MCP/GPT wrappers",
      policySource.includes("connection_mode") &&
      policySource.includes("activation_mode") &&
      policySource.includes("service_mode") &&
      policySource.includes("tenant_activation_mode"));
    assert("dedicated mode defaults to local n8n and tenant-owned provisioning",
      policySource.includes("self_hosted_local") &&
      policySource.includes("tenant_owned_user_app_connections"));
  }

  {
    const routeSource = readFileSync("routes/connectRoutes.js", "utf8");
    const apiSource = readFileSync("routes/connectApiRoutes.js", "utf8");
    const dedicatedSource = readFileSync("dedicatedIntegrationPolicy.js", "utf8");
    const migrationSource = readFileSync("migrations/105_sprint64_dedicated_integration_flow.sql", "utf8");
    assert("dedicated mode exposes integration readiness in status and capabilities",
      routeSource.includes("dedicated_integration_readiness") &&
      routeSource.includes("dedicatedIntegrationCatalog()") &&
      dedicatedSource.includes("DEDICATED_REQUIRED_INTEGRATIONS"));
    assert("dedicated install blocks before provisioning when required integrations are missing",
      routeSource.includes("dedicated_integrations_required") &&
      routeSource.includes("assessDedicatedIntegrationReadiness") &&
      routeSource.indexOf("dedicated_integrations_required") < routeSource.indexOf("provisionLocalConnectorInstall(req"));
    assert("dedicated policy requires tenant-owned Cloudflare and Hostinger connections",
      dedicatedSource.includes('app_key: "cloudflare"') &&
      dedicatedSource.includes('app_key: "hostinger"') &&
      dedicatedSource.includes("user_app_connections") &&
      dedicatedSource.includes("secret_handling"));
    assert("connect API can create user-scoped credential intake sessions without chat secrets",
      apiSource.includes('router.post("/connect/api/credential-intake/sessions"') &&
      apiSource.includes("secret_exposed: false") &&
      apiSource.includes("req.auth.user_id") &&
      apiSource.includes("req.auth.tenant_id"));
    assert("tenant tool registry exposes dedicated app integration tools",
      migrationSource.includes("connect_app_integrations_list") &&
      migrationSource.includes("connect_credential_intake_create") &&
      migrationSource.includes("connect_app_connections_list") &&
      migrationSource.includes("connect_app_connection_revoke"));
  }

  section("connect tenantless onboarding recovery");

  {
    const routeSource = readFileSync("routes/connectRoutes.js", "utf8");
    const authSource = readFileSync("routes/authRoutes.js", "utf8");
    const appSource = readFileSync("public/connect/app.jsx", "utf8");
    const stepSource = readFileSync("public/connect/steps-1.jsx", "utf8");
    const indexSource = readFileSync("routes/index.js", "utf8");
    assert("connect exposes explicit onboarding-state route",
      routeSource.includes('router.get("/connect/onboarding-state"') && routeSource.includes('workspace_required'));
    assert("connect exposes tenantless-safe workspace creation and escalation routes",
      routeSource.includes('router.post("/connect/workspace"') &&
      routeSource.includes('router.post("/connect/escalate"') &&
      routeSource.includes('onboarding_escalations'));
    assert("connect exposes minimal /me workspace/capability control-plane",
      routeSource.includes('router.get("/me"') &&
      routeSource.includes('router.get("/me/workspaces"') &&
      routeSource.includes('router.post("/me/workspaces"') &&
      routeSource.includes('router.get("/me/capabilities"'));
    assert("connect UI routes signed-in no-tenant users to tenant step instead of blank hub",
      appSource.includes("setStep(hasTenant ? 'hub' : 'tenant')") &&
      appSource.includes("CreateWorkspacePanel") &&
      appSource.includes("/connect/workspace"));
    assert("email signup passes tenant_display_name through UI",
      appSource.includes("tenant_display_name") && stepSource.includes("tenant_display_name: tenantName"));
    assert("Google auth repairs existing users with no workspace",
      authSource.includes("ensureDefaultWorkspaceForUser") &&
      authSource.includes("google_existing_user_workspace_repair"));
    assert("admin onboarding recovery routes are imported and mounted",
      indexSource.includes("buildAdminOnboardingRoutes") &&
      indexSource.includes("./adminOnboardingRoutes.js") &&
      indexSource.includes("buildAdminOnboardingRoutes({ ...deps, requireAdminPrincipal })"));
  }

  section("device install validation");

  {
    const result = await post(baseUrl, "/connect/device-install", {});
    assert("device install rejects missing device_id", result.status === 400, JSON.stringify(result.body));
    assert("missing device_id has stable code", result.body?.error?.code === "invalid_device_id", JSON.stringify(result.body));
  }

  {
    const result = await post(baseUrl, "/connect/device-install", {
      device_id: "../bad",
    });
    assert("device install rejects unsafe device_id", result.status === 400, JSON.stringify(result.body));
    assert("unsafe device_id has stable code", result.body?.error?.code === "invalid_device_id", JSON.stringify(result.body));
  }
} finally {
  server.close();
}

section("connect api auth scope");

{
  const scopedApp = express();
  scopedApp.use(express.json());
  scopedApp.use(buildConnectApiRoutes());
  scopedApp.get("/gpt/tools", (_req, res) => res.json({ ok: true, reached: "gpt-tools" }));
  const scoped = await startServer(scopedApp);
  try {
    const connectResponse = await fetch(`${scoped.baseUrl}/connect/api/app-integrations`);
    const connectBody = await readJson(connectResponse);
    assert("connect api still requires user JWT", connectResponse.status === 401, JSON.stringify(connectBody));
    assert("connect api missing JWT code is stable", connectBody?.error?.code === "user_jwt_required", JSON.stringify(connectBody));

    const toolsResponse = await fetch(`${scoped.baseUrl}/gpt/tools`);
    const toolsBody = await readJson(toolsResponse);
    assert("connect api middleware does not shadow GPT tools", toolsResponse.status === 200, JSON.stringify(toolsBody));
    assert("GPT tools fallthrough reaches next router", toolsBody?.reached === "gpt-tools", JSON.stringify(toolsBody));
  } finally {
    scoped.server.close();
  }
}

  section("local connector GPT action schema");

  {
    const doc = yaml.load(readFileSync("openapi.gpt-action.local-connector.yaml", "utf8"));
    const exposedPaths = Object.keys(doc.paths || {});
    const allOperations = exposedPaths.flatMap((pathKey) => {
      const pathItem = doc.paths[pathKey] || {};
      return Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "delete", "patch"].includes(method))
        .map(([method, operation]) => ({ pathKey, method, operation }));
    });
    const postOps = allOperations.filter(({ method }) => method === "post");
    const securityScheme = doc.components?.securitySchemes?.backendBearerAuth;

    assert("local connector schema uses OpenAPI 3.1", doc.openapi === "3.1.0", doc.openapi);
    assert("local connector schema has connector.mad4b.com server", doc.servers?.[0]?.url === "https://connector.mad4b.com", doc.servers?.[0]?.url);
    assert("local connector schema uses backendBearerAuth", securityScheme?.type === "http" && securityScheme?.scheme === "bearer");
    assert("local connector schema has root security", "backendBearerAuth" in (doc.security?.[0] ?? {}));

    assert("local connector schema exposes /health", exposedPaths.includes("/health"));
    assert("local connector schema exposes /github", exposedPaths.includes("/github"));
    assert("local connector schema exposes /gcloud", exposedPaths.includes("/gcloud"));
    assert("local connector schema exposes /dependencies", exposedPaths.includes("/dependencies"));
    assert("local connector schema exposes /apps", exposedPaths.includes("/apps"));
    assert("local connector schema exposes /browser", exposedPaths.includes("/browser"));
    assert("local connector schema exposes /shell", exposedPaths.includes("/shell"));
    assert("local connector schema exposes /files", exposedPaths.includes("/files"));
    assert("local connector schema exposes /fetch-upload", exposedPaths.includes("/fetch-upload"));
    assert("local connector schema exposes /shell-fetch-upload", exposedPaths.includes("/shell-fetch-upload"));

    assert("local connector /health has no auth (security: [])",
      Array.isArray(doc.paths["/health"]?.get?.security) && doc.paths["/health"].get.security.length === 0);

    assert("local connector all POST operations are non-consequential",
      postOps.every(({ operation }) => operation["x-openai-isConsequential"] === false),
      postOps.filter(({ operation }) => operation["x-openai-isConsequential"] !== false).map(({ pathKey }) => pathKey).join(", "));

    const MAX_DESC = 300;
    function collectLongDescs(node, path = "$") {
      if (!node || typeof node !== "object") return [];
      const out = [];
      if (typeof node.description === "string" && node.description.length > MAX_DESC)
        out.push(`${path}:${node.description.length}`);
      for (const [k, v] of Object.entries(node)) out.push(...collectLongDescs(v, `${path}.${k}`));
      return out;
    }
    const longDescs = collectLongDescs(doc);
    assert("local connector all descriptions are <= 300 chars", longDescs.length === 0, longDescs.join(", "));

    const shellCallSchema = doc.paths?.["/shell"]?.post?.requestBody?.content?.["application/json"]?.schema;
    assert("local connector /shell requires action field",
      Array.isArray(shellCallSchema?.required) && shellCallSchema.required.includes("action"));

    const filesSchema = doc.paths?.["/files"]?.post?.requestBody?.content?.["application/json"]?.schema;
    assert("local connector /files supports bounded directory listing",
      Boolean(filesSchema?.properties?.max_entries) && Boolean(doc.paths?.["/files"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.entries));
    assert("local connector /files supports bounded repo location discovery",
      filesSchema?.properties?.action?.enum?.includes("list_drives") &&
      filesSchema?.properties?.action?.enum?.includes("locate_repo") &&
      Boolean(doc.paths?.["/files"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.candidates));

    const dependenciesSchema = doc.paths?.["/dependencies"]?.post?.requestBody?.content?.["application/json"]?.schema;
    assert("local connector /dependencies supports allowlisted recovery installs",
      dependenciesSchema?.properties?.action?.enum?.includes("install") &&
      dependenciesSchema?.properties?.package_key?.enum?.includes("gh") &&
      dependenciesSchema?.properties?.package_key?.enum?.includes("googlecloudsdk"));

    const appsSchema = doc.paths?.["/apps"]?.post?.requestBody?.content?.["application/json"]?.schema;
    const appsResponseSchema = doc.paths?.["/apps"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert("local connector /apps supports allowlisted app aliases",
      appsSchema?.properties?.action?.enum?.includes("launch") &&
      appsSchema?.properties?.action?.enum?.includes("status_app") &&
      Boolean(appsSchema?.properties?.app_alias));
    assert("local connector /apps exposes classification metadata",
      Boolean(appsResponseSchema?.properties?.classification?.properties?.capability_class) &&
      Boolean(appsResponseSchema?.properties?.classification?.properties?.risk_class));

    const browserSchema = doc.paths?.["/browser"]?.post?.requestBody?.content?.["application/json"]?.schema;
    const browserResponseSchema = doc.paths?.["/browser"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert("local connector /browser supports allowlisted browser open_url",
      browserSchema?.properties?.action?.enum?.includes("open_url") &&
      Boolean(browserSchema?.properties?.browser_alias) &&
      Boolean(browserSchema?.properties?.url));
    assert("local connector /browser exposes classification metadata",
      Boolean(browserResponseSchema?.properties?.classification?.properties?.capability_class) &&
      Boolean(browserResponseSchema?.properties?.classification?.properties?.allowed_url_schemes));

    const uploadPaths = ["/fetch-upload", "/shell-fetch-upload"];
    for (const p of uploadPaths) {
      const s = doc.paths?.[p]?.post?.requestBody?.content?.["application/json"]?.schema;
      assert(`local connector ${p} requires url and upload_type`,
        Array.isArray(s?.required) && s.required.includes("url") && s.required.includes("upload_type"));
    }
  }

// ── sanitizeMetadataPayload guarantees for /connect/preferences and /connect/profile ─────
  section("auth-host connector proxy schema");

  {
    const doc = yaml.load(readFileSync("openapi.yaml", "utf8"));
    const proxyPaths = Object.keys(doc.paths || {}).filter((pathKey) => pathKey.startsWith("/connector/{device_id}/"));
    for (const pathKey of ["/connector/{device_id}/dependencies", "/connector/{device_id}/apps", "/connector/{device_id}/browser", "/connector/{device_id}/ps", "/connector/{device_id}/win", "/connector/{device_id}/n8n", "/connector/{device_id}/cf"]) {
      assert(`auth-host schema exposes ${pathKey}`, proxyPaths.includes(pathKey), proxyPaths.join(", "));
    }
    assert("auth-host ps proxy requires script",
      doc.paths?.["/connector/{device_id}/ps"]?.post?.requestBody?.content?.["application/json"]?.schema?.required?.includes("script"));
    assert("auth-host win proxy exposes workaround actions",
      doc.paths?.["/connector/{device_id}/win"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.action?.enum?.includes("service_action"));
    assert("auth-host cf proxy exposes tunnel_status",
      doc.paths?.["/connector/{device_id}/cf"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.action?.enum?.includes("tunnel_status"));

    const browserScale = doc.paths?.["/connector/{device_id}/browser"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.scale;
    assert("auth-host browser scale stays in fraction units (0.1..1.0)",
      browserScale?.type === "number" && browserScale?.minimum === 0.1 && browserScale?.maximum === 1.0);
  }

  section("deployment info evidence fields");

  {
    const source = readFileSync("routes/deploymentInfoRoutes.js", "utf8");
    assert("deployment info exposes branch and branch_source",
      source.includes("branch_source") && source.includes("dev_hostname_fallback"));
    assert("deployment info exposes commit and commit_sha aliases",
      source.includes("commit_sha: commitSha") && source.includes("commit_source"));
    assert("deployment info does not fabricate commit sha fallback",
      source.includes('return "unavailable"') && source.includes("process.env.GITHUB_SHA"));
    assert("deployment info can derive commit from git checkout when env metadata is absent",
      source.includes("readGitCheckoutInfo") &&
      source.includes("git_checkout") &&
      source.includes("git_packed_refs") &&
      source.includes("git_ref_file"));
    assert("deployment info exposes deployed_at provenance and availability evidence",
      source.includes("deployed_at: deployedAt") &&
      source.includes("deployed_at_source") &&
      source.includes("deployed_at_available") &&
      source.includes("git_head_mtime"));
    assert("deployment info sanitizes deployment manifest path details",
      source.includes("sanitizeDeploymentManifest") &&
      source.includes("delete safe._source_file") &&
      source.includes("source_file_detected") &&
      source.includes("secrets_included: false"));
  }

  section("connector agent heartbeat writeback");

  {
    const source = readFileSync("routes/connectorAgentRoutes.js", "utf8");
    assert("connector agent exposes version endpoint",
      source.includes('router.get("/connector-agent/version"') && source.includes("has_n8n_lifecycle"));
    assert("connector agent ships DB restore certifier probe without enabling broad PowerShell",
      source.includes('"db-restore-certifier.mjs"') &&
      source.includes("db_restore_certify_probe") &&
      source.includes("Read-only DB restore certification prerequisite probe") &&
      !source.includes("CONNECTOR_POWERSHELL_ENABLED=true"));
    assert("connector agent ships n8n restore certifier probe without enabling broad PowerShell",
      source.includes('"n8n-restore-certifier.mjs"') &&
      source.includes("n8n_restore_certify_probe") &&
      source.includes("Read-only n8n restore certification prerequisite probe") &&
      !source.includes("CONNECTOR_POWERSHELL_ENABLED=true"));
    assert("connector agent exposes heartbeat endpoint",
      source.includes('router.post("/connector-agent/heartbeat"'));
    assert("connector heartbeat writes recovery events and config metadata",
      source.includes("local_connector_recovery_events") &&
      source.includes("last_health_at = NOW()") &&
      source.includes("watchdog_version") &&
      source.includes("last_repair_status"));
    assert("connector heartbeat strips secret-like metadata",
      source.includes("safeJsonObject") &&
      source.includes("authorization") &&
      source.includes("secret"));
  }

  section("local connector install route refactor");

  {
    const source = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
    assert("local connector install effective route calls shared provisioning helper",
      source.includes('router.post("/local-connector/install"') &&
      source.includes("provisionLocalConnectorInstall(req, req.body || {})") &&
      source.includes("shared provisioning helper"));
  }

  section("local manager beta read-only surface");

  {
    const indexSource = readFileSync("routes/index.js", "utf8");
    const betaSource = readFileSync("routes/localManagerBetaRoutes.js", "utf8");
    const authSource = readFileSync("routes/authRoutes.js", "utf8");
    assert("local manager beta routes are imported and mounted",
      indexSource.includes("buildLocalManagerBetaRoutes") &&
      indexSource.includes("./localManagerBetaRoutes.js") &&
      indexSource.includes("buildLocalManagerBetaRoutes({ ...deps, requireAdminPrincipal })"));
    assert("local manager beta and installer routes mount before protected local connector and device-tool routes",
      indexSource.indexOf("buildLocalManagerBetaRoutes({ ...deps, requireAdminPrincipal })") < indexSource.indexOf("buildLocalConnectorInstallRoutes(deps)") &&
      indexSource.indexOf("buildLocalConnectorInstallRoutes(deps)") < indexSource.indexOf("buildLocalConnectorRoutes(deps)") &&
      indexSource.indexOf("buildLocalConnectorInstallRoutes(deps)") < indexSource.indexOf("buildDeviceToolsRoutes(deps)"));
    assert("local manager public app, Windows EXE download, update metadata, auth/control pages, device-code APIs, admin bridge, beta page, and protected status API are exposed",
      betaSource.includes('router.get("/app/local-manager"') &&
      betaSource.includes('router.get("/app/local-manager/download/windows"') &&
      betaSource.includes('router.get("/app/local-manager/update/windows"') &&
      betaSource.includes('router.get("/app/local-manager/sign-in"') &&
      betaSource.includes('router.get("/app/local-manager/sign-up"') &&
      betaSource.includes('router.get("/app/local-manager/link-device"') &&
      betaSource.includes('router.get("/app/local-manager/devices"') &&
      betaSource.includes('router.get("/app/local-manager/routes"') &&
      betaSource.includes('router.get("/app/local-manager/backups"') &&
      betaSource.includes('router.get("/app/local-manager/settings"') &&
      betaSource.includes('router.post("/local-manager/device-link/start"') &&
      betaSource.includes('router.get("/local-manager/device-link/preview"') &&
      betaSource.includes('router.post("/local-manager/device-link/poll"') &&
      betaSource.includes('router.post("/local-manager/device-link/approve"') &&
      betaSource.includes('router.get("/local-manager/device-link/devices"') &&
      betaSource.includes('router.get("/local-manager/device/session"') &&
      betaSource.includes('router.get("/local-manager/device/controls"') &&
      betaSource.includes('router.get("/app/local-manager/admin"') &&
      betaSource.includes('router.get("/local-manager/beta"') &&
      betaSource.includes('router.get("/local-manager/beta/status", requireBackendApiKey, requireAdminPrincipal'));
    assert("local manager public app is true public UX while admin bridge holds token installer flow",
      betaSource.includes("Download, sign in, and link this device") &&
      betaSource.includes("No token fields here") &&
      betaSource.includes("Download for Windows (.exe)") &&
      betaSource.includes("function localManagerAdminPage") &&
      betaSource.includes("<YOUR_PLATFORM_TOKEN>") &&
      !betaSource.includes("BACKEND_API_KEY"));
    assert("local manager auth pages use dedicated device approval flow with Google and forgot-password controls",
      betaSource.includes("Open device approval") &&
      betaSource.includes("/app/local-manager/link-device?mode=signin") &&
      betaSource.includes("/app/local-manager/link-device?mode=signup") &&
      betaSource.includes("approveDevice") &&
      betaSource.includes("loadPreview") &&
      betaSource.includes("setupGoogle") &&
      betaSource.includes("/auth/google") &&
      betaSource.includes("localStorage.setItem('mlm_user_token'") &&
      betaSource.includes("localStorage.getItem('mlm_user_token'") &&
      betaSource.includes("Loading linked devices") &&
      betaSource.includes("initializeLinkDevicePage") &&
      betaSource.includes("Checking this device link") &&
      betaSource.includes("already linked") &&
      betaSource.includes("forgotPassword") &&
      betaSource.includes("/auth/password/forgot") &&
      !betaSource.includes("Open /connect sign-in"));
    assert("platform auth exposes password reset request and reset routes",
      authSource.includes('router.post("/password/forgot"') &&
      authSource.includes('router.get("/password/reset"') &&
      authSource.includes('router.post("/password/reset"') &&
      authSource.includes("auth_password_reset_tokens") &&
      authSource.includes("auth_email_outbox"));
    assert("local manager Windows update metadata is secret-free and DB-backed",
      betaSource.includes("LOCAL_MANAGER_WINDOWS_LATEST_VERSION") &&
      betaSource.includes("localManagerWindowsUpdateInfo") &&
      betaSource.includes("local_app_releases") &&
      betaSource.includes("registry_source") &&
      betaSource.includes("update_available") &&
      betaSource.includes("secrets_included: false"));
    assert("local manager update comparison normalizes prerelease and build metadata",
      betaSource.includes("raw.split(/[+-]/)[0]") &&
      betaSource.includes("latestLocalManagerWindowsRelease"));
    const releaseMigrationSource = readFileSync("migrations/100_sprint62k_local_app_releases.sql", "utf8");
    assert("local app releases migration seeds Local Manager Windows release",
      releaseMigrationSource.includes("CREATE TABLE IF NOT EXISTS `local_app_releases`") &&
      releaseMigrationSource.includes("mad4b-local-manager") &&
      releaseMigrationSource.includes("latest-prerelease") &&
      releaseMigrationSource.includes("Mad4B-Local-Manager-Setup.exe"));
    const deviceLinkSource = readFileSync("services/localManagerDeviceLinkService.js", "utf8");
    assert("local manager Windows default download redirects to public EXE release asset",
      betaSource.includes("Mad4B-Local-Manager-Setup.exe") &&
      betaSource.includes("releases/download/local-manager-windows-latest") &&
      !betaSource.includes("Mad4B-Local-Manager-Windows-Bootstrap.ps1") &&
      !betaSource.includes("connector_secret") &&
      !betaSource.includes("cf_token"));
    assert("local manager device-code service stores only hashed poll/display tokens and emits device-scoped token after approval",
      deviceLinkSource.includes("display_code_hash") &&
      deviceLinkSource.includes("poll_token_hash") &&
      deviceLinkSource.includes("device_access_token") &&
      deviceLinkSource.includes("local_manager_device_access") &&
      deviceLinkSource.includes("requireLocalManagerUser") &&
      deviceLinkSource.includes("requireLocalManagerDevice") &&
      deviceLinkSource.includes("getDeviceControls") &&
      deviceLinkSource.includes("already_linked") &&
      deviceLinkSource.includes("reauthorized_existing_device") &&
      !deviceLinkSource.includes("connector_secret") &&
      !deviceLinkSource.includes("cf_token"));
    assert("local manager beta is read-only and redacts secrets",
      betaSource.includes("read_only: true") &&
      betaSource.includes("secrets_included: false") &&
      betaSource.includes("Repair execution is not enabled in beta") &&
      betaSource.includes("redactUrl"));
    assert("local manager beta reads routes and recovery events without raw secrets",
      betaSource.includes("local_connector_device_routes") &&
      betaSource.includes("local_connector_recovery_events") &&
      !betaSource.includes("connector_secret"));
  }

  section("device-tools route mounting");

  {
    const indexSource = readFileSync("routes/index.js", "utf8");
    assert("device-tools routes imported in routes/index.js",
      indexSource.includes("buildDeviceToolsRoutes") && indexSource.includes("./deviceToolsRoutes.js"));
    assert("device-tools routes mounted via app.use",
      /app\.use\(buildDeviceToolsRoutes\(/.test(indexSource));
  }

  section("local gateway route mounting");

  {
    const indexSource = readFileSync("routes/index.js", "utf8");
    const gatewayImportMatches = indexSource.match(/buildLocalGatewayToolsRoutes/g) || [];
    assert("local gateway route builder appears exactly twice (import + mount)",
      gatewayImportMatches.length === 2, `found ${gatewayImportMatches.length}`);
    assert("local gateway routes imported in routes/index.js",
      indexSource.includes("buildLocalGatewayToolsRoutes") && indexSource.includes("./localGatewayToolsRoutes.js"));
    assert("local gateway routes mounted via app.use",
      /app\.use\(buildLocalGatewayToolsRoutes\(deps\)\)/.test(indexSource));
  }

  section("installer reprovision smoke and sanitized status");

  {
    const routeSource = readFileSync("routes/localConnectorInstallRoutes.js", "utf8");
    const scriptSource = readFileSync("scripts/installer-reprovision-smoke.mjs", "utf8");
    const packageSource = readFileSync("package.json", "utf8");
    assert("install status response is read-only and explicitly non-secret",
      routeSource.includes("read_only: true") &&
      routeSource.includes("secrets_included: false") &&
      routeSource.includes("download_link_available") &&
      routeSource.includes("reprovision_requires_explicit_flag"));
    assert("install status excludes raw secret columns and installer bodies from aliases",
      routeSource.includes("SELECT alias, allow_extra_args, description") &&
      routeSource.includes("aliases.map") &&
      !routeSource.includes("return res.status(200).json({ ok: true, installed: true, config, aliases"));
    assert("installer reprovision smoke is dry-run and checks negative cases",
      scriptSource.includes("dry_run: true") &&
      scriptSource.includes("writes_attempted: false") &&
      scriptSource.includes("invalid installer download token is rejected") &&
      scriptSource.includes("install endpoint rejects empty body before provisioning side effects"));
    assert("installer reprovision smoke has npm entry",
      packageSource.includes('"smoke:installer-reprovision": "node scripts/installer-reprovision-smoke.mjs"'));
  }

  section("route selector runtime smoke coverage");

  {
    const scriptSource = readFileSync("scripts/route-selector-runtime-smoke.mjs", "utf8");
    const packageSource = readFileSync("package.json", "utf8");
    assert("route selector smoke script covers all registered route types",
      scriptSource.includes("vpn_private_ip") &&
      scriptSource.includes("lan_private_ip") &&
      scriptSource.includes("direct_public_ip") &&
      scriptSource.includes("dynamic_public_ip") &&
      scriptSource.includes("cloudflare_tunnel") &&
      scriptSource.includes("admin_recovery"));
    assert("route selector smoke is dry-run and non-secret by default",
      scriptSource.includes("dry_run: true") &&
      scriptSource.includes("writes_attempted: false") &&
      scriptSource.includes("secrets_included: false"));
    assert("route selector smoke has npm entry",
      packageSource.includes('"smoke:route-selector": "node scripts/route-selector-runtime-smoke.mjs"'));
  }

  section("auth-host connector proxy admin-only enforcement");

  {
    const source = readFileSync("routes/connectorProxyRoutes.js", "utf8");
    for (const workaround of ["/connector/:device_id/ps", "/connector/:device_id/win", "/connector/:device_id/cf"]) {
      const routePattern = new RegExp(`router\\.post\\("${workaround.replace(/[/]/g, "\\/").replace(/:/g, ":")}",[^)]*adminOnly`);
      assert(`workaround route ${workaround} requires adminOnly guard`, routePattern.test(source), `missing adminOnly on ${workaround}`);
    }
    for (const tenantSafe of ["/connector/:device_id/files", "/connector/:device_id/apps", "/connector/:device_id/browser", "/connector/:device_id/dependencies", "/connector/:device_id/n8n"]) {
      const routePattern = new RegExp(`router\\.post\\("${tenantSafe.replace(/[/]/g, "\\/").replace(/:/g, ":")}",[^)]*adminOnly`);
      assert(`tenant-safe route ${tenantSafe} stays open to user JWT (no adminOnly)`, !routePattern.test(source));
    }
    assert("auth connector proxy can fall back from connector_secret to BACKEND_API_KEY",
      source.includes("uniqueTruthy([device.connector_secret, process.env.BACKEND_API_KEY])") &&
      source.includes("connector_auth_failed"));
    assert("auth connector proxy lets admin resolve device_id without user_id",
      source.includes("Admin/service callers may address a governed device by device_id alone") &&
      source.includes("WHERE device_id = ? AND is_enabled = 1"));
    assert("auth connector proxy strips admin user_id before forwarding to the device",
      source.includes("delete forwardedQuery.user_id") && source.includes("delete forwardedBody.user_id"));
    assert("auth connector proxy reads registered device routes before legacy tunnel fallback",
      source.includes("local_connector_device_routes") &&
      source.includes("listCandidateRoutes") &&
      source.includes("legacy_config"));
    assert("auth connector proxy route selector prefers healthy or unknown routes",
      source.includes("health_status IN ('healthy','unknown')") &&
      source.includes("ORDER BY priority ASC"));
    assert("auth connector proxy writes route health metadata",
      source.includes("last_success_at = NOW()") &&
      source.includes("last_failure_at = NOW()") &&
      source.includes("connector_all_routes_failed"));
  }

{
  const { PREFERENCES_FIELD_ALLOWLIST, BUSINESS_PROFILE_FIELD_ALLOWLIST, PROFILE_MAX_BYTES } = _testingAllowlists;

  // 1) tenant_id and user_id from body are always dropped (auth-derived only)
  {
    const { sanitized, dropped } = _testingSanitizeMetadataPayload({
      tenant_id: "spoofed",
      user_id: "spoofed-user",
      tz: "UTC",
    }, PREFERENCES_FIELD_ALLOWLIST);
    assert("sanitizer drops body tenant_id", !("tenant_id" in sanitized) && dropped.includes("tenant_id"));
    assert("sanitizer drops body user_id", !("user_id" in sanitized) && dropped.includes("user_id"));
    assert("sanitizer keeps allowlisted tz", sanitized.tz === "UTC");
  }

  // 2) Sensitive-named keys are stripped even if the frontend regresses
  {
    const { sanitized, dropped } = _testingSanitizeMetadataPayload({
      bizType: "Service",
      industry: "Hospitality",
      cmsKey: "wp_app_password_value",
      api_key: "secret_value",
      password: "secret_value",
      access_token: "secret_value",
      client_secret: "secret_value",
      encrypted_credentials: "should_not_pass",
    }, BUSINESS_PROFILE_FIELD_ALLOWLIST);
    for (const key of ["cmsKey", "api_key", "password", "access_token", "client_secret", "encrypted_credentials"]) {
      assert(`sanitizer strips ${key}`, !(key in sanitized) && dropped.includes(key));
    }
    assert("sanitizer keeps bizType", sanitized.bizType === "Service");
    assert("sanitizer keeps industry", sanitized.industry === "Hospitality");
  }

  // 3) Allowlist drops unrecognized fields silently
  {
    const { sanitized, dropped } = _testingSanitizeMetadataPayload({
      tz: "UTC",
      unknown_field: "drop_me",
      another_unknown: { nested: true },
    }, PREFERENCES_FIELD_ALLOWLIST);
    assert("sanitizer drops unknown_field", !("unknown_field" in sanitized) && dropped.includes("unknown_field"));
    assert("sanitizer drops another_unknown", !("another_unknown" in sanitized) && dropped.includes("another_unknown"));
    assert("sanitizer keeps allowlisted tz", sanitized.tz === "UTC");
  }

  // 4) PROFILE_MAX_BYTES is bounded
  assert("PROFILE_MAX_BYTES is positive and bounded", PROFILE_MAX_BYTES > 0 && PROFILE_MAX_BYTES <= 1_000_000);

  // 5) Non-object body becomes empty sanitized payload, not a crash
  {
    const { sanitized: a } = _testingSanitizeMetadataPayload(null, PREFERENCES_FIELD_ALLOWLIST);
    const { sanitized: b } = _testingSanitizeMetadataPayload("string body", PREFERENCES_FIELD_ALLOWLIST);
    const { sanitized: c } = _testingSanitizeMetadataPayload([1, 2, 3], PREFERENCES_FIELD_ALLOWLIST);
    assert("sanitizer handles null body", Object.keys(a).length === 0);
    assert("sanitizer handles string body", Object.keys(b).length === 0);
    assert("sanitizer handles array body", Object.keys(c).length === 0);
  }

  // 6) Case-insensitive secret match: CMSKEY and ClientSecret are also blocked
  {
    const { sanitized, dropped } = _testingSanitizeMetadataPayload({
      bizType: "Service",
      CMSKEY: "value",
      ClientSecret: "value",
    }, BUSINESS_PROFILE_FIELD_ALLOWLIST);
    assert("sanitizer strips CMSKEY (case-insensitive)", !("CMSKEY" in sanitized) && dropped.includes("CMSKEY"));
    assert("sanitizer strips ClientSecret (case-insensitive)", !("ClientSecret" in sanitized) && dropped.includes("ClientSecret"));
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL CONNECT ROUTE TESTS PASS");
