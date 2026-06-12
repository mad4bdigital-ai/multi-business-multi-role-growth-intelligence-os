#!/usr/bin/env node
import { readFileSync } from "node:fs";

const repoRoot = new URL("../", import.meta.url);

function readRepoFile(relativePath) {
  return readFileSync(new URL(relativePath, repoRoot), "utf8");
}

function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle);
  if (start < 0) return "";
  const end = endNeedle ? text.indexOf(endNeedle, start + startNeedle.length) : -1;
  return text.slice(start, end > start ? end : undefined);
}

function assertIncludes(haystack, needle, ruleId) {
  if (!haystack.includes(needle)) {
    throw new Error(`${ruleId}: expected to find ${needle}`);
  }
}

function assertNotIncludes(haystack, needle, ruleId) {
  if (haystack.includes(needle)) {
    throw new Error(`${ruleId}: forbidden token present: ${needle}`);
  }
}

function runRules(rules) {
  const passed = [];
  for (const rule of rules) {
    rule.check();
    passed.push(rule.id);
  }
  return passed;
}

export function runAutomationIntelligenceGuard() {
  const systemLayerRoutes = readRepoFile("routes/systemLayerRoutes.js");
  const gptToolsRoutes = readRepoFile("routes/gptToolsRoutes.js");
  const localConnectorInstallRoutes = readRepoFile("routes/localConnectorInstallRoutes.js");
  const connectApiRoutes = readRepoFile("routes/connectApiRoutes.js");
  const hybridIntegrationPolicy = readRepoFile("hybridIntegrationPolicy.js");
  const tenantToolSurfaceTest = readRepoFile("test-tenant-tool-surface-guard.mjs");

  const runtimeEndpointCallBlock = sliceBetween(
    systemLayerRoutes,
    'name: "runtime_endpoint_call"',
    'name: "google_drive_endpoint_catalog"'
  );

  const systemPlatformEndpointExportBlock = sliceBetween(
    systemLayerRoutes,
    "async function listPlatformEndpointToolsForPrincipal",
    "function isTenantRegistryToolAllowedInSystemFacade"
  );

  const systemPlatformEndpointDispatchBlock = sliceBetween(
    systemLayerRoutes,
    "async function callPlatformEndpointToolIfAvailable",
    "async function callTenantEndpointRegistryToolIfAvailable"
  );

  const tenantToolDiscoveryBlock = sliceBetween(
    gptToolsRoutes,
    "async function fetchTools(callerType)",
    "async function detectMissingRequiredArgs"
  );

  const tenantToolDispatchBlock = sliceBetween(
    gptToolsRoutes,
    "async function dispatchToolImpl",
    "function fillPathTemplate"
  );

  const rules = [
    {
      id: "P0-runtime-endpoint-call-hidden-from-tenant-discovery",
      check: () => {
        assertIncludes(runtimeEndpointCallBlock, "requires_admin: true", "runtime_endpoint_call must be admin-only");
        assertIncludes(systemLayerRoutes, "const ADMIN_ONLY_SYSTEM_TOOLS", "admin-only tool registry must exist");
      },
    },
    {
      id: "P0-platform-endpoint-exports-block-tenant-mutations",
      check: () => {
        assertIncludes(systemLayerRoutes, "TENANT_MUTATION_ENDPOINT_METHODS", "tenant mutation method set must exist");
        assertIncludes(systemLayerRoutes, "isTenantPlatformEndpointExportAllowed", "tenant platform endpoint allow helper must exist");
        assertIncludes(systemPlatformEndpointExportBlock, ".filter((row) => isTenantPlatformEndpointExportAllowed(row, auth))", "tenant platform endpoint discovery must filter mutating methods");
        assertIncludes(systemPlatformEndpointDispatchBlock, "tenant_platform_endpoint_mutation_not_allowed", "tenant platform endpoint dispatch must enforce mutation block");
      },
    },
    {
      id: "P0-tenant-tool-discovery-blocks-mutating-and-high-risk-tools",
      check: () => {
        assertIncludes(gptToolsRoutes, "TENANT_MUTATION_TOOL_METHODS", "tenant tool mutating method set must exist");
        assertIncludes(gptToolsRoutes, "TENANT_HIGH_RISK_TOOL_NAME_PATTERNS", "tenant high-risk tool patterns must exist");
        assertIncludes(gptToolsRoutes, "function isTenantToolVisible", "tenant tool visibility helper must exist");
        assertIncludes(tenantToolDiscoveryBlock, "rows.filter((r) => isTenantToolVisible(r))", "tenant listTools must use unified visibility guard");
        assertIncludes(tenantToolDispatchBlock, "!isTenantToolVisible({ tool_key: toolKey, http_method: method, http_path: pathTemplate })", "tenant tool dispatch must use unified visibility guard");
        assertIncludes(tenantToolDispatchBlock, "tenant_tool_route_not_allowed", "tenant tool dispatch must use stable rejection code");
      },
    },
    {
      id: "P1-guard-tests-track-runtime-contract",
      check: () => {
        assertIncludes(tenantToolSurfaceTest, "TENANT_MUTATION_TOOL_METHODS", "tenant guard test must cover mutating methods");
        assertIncludes(tenantToolSurfaceTest, "TENANT_HIGH_RISK_TOOL_NAME_PATTERNS", "tenant guard test must cover high-risk names");
        assertIncludes(tenantToolSurfaceTest, "rows.filter((r) => isTenantToolVisible(r))", "tenant guard test must cover discovery filter");
      },
    },
    {
      id: "P0-secret-boundary-in-new-automation-guard",
      check: () => {
        const guardText = readRepoFile("scripts/automation-intelligence-guard.mjs");
        const forbiddenTokens = [
          ["process", "env", "GITHUB_TOKEN"].join("."),
          ["process", "env", "BACKEND_API_KEY"].join("."),
          "fe" + "tch(",
        ];
        for (const token of forbiddenTokens) {
          assertNotIncludes(guardText, token, "guard must not read secrets or call network providers");
        }
      },
    },
  ];

  const passed = runRules(rules);
  return {
    ok: true,
    guard: "automation_intelligence_guard",
    mode: "static_repo_contract",
    provider_calls_made: false,
    mutations_executed: false,
    secrets_included: false,
    passed,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runAutomationIntelligenceGuard();
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      guard: "automation_intelligence_guard",
      error: {
        code: "automation_intelligence_guard_failed",
        message: err?.message || String(err),
      },
      provider_calls_made: false,
      mutations_executed: false,
      secrets_included: false,
    }, null, 2));
    process.exitCode = 1;
  }
}
