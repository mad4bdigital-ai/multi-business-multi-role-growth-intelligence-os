/**
 * Canonical architecture validation script.
 * Detects drift between expected module structure and actual exports/imports.
 * Run: node validate-architecture.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

let passed = 0;
let failed = 0;
const warnings = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function warn(label, detail = "") {
  console.warn(`  ⚠ ${label}${detail ? ` — ${detail}` : ""}`);
  warnings.push(label);
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ─── Required files exist ───────────────────────────────────────────────────
section("Required module files");

const REQUIRED_MODULES = [
  "server.js", "config.js", "queue.js",
  "normalization.js", "mutationGovernance.js", "governedChangeControl.js",
  "governedSheetWrites.js", "governedRecordResolution.js",
  "registryResolution.js", "registryMutations.js", "registrySheets.js",
  "routeWorkflowGovernance.js", "routeWorkflowRegistryModels.js",
  "sinkOrchestration.js", "sinkVerification.js", "surfaceMetadata.js",
  "schemaValidation.js", "authCredentialResolution.js", "authInjection.js",
  "httpRequestUtils.js", "jobUtils.js", "jobRunner.js",
  "driveFileLoader.js", "sheetHelpers.js", "googleSheets.js",
  "siteInventoryRegistry.js", "wordpress-cpt-preflight.js",
  "github.js", "hostinger.js",
  "wordpress/index.js", "wordpress/shared.js", "wordpress/phaseA.js"
];

for (const mod of REQUIRED_MODULES) {
  assert(`${mod} exists`, existsSync(new URL(mod, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
}

// ─── Canonical documentation files ─────────────────────────────────────────
section("Canonical documentation files");

const REQUIRED_DOCS = [
  "../system_bootstrap.md",
  "../prompt_router.md",
  "../module_loader.md",
  "../direct_instructions_registry_patch.md",
  "../canonical_validation_checklist.md",
  "../runtime_boundary_map.md",
  "../governed_mutation_playbook.md",
  "../connector_contracts.md",
  "../project_upgrade_end_to_end_plan.md",
  "../README.md"
];

for (const doc of REQUIRED_DOCS) {
  const name = doc.replace("../", "");
  assert(`${name} exists`, existsSync(new URL(doc, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
}

// ─── WordPress barrel — export count ────────────────────────────────────────
section("WordPress barrel export count");

const wpModule = await import("./wordpress/index.js");
const wpExportCount = Object.keys(wpModule).length;
assert(`wordpress/index.js exports ≥ 545 symbols`, wpExportCount >= 545,
  `got ${wpExportCount}`);
if (wpExportCount < 545) {
  warn("Export count below expected minimum — modules may have been removed or not re-exported");
}

// ─── Required wordpress exports ─────────────────────────────────────────────
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

// ─── Required normalization exports ─────────────────────────────────────────
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

// ─── Required mutation governance exports ───────────────────────────────────
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

// ─── Required jobRunner exports ──────────────────────────────────────────────
section("Required jobRunner exports");

const jrModule = await import("./jobRunner.js");
const REQUIRED_JR_EXPORTS = [
  "toJobSummary", "buildWebhookPayload", "sendJobWebhook",
  "shouldRetryJobFailure", "inferLocalDispatchHttpStatus",
  "createSiteMigrationJobRecord", "executeSameServiceNativeEndpoint",
  "executeJobThroughHttpEndpoint", "dispatchEndpointKeyExecution",
  "configureJobRunner"
];
for (const name of REQUIRED_JR_EXPORTS) {
  assert(`jobRunner exports ${name}`, name in jrModule);
}

// ─── Connector API surface ───────────────────────────────────────────────────
section("Connector API surface");

const ghModule = await import("./github.js");
assert("github.js exports githubGitBlobChunkRead", "githubGitBlobChunkRead" in ghModule);
assert("github.js exports fetchGitHubBlobPayload", "fetchGitHubBlobPayload" in ghModule);
assert("github.js exports no unexpected symbols", Object.keys(ghModule).length === 2,
  `got ${Object.keys(ghModule).length} exports: ${Object.keys(ghModule).join(", ")}`);

const hModule = await import("./hostinger.js");
assert("hostinger.js exports hostingerSshRuntimeRead", "hostingerSshRuntimeRead" in hModule);
assert("hostinger.js exports matchesHostingerSshTarget", "matchesHostingerSshTarget" in hModule);

// ─── server.js size guard ────────────────────────────────────────────────────
section("server.js size guard");

const serverPath = new URL("server.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const serverLines = readFileSync(serverPath, "utf8").split("\n").length;
assert("server.js is under 6000 lines", serverLines < 6000, `got ${serverLines} lines`);
if (serverLines > 5500) {
  warn(`server.js at ${serverLines} lines — approaching size threshold, consider further decomposition`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
if (failed === 0) {
  console.log("ARCHITECTURE VALIDATION PASS ✓");
  process.exit(0);
} else {
  console.error(`${failed} VALIDATION(S) FAILED — architecture drift detected`);
  process.exit(1);
}
