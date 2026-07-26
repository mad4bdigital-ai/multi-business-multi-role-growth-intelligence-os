import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const apiRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = path.resolve(apiRoot, "..");
const inventory = readFileSync(
  path.join(repoRoot, "specs/001-capability-security-hardening/phase1-discovery-inventory.md"),
  "utf8",
);

for (const text of [
  "main@89c54872c18432b0b0f41c8963ed731f8f12751f",
  "## T010 runtime map",
  "## T018 build and governance mechanisms",
  "Finding D-001: passive dry-run descriptor policy",
  "no provider execution, database mutation, deployment, or production promotion",
]) {
  assert(inventory.includes(text), `Missing Phase 1 evidence: ${text}`);
}

const paths = [
  "AI_Agent_Knowledge_Guide.md",
  "system_bootstrap.md",
  "memory_schema.json",
  "direct_instructions_registry_patch.md",
  "module_loader.md",
  "prompt_router.md",
  ".github/workflows/ci.yml",
  "build-canonicals.mjs",
  "validate-canonical-sources.mjs",
  "http-generic-api/openapi.yaml",
  "http-generic-api/platformPluginResolver.js",
  "http-generic-api/platformPluginRestDispatch.js",
  "http-generic-api/connectorExecutor.js",
  "http-generic-api/governedExecutionPreflight.js",
  "http-generic-api/runtimePolicyResolver.js",
  "http-generic-api/runtimePolicyLoader.js",
  "http-generic-api/credentialIntakeBindingPolicy.js",
  "http-generic-api/capabilityResolutionEnvelopeGuard.js",
  "http-generic-api/routes/connectorProxyRoutes.js",
  "http-generic-api/routes/localGatewayToolsRoutes.js",
  "http-generic-api/auditLogger.js",
  "http-generic-api/executionEvidenceLogger.js",
  "http-generic-api/platformPluginSecurityAlerts.js",
  "http-generic-api/scripts/governed-migration-runner.mjs",
  "http-generic-api/scripts/run-test-manifest.mjs",
  "src/services/execution/dispatchPlanStep.ts",
  "src/services/connectors/execution/resolveConnectorExecutor.ts",
  "src/store/registries/connectorExecutorRegistry.ts",
];

for (const relative of paths) {
  assert(existsSync(path.join(repoRoot, relative)), `Missing mapped path: ${relative}`);
  assert(inventory.includes(relative), `Inventory must reference: ${relative}`);
}

assert.match(inventory, /T011[-–]T017 and T019 remain open/);

for (const generated of [
  "system_bootstrap.md",
  "direct_instructions_registry_patch.md",
  "module_loader.md",
  "prompt_router.md",
]) {
  const source = readFileSync(path.join(repoRoot, generated), "utf8");
  assert.match(source, /GENERATED FILE/);
  assert.match(source, /canonicals\//);
}

console.log("Phase 1 capability discovery inventory tests passed");
