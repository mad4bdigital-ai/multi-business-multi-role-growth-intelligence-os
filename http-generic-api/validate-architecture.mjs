/**
 * Canonical architecture validation script.
 * Detects drift between expected module structure and actual exports/imports.
 * Run: node validate-architecture.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
let failed = 0;
const warnings = [];

const ROOT_DIR = dirname(fileURLToPath(import.meta.url));
const DOC_ROOT = fileURLToPath(new URL("../", import.meta.url));

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function warn(label, detail = "") {
  console.warn(`  [WARN] ${label}${detail ? ` - ${detail}` : ""}`);
  warnings.push(label);
}

function section(name) {
  console.log(`\n== ${name}`);
}

function repoPath(...parts) {
  return join(ROOT_DIR, ...parts);
}

function docPath(...parts) {
  return join(DOC_ROOT, ...parts);
}

function walkFiles(dir, result = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const stats = statSync(abs);
    if (stats.isDirectory()) {
      walkFiles(abs, result);
      continue;
    }
    result.push(abs);
  }
  return result;
}

function isJsLikeFile(path) {
  return [".js", ".mjs"].includes(extname(path));
}

section("Required module files");

const REQUIRED_MODULES = [
  "server.js",
  "execution.js",
  "config.js",
  "queue.js",
  "auth.js",
  "normalization.js",
  "mutationGovernance.js",
  "governedChangeControl.js",
  "governedSheetWrites.js",
  "governedRecordResolution.js",
  "registryResolution.js",
  "registryMutations.js",
  "registrySheets.js",
  "routeWorkflowGovernance.js",
  "routeWorkflowRegistryModels.js",
  "sinkOrchestration.js",
  "sinkVerification.js",
  "surfaceMetadata.js",
  "schemaValidation.js",
  "authCredentialResolution.js",
  "authInjection.js",
  "httpRequestUtils.js",
  "jobUtils.js",
  "jobRunner.js",
  "executionRouting.js",
  "executionResolution.js",
  "executionPreparation.js",
  "executionDispatch.js",
  "executionAsync.js",
  "executionResponse.js",
  "activationBootstrapCache.js",
  "registryPolicyAccess.js",
  "registryExecutionEligibility.js",
  "registryTransportGovernance.js",
  "driveFileLoader.js",
  "sheetHelpers.js",
  "googleSheets.js",
  "siteInventoryRegistry.js",
  "wordpress-cpt-preflight.js",
  "github.js",
  "hostinger.js",
  "activationClassification.js",
  "activationProgress.js",
  "activationRecoveryPolicy.js",
  "activationOperatorView.js",
  "activationConsistencyCheck.js",
  "activationResponse.js",
  "activationStatusClassifier.js",
  "governedActivationRunner.js",
  "registryAlignmentValidator.js",
  "registryValidationAsyncSolver.js",
  "starterAuthoritySurfaces.js",
  "wordpress/index.js",
  "wordpress/shared.js",
  "wordpress/phaseA.js"
];

for (const mod of REQUIRED_MODULES) {
  assert(`${mod} exists`, existsSync(repoPath(mod)));
}

section("Canonical documentation files");

const REQUIRED_DOCS = [
  "system_bootstrap.md",
  "prompt_router.md",
  "module_loader.md",
  "direct_instructions_registry_patch.md",
  "canonical_validation_checklist.md",
  "runtime_boundary_map.md",
  "governed_mutation_playbook.md",
  "connector_contracts.md",
  "deployment_parity_checklist.md",
  "runtime_confirmation_procedure.md",
  "README.md"
];

for (const doc of REQUIRED_DOCS) {
  assert(`${doc} exists`, existsSync(docPath(doc)));
}

section("Canonical source workflow files");

const REQUIRED_CANONICAL_WORKFLOW_FILES = [
  "build-canonicals.mjs",
  "canonical-manifest.mjs",
  "validate-canonical-sources.mjs",
  "canonicals/system_bootstrap",
  "canonicals/direct_instructions_registry_patch",
  "canonicals/module_loader",
  "canonicals/prompt_router"
];

for (const rel of REQUIRED_CANONICAL_WORKFLOW_FILES) {
  assert(`${rel} exists`, existsSync(docPath(rel)));
}

section("Memory schema workflow files");

const REQUIRED_MEMORY_SCHEMA_WORKFLOW_FILES = [
  "validate-memory-schema.mjs",
  "memory-schema-manifest.mjs",
  "schemas/logic_knowledge.schema.json"
];

for (const rel of REQUIRED_MEMORY_SCHEMA_WORKFLOW_FILES) {
  assert(`${rel} exists`, existsSync(docPath(rel)));
}

section("WordPress barrel export count");

const wpModule = await import("./wordpress/index.js");
const wpExportCount = Object.keys(wpModule).length;
assert("wordpress/index.js exports >= 545 symbols", wpExportCount >= 545, `got ${wpExportCount}`);
if (wpExportCount < 545) {
  warn("Export count below expected minimum", "modules may have been removed or not re-exported");
}

section("Required WordPress exports");

const REQUIRED_WP_EXPORTS = [
  "runWordpressConnectorMigration",
  "validateSiteMigrationPayload",
  "normalizeSiteMigrationPayload",
  "evaluateWordpressPhaseAStartReadiness",
  "resolveWordpressPhaseLPlan",
  "buildWordpressPhasePGate",
  "buildWordpressPhaseKFinalOperatorHandoffBundle",
  "classifyWordpressExecutionStage",
  "toPositiveInt",
  "WORDPRESS_MUTATION_PUBLISH_STATUSES",
  "WORDPRESS_PHASE_B_BUILDER_TYPES",
  "WORDPRESS_PHASE_D_FORM_TYPES"
];

for (const name of REQUIRED_WP_EXPORTS) {
  assert(`wordpress exports ${name}`, name in wpModule);
}

section("Required normalization exports");

const normModule = await import("./normalization.js");
const REQUIRED_NORM_EXPORTS = [
  "normalizeExecutionPayload",
  "normalizeTopLevelRoutingFields",
  "validatePayloadIntegrity",
  "isHttpGenericTransportEndpointKey",
  "isDelegatedHttpExecuteWrapper",
  "promoteDelegatedExecutionPayload",
  "isHostingerAction",
  "isSiteTargetKey",
  "isHostingAccountTargetKey"
];

for (const name of REQUIRED_NORM_EXPORTS) {
  assert(`normalization exports ${name}`, name in normModule);
}

section("Required mutation governance exports");

const mutModule = await import("./mutationGovernance.js");
const REQUIRED_MUT_EXPORTS = [
  "classifyGovernedMutationIntent",
  "summarizeDuplicateCandidates",
  "isExecutionLogUnifiedAppendExempt",
  "buildGovernedMutationExemptionContext",
  "enforceGovernedMutationPreflight"
];

for (const name of REQUIRED_MUT_EXPORTS) {
  assert(`mutationGovernance exports ${name}`, name in mutModule);
}

section("Required jobRunner exports");

const jrModule = await import("./jobRunner.js");
const REQUIRED_JR_EXPORTS = [
  "toJobSummary",
  "buildWebhookPayload",
  "sendJobWebhook",
  "shouldRetryJobFailure",
  "inferLocalDispatchHttpStatus",
  "createSiteMigrationJobRecord",
  "executeSameServiceNativeEndpoint",
  "executeJobThroughHttpEndpoint",
  "dispatchEndpointKeyExecution",
  "configureJobRunner"
];

for (const name of REQUIRED_JR_EXPORTS) {
  assert(`jobRunner exports ${name}`, name in jrModule);
}

section("Required executionRouting exports");

const executionRoutingModule = await import("./executionRouting.js");
const REQUIRED_EXECUTION_ROUTING_EXPORTS = [
  "resolveHttpExecutionContext"
];

for (const name of REQUIRED_EXECUTION_ROUTING_EXPORTS) {
  assert(`executionRouting exports ${name}`, name in executionRoutingModule);
}

section("Required executionResolution exports");

const executionResolutionModule = await import("./executionResolution.js");
const REQUIRED_EXECUTION_RESOLUTION_EXPORTS = [
  "resolveExecutionRequest"
];

for (const name of REQUIRED_EXECUTION_RESOLUTION_EXPORTS) {
  assert(`executionResolution exports ${name}`, name in executionResolutionModule);
}

section("Required executionPreparation exports");

const executionPreparationModule = await import("./executionPreparation.js");
const REQUIRED_EXECUTION_PREPARATION_EXPORTS = [
  "prepareExecutionRequest"
];

for (const name of REQUIRED_EXECUTION_PREPARATION_EXPORTS) {
  assert(`executionPreparation exports ${name}`, name in executionPreparationModule);
}

section("Required executionDispatch exports");

const executionDispatchModule = await import("./executionDispatch.js");
const REQUIRED_EXECUTION_DISPATCH_EXPORTS = [
  "dispatchPreparedExecution"
];

for (const name of REQUIRED_EXECUTION_DISPATCH_EXPORTS) {
  assert(`executionDispatch exports ${name}`, name in executionDispatchModule);
}

section("Required executionAsync exports");

const executionAsyncModule = await import("./executionAsync.js");
const REQUIRED_EXECUTION_ASYNC_EXPORTS = [
  "submitSiteMigrationJob",
  "submitGenericExecutionJob",
  "getExecutionJob",
  "pollExecutionJobResult"
];

for (const name of REQUIRED_EXECUTION_ASYNC_EXPORTS) {
  assert(`executionAsync exports ${name}`, name in executionAsyncModule);
}

section("Required registryPolicyAccess exports");

const registryPolicyAccessModule = await import("./registryPolicyAccess.js");
const REQUIRED_REGISTRY_POLICY_ACCESS_EXPORTS = [
  "policyValue",
  "policyList"
];

for (const name of REQUIRED_REGISTRY_POLICY_ACCESS_EXPORTS) {
  assert(`registryPolicyAccess exports ${name}`, name in registryPolicyAccessModule);
}

section("Required registryExecutionEligibility exports");

const registryEligibilityModule = await import("./registryExecutionEligibility.js");
const REQUIRED_REGISTRY_ELIGIBILITY_EXPORTS = [
  "requireRuntimeCallableAction",
  "requireEndpointExecutionEligibility",
  "requireExecutionModeCompatibility"
];

for (const name of REQUIRED_REGISTRY_ELIGIBILITY_EXPORTS) {
  assert(`registryExecutionEligibility exports ${name}`, name in registryEligibilityModule);
}

section("Required registryTransportGovernance exports");

const registryTransportModule = await import("./registryTransportGovernance.js");
const REQUIRED_REGISTRY_TRANSPORT_EXPORTS = [
  "isDelegatedTransportTarget",
  "requireNativeFamilyBoundary",
  "requireTransportIfDelegated",
  "requireNoFallbackDirectExecution",
  "getPlaceholderResolutionSources",
  "resolveRuntimeProviderDomainSource",
  "resolveProviderDomain"
];

for (const name of REQUIRED_REGISTRY_TRANSPORT_EXPORTS) {
  assert(`registryTransportGovernance exports ${name}`, name in registryTransportModule);
}

section("Required executionResponse exports");

const executionResponseModule = await import("./executionResponse.js");
const REQUIRED_EXECUTION_RESPONSE_EXPORTS = [
  "validateAndShapeExecutionResponse"
];

for (const name of REQUIRED_EXECUTION_RESPONSE_EXPORTS) {
  assert(`executionResponse exports ${name}`, name in executionResponseModule);
}

section("Required auth exports");

const authModule = await import("./auth.js");
const REQUIRED_AUTH_EXPORTS = [
  "mintGoogleAccessTokenForEndpoint",
  "requirePolicyTrue",
  "requirePolicySet",
  "getRequiredHttpExecutionPolicyKeys",
  "buildMissingRequiredPolicyError",
  "resilienceAppliesToParentAction",
  "shouldRetryProviderResponse",
  "buildProviderRetryMutations"
];

for (const name of REQUIRED_AUTH_EXPORTS) {
  assert(`auth exports ${name}`, name in authModule);
}

section("Execution snapshot surface");

const executionModule = await import("./execution.js");
const REQUIRED_EXECUTION_EXPORTS = [
  "performUniversalServerWriteback",
  "executeUpstreamAttempt",
  "resolveSchemaOperation",
  "validateByJsonSchema",
  "fetchSchemaContract",
  "fetchOAuthConfigContract"
];

for (const name of REQUIRED_EXECUTION_EXPORTS) {
  assert(`execution exports ${name}`, name in executionModule);
}

section("Connector API surface");

const ghModule = await import("./github.js");
assert("github.js exports githubGitBlobChunkRead", "githubGitBlobChunkRead" in ghModule);
assert("github.js exports fetchGitHubBlobPayload", "fetchGitHubBlobPayload" in ghModule);
assert("github.js exports fetchGitHubContentFile", "fetchGitHubContentFile" in ghModule);
assert("github.js exports githubPutContents", "githubPutContents" in ghModule);
assert("github.js exports githubApplyFileUpdates", "githubApplyFileUpdates" in ghModule);
assert("github.js exports fetchGitHubBranchRef", "fetchGitHubBranchRef" in ghModule);
assert("github.js exports githubCreateBranchReference", "githubCreateBranchReference" in ghModule);
assert("github.js exports githubCreatePullRequest", "githubCreatePullRequest" in ghModule);
assert("github.js exports githubValidatedApplyFileUpdates", "githubValidatedApplyFileUpdates" in ghModule);
assert("github.js exports generateAgentBranchName", "generateAgentBranchName" in ghModule);
assert("github.js exports githubGetPRStatus", "githubGetPRStatus" in ghModule);
assert("github.js exports githubMergePR", "githubMergePR" in ghModule);
assert("github.js exports githubPreviewFileUpdates", "githubPreviewFileUpdates" in ghModule);
assert("github.js exports githubCommentOnPR", "githubCommentOnPR" in ghModule);
assert(
  "github.js exports no unexpected symbols",
  Object.keys(ghModule).length === 14,
  `got ${Object.keys(ghModule).length} exports: ${Object.keys(ghModule).join(", ")}`
);

const hModule = await import("./hostinger.js");
assert("hostinger.js exports hostingerSshRuntimeRead", "hostingerSshRuntimeRead" in hModule);
assert("hostinger.js exports matchesHostingerSshTarget", "matchesHostingerSshTarget" in hModule);

section("Legacy execution snapshot isolation");

const EXECUTION_IMPORT_PATTERN =
  /from\s+["']\.\/execution(?:\.js)?["']|import\s*\(\s*["']\.\/execution(?:\.js)?["']\s*\)|require\s*\(\s*["']\.\/execution(?:\.js)?["']\s*\)/;
const EXECUTION_IMPORT_ALLOWLIST = new Set([
  "execution.js",
  "validate-architecture.mjs",
  "extract-modules.js",
  "fix-all-truncated.mjs",
  "fix-crlf.mjs",
  "fix-extractions.mjs",
  "test-execution-log-evidence.mjs",
  "test-engine-evidence-derivation.mjs",
  "test-engine-evidence-integration.mjs",
  "test-execution-context-evidence.mjs",
  "test-execution-state-evidence.mjs"
]);

const executionConsumers = walkFiles(ROOT_DIR)
  .filter(isJsLikeFile)
  .filter(path => !EXECUTION_IMPORT_ALLOWLIST.has(relative(ROOT_DIR, path).replace(/\\/g, "/")))
  .map(path => {
    const rel = relative(ROOT_DIR, path).replace(/\\/g, "/");
    const content = readFileSync(path, "utf8");
    return { rel, importsExecution: EXECUTION_IMPORT_PATTERN.test(content) };
  })
  .filter(item => item.importsExecution);

assert(
  "execution.js remains isolated from runtime imports",
  executionConsumers.length === 0,
  executionConsumers.map(item => item.rel).join(", ")
);

section("Route files - execution internals isolation");

const EXECUTION_INTERNAL_PATTERN =
  /from\s+["'](?:\.\.\/)?execution(?:Resolution|Preparation|Dispatch|Async|Response)(?:\.js)?["']/;

const ROUTE_FILES = [
  "routes/executeRoutes.js",
  "routes/jobRoutes.js",
  "routes/mcpRoutes.js",
  "routes/governanceRoutes.js",
  "routes/githubRoutes.js"
];

for (const rel of ROUTE_FILES) {
  const absPath = repoPath(rel);
  if (existsSync(absPath)) {
    const content = readFileSync(absPath, "utf8");
    assert(
      `${rel} does not import execution internals directly`,
      !EXECUTION_INTERNAL_PATTERN.test(content)
    );
  }
}

section("registryResolution.js facade guard");

const registryResolutionLines = readFileSync(repoPath("registryResolution.js"), "utf8").split("\n").length;
assert(
  "registryResolution.js is under 350 lines",
  registryResolutionLines < 350,
  `got ${registryResolutionLines} lines`
);

section("server.js size guard");

const serverLines = readFileSync(repoPath("server.js"), "utf8").split("\n").length;
assert("server.js is under 6000 lines", serverLines < 6000, `got ${serverLines} lines`);
if (serverLines > 5500) {
  warn(`server.js at ${serverLines} lines`, "approaching size threshold, consider further decomposition");
}

console.log(`\n${"-".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
if (failed === 0) {
  console.log("ARCHITECTURE VALIDATION PASS");
  process.exit(0);
}

console.error(`${failed} VALIDATION(S) FAILED - architecture drift detected`);
process.exit(1);
