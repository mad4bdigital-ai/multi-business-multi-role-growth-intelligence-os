import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS,
  PLATFORM_RESOURCE_RECIPE_TOOL_NAMES,
  resolveResourceRefInput,
} from "./platformResourceRecipeCapability.js";
import { validateRequestBody } from "./schemaValidation.js";

const migrationPath = "migrations/246_sprint68_platform_resource_recipe_capability.sql";
const migration = readFileSync(migrationPath, "utf8");
const driveMultipartMigration = readFileSync("migrations/903_sprint68_google_drive_multipart_upload_schema_contract.sql", "utf8");
const manifestCertificationMigration = readFileSync("migrations/904_sprint68_resource_manifest_positive_smoke_certification.sql", "utf8");
const graphProjectionApplyMigration = readFileSync("migrations/952_sprint68_resource_graph_projection_apply_gate.sql", "utf8");
const graphProjectionPositiveCertificationMigration = readFileSync("migrations/953_sprint68_resource_graph_projection_positive_smoke_certification.sql", "utf8");
const compactViewsGithubCoverageMigration = readFileSync("migrations/954_sprint68_compact_operational_views_and_github_resource_coverage.sql", "utf8");
const capabilityBaselineGithubFileMigration = readFileSync("migrations/957_sprint68_capability_baseline_branch_hygiene_github_file_inspect.sql", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");
const systemLayerRoutes = readFileSync("routes/systemLayerRoutes.js", "utf8");
const runtimeModule = readFileSync("platformResourceRecipeCapability.js", "utf8");
const providerTransportEncoderRegistry = readFileSync("providerTransportEncoderRegistry.js", "utf8");
const executionDispatch = readFileSync("executionDispatch.js", "utf8");

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} must include ${value}`);
  }
}

includesAll(migration, [
  "CREATE TABLE IF NOT EXISTS `platform_resource_types`",
  "CREATE TABLE IF NOT EXISTS `platform_resource_adapters`",
  "CREATE TABLE IF NOT EXISTS `platform_resource_recipes`",
  "CREATE TABLE IF NOT EXISTS `platform_resource_recipe_steps`",
], "resource recipe foundation migration");

for (const forbidden of [
  "CREATE TABLE IF NOT EXISTS `resource_graph_nodes`",
  "CREATE TABLE IF NOT EXISTS `resource_graph_edges`",
  "CREATE TABLE IF NOT EXISTS `platform_plugin_resource_recipes`",
  "CREATE TABLE IF NOT EXISTS `platform_plugin_operation_runs`",
  "CREATE TABLE IF NOT EXISTS `resource_operation_runs`",
  "execute_any_endpoint",
  "generic_endpoint_executor",
]) {
  assert(!migration.includes(forbidden), `migration must not introduce ${forbidden}`);
  assert(!runtimeModule.includes(forbidden), `runtime module must not introduce ${forbidden}`);
}

includesAll(migration, [
  "`platform_graph_taxonomy`",
  "platform_graph_nodes",
  "platform_graph_edges",
  "platform_graph_edge_evidence",
  "platform_resource_authority_requirements",
  "capability_resolution_envelope_ledger",
  "platform_engine_execution_runs",
  "execution_log",
  "audit_payload_evidence",
], "resource recipe integration policy");

includesAll(migration, [
  "google_drive.folder.inspect_tree",
  "google_drive.session_folder.reconcile_artifacts_exports",
  "github.branch.reconcile_with_base",
  "platform_plugin.contribution.inspect_runtime_readiness",
  "platform_plugin.smoke_certification.inspect_status",
], "seeded resource recipes");

includesAll(migration, [
  "google_drive_folder_inspect",
  "admin_branch_reconcile",
  "platform_plugin_contributions",
  "platform_plugin_smoke_certifications",
  "platform_plugin_smoke_recertification_policies",
], "installed adapters and existing source tables");

includesAll(migration, [
  "'v1_read_only_or_diagnostic_only', true",
  "'raw_endpoint_executor_allowed', false",
  "'writes_require_capability_envelope', true",
  "'secrets_included', false",
], "resource recipe governance policy");

includesAll(driveMultipartMigration, [
  "903_sprint68_google_drive_multipart_upload_schema_contract.sql",
  "parent_action_key = 'google_drive_api'",
  "endpoint_key IN ('uploadNewFile', 'upload_new_file_media')",
  "$.requestBody.content.\"multipart/related\"",
  "'type', 'string'",
  "raw_body_mode=multipart_related",
], "Drive multipart upload endpoint schema contract migration");

includesAll(manifestCertificationMigration, [
  "904_sprint68_resource_manifest_positive_smoke_certification.sql",
  "manifest_create_positive_apply_smoke_passed",
  "apply_allowed = 1",
  "resource_manifest_create_positive_smoke:2026-06-10:file:1uYzW6CUmKPs7dl_usgYr6XckBut-XrGb",
  "classification=manifest_created_with_readback",
  "readback_required=true",
  "readback_ok=true",
  "graph_write_made=false",
  "file_content_returned=false",
  "secrets_included=false",
  "certification_key = 'resource_manifest_create'",
  "requires_dry_run = 1",
  "requires_audit_evidence = 1",
  "requires_readback = 1",
], "resource manifest positive smoke certification migration");

includesAll(graphProjectionApplyMigration, [
  "952_sprint68_resource_graph_projection_apply_gate.sql",
  "resource_graph_projection_apply",
  "resource_graph_projection.apply_after_review",
  "governed_resource_run",
  "capability_apply_authorization_policy_registry",
  "IF(`certification_status` = 'resource_graph_projection_apply_smoke_passed'",
  "runtime_dispatch_certification_registry",
  "platform_graph_nodes",
  "platform_graph_edges",
  "platform_graph_edge_evidence",
  "candidate",
  "advisory",
  "runtime_enforced",
  "provider_call_allowed', false",
  "credential_payload_read_allowed', false",
  "file_content_read_allowed', false",
  "secrets_included', false",
], "resource graph projection apply gate migration");

includesAll(graphProjectionPositiveCertificationMigration, [
  "953_sprint68_resource_graph_projection_positive_smoke_certification.sql",
  "resource_graph_projection_apply_smoke_passed",
  "apply_allowed = 1",
  "resource_graph_projection_apply:0188f06bcc39da3108b694e87fa1482f9e28c361168b85744bec987b901f9865:nodes=10:edges=10:evidence=10",
  "runtime_enforced=0",
  "provider_calls_made=0",
  "file_content_returned=false",
  "secrets_included=false",
], "resource graph projection positive smoke certification migration");

includesAll(compactViewsGithubCoverageMigration, [
  "954_sprint68_compact_operational_views_and_github_resource_coverage.sql",
  "CREATE OR REPLACE VIEW v_release_readiness_compact",
  "CREATE OR REPLACE VIEW v_migration_status_compact",
  "CREATE OR REPLACE VIEW v_resource_recipe_certification_compact",
  "CREATE OR REPLACE VIEW v_resource_recipe_registry_compact",
  "compact_operational_readiness_v1",
  "github.repo.inspect_summary",
  "github.branch.inspect_summary",
  "github.repo.inspect.adapter",
  "github.branch.inspect.adapter",
  "provider_call_allowed',false",
  "credential_payload_read_allowed',false",
  "file_content_read_allowed',false",
  "secrets_included',false",
], "compact operational views and GitHub resource coverage migration");

includesAll(capabilityBaselineGithubFileMigration, [
  "957_sprint68_capability_baseline_branch_hygiene_github_file_inspect.sql",
  "CREATE OR REPLACE VIEW v_platform_resource_capability_baseline",
  "CREATE OR REPLACE VIEW v_repo_branch_hygiene_compact",
  "platform_resource_capability_baseline.v1",
  "snapshot_backed_branch_hygiene.v1",
  "github.file.inspect_summary",
  "github.file.inspect.adapter",
  "metadata_only_no_content",
  "file_content_read_allowed',false",
  "file_content_returned',false",
  "write_allowed',false",
  "secrets_included',false",
], "capability baseline branch hygiene and GitHub file inspect migration");

assert(
  manifest.includes("node test-platform-resource-recipe-capability.mjs"),
  "test manifest must include platform resource recipe capability test"
);

assert.deepEqual(PLATFORM_RESOURCE_RECIPE_TOOL_NAMES, [
  "governed_resource_resolve",
  "governed_resource_catalog",
  "governed_resource_plan",
  "governed_resource_run",
]);

assert.equal(PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS.length, 4, "four system-layer resource recipe tools are exposed");
for (const toolName of PLATFORM_RESOURCE_RECIPE_TOOL_NAMES) {
  const tool = PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS.find((entry) => entry.name === toolName);
  assert(tool, `${toolName} must be present in exported system tools`);
  assert.equal(tool.requires_admin, true, `${toolName} must remain admin-only in v1`);
  assert(systemLayerRoutes.includes(`case "${toolName}":`), `systemLayerRoutes must dispatch ${toolName}`);
}

includesAll(systemLayerRoutes, [
  "PLATFORM_RESOURCE_RECIPE_SYSTEM_TOOLS",
  "catalogGovernedResources",
  "planGovernedResource",
  "resolveGovernedResource",
  "runGovernedResource",
], "system layer runtime wiring");

includesAll(systemLayerRoutes, [
  "executeInstalledTool",
  "inspectGoogleDriveFolder(toolArgs, auth, deps)",
  "resource_recipe_installed_tool_not_allowlisted",
  "executeRuntimeEndpoint",
  "callRuntimeEndpointViaFacade(payload, deps)",
], "system layer read-only installed tool executor wiring");

includesAll(executionDispatch, [
  "raw_body_mode",
  "multipart_related",
  "String(parent_action_key || \"\").trim() === \"google_drive_api\"",
  "[\"uploadNewFile\", \"upload_new_file_media\"].includes(endpointKey)",
  "requestContentType.startsWith(\"multipart/related;\")",
  "upstreamBody = transportBody",
], "execution dispatch gated raw multipart body support");

includesAll(providerTransportEncoderRegistry, [
  "PROVIDER_TRANSPORT_ENCODER_REGISTRY",
  "google_drive_api.uploadNewFile.multipart_related_json_v1",
  "uploadNewFile",
  "uploadType: \"multipart\"",
  "raw_body_mode: \"multipart_related\"",
  "multipart/related; boundary=",
  "provider_transport_encoder_secret_key_rejected",
  "secrets_included: false",
], "provider transport encoder registry contract");

includesAll(runtimeModule, [
  "READ_ONLY_INSTALLED_TOOL_ALLOWLIST",
  "READ_ONLY_COMPOSITE_RECIPE_ALLOWLIST",
  "google_drive_folder_inspect",
  "google_drive.session_folder.reconcile_artifacts_exports",
  "resource_recipe_read_only_installed_tool_v1",
  "resource_recipe_read_only_composite_v1",
  "const executionClass",
  "execution_class: executionClass",
  "buildArtifactExportReconciliation",
  "buildArtifactExportManifestPlan",
  "manifest_plan_v1",
  "manifest_dry_run",
  "manifest_dry_run_ready",
  "manifest_materialization_dry_run",
  "buildArtifactExportManifestDryRun",
  "graph_projection_dry_run",
  "graph_projection_dry_run_ready",
  "buildArtifactExportGraphProjectionDryRun",
  "platform_resource_graph_projection.v1",
  "resource_graph_projection.apply_after_review",
  "projection_sha256",
  "APPLY_GRAPH_PROJECTION:",
  "graph_write_allowed_now: false",
  "graph_write_executed: false",
  "GRAPH_PROJECTION_ACCEPTED_INTENTS",
  "resourceGraphProjectionOperationIntent",
  "validateGraphProjectionApplyGate",
  "writeGraphProjectionCandidate",
  "blocked_graph_projection_apply_gate_v1",
  "resource_graph_projection_applied_with_readback",
  "resource_graph_projection_apply_readback_degraded",
  "platform_graph_nodes",
  "platform_graph_edges",
  "platform_graph_edge_evidence",
  "candidate_advisory_only",
  "runtime_enforced: false",
  "provider_calls_made: 0",
  "content_sha256",
  "CREATE_MANIFEST:",
  "drive_write_executed: false",
  "same_cycle_readback_required: true",
  "artifact_export_manifest.v1",
  "review_manifest_plan",
  "future_guarded_apply_required",
  "resolveCapabilityExecutionEnvelope",
  "markCapabilityEnvelopeReferenced",
  "MANIFEST_CREATE_ACCEPTED_INTENTS",
  "blocked_manifest_create_gate_v1",
  "manifest_create_typed_confirmation_required",
  "capability_resolution_envelope_apply_not_allowed",
  "manifest_create_runtime_endpoint_executor_missing",
  "buildManifestUploadPayload",
  "buildGoogleDriveMultipartRelatedJsonPayload",
  "result?.body?.data?.id",
  "buildManifestReadbackPayload",
  "getFileMetadata",
  "manifest_created_with_readback",
  "manifest_create_readback_degraded",
  "executeRuntimeEndpoint",
  "buildSourceInspectionSummary",
  "source_inspection_summary",
  "source_inspection_included",
  "include_source_inspection",
  "targeted_child_traversal_v1",
  "targeted_child_traversal_plan_v1",
  "planned_not_executed",
  "continue_read_only",
  "execute_child_inspections",
  "selectContinuationChildFolders",
  "buildChildContinuationBlockedResult",
  "resource_child_continuation_target_required_or_not_found",
  "targeted_child_continuation",
  "recursive: isArtifactReconcile ? false",
  "targetableChildFolders",
  "mergeTargetedChildInspections",
  "buildTargetedChildTraversalPlan",
  "Promise.all(selectedChildFolders.map",
  "installed_tool_call_count",
  "traversal_stage: \"targeted_child_continuation\"",
  "write_operations_planned: false",
  "drive_write_planned: false",
  "graph_write_planned: false",
  "file_content_required: false",
  "missing_required_child",
  "artifacts_and_exports_empty",
  "duplicate_resource",
  "missing_export",
  "read_only_executed",
  "resource_recipe_apply_blocked_v1",
  "file_content_blocked_v1",
  "provider_calls_allowed_directly_by_resource_engine: false",
  "graph_write_made: false",
  "file_content_returned: false",
], "runtime v1 read-only installed and composite tool guard");

const multipartOperation = {
  requestBody: {
    content: {
      "application/json": { schema: { type: "object", additionalProperties: true } },
      "multipart/related": { schema: { type: "string" } },
    },
  },
};
assert.deepEqual(validateRequestBody(multipartOperation, { metadata: {}, media: {} }), []);
assert.deepEqual(validateRequestBody(multipartOperation, "--boundary\r\nContent-Type: application/json\r\n\r\n{}"), []);
assert.deepEqual(validateRequestBody(multipartOperation, 123), ["body: expected object got integer"]);

const driveResolved = resolveResourceRefInput({ input: "https://drive.google.com/drive/folders/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES" });
assert.equal(driveResolved.resource_type, "drive_folder");
assert.equal(driveResolved.resource_ref.folder_id, "1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");
assert.equal(driveResolved.resource_uri, "gdrive://folder/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");

const driveResolvedWithRecipeTypeHint = resolveResourceRefInput({
  input: "https://drive.google.com/drive/folders/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES",
  resource_type: "drive_folder",
});
assert.equal(driveResolvedWithRecipeTypeHint.resource_type, "drive_folder");
assert.equal(driveResolvedWithRecipeTypeHint.resource_ref.folder_id, "1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");
assert.equal(driveResolvedWithRecipeTypeHint.resource_uri, "gdrive://folder/1E2mS1cOPL3ZAAiVWzEg9iv6klHCOVqES");

const githubResolved = resolveResourceRefInput({ input: "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/tree/gpt/example" });
assert.equal(githubResolved.resource_type, "github_branch");
assert.equal(githubResolved.resource_ref.owner, "mad4bdigital-ai");
assert.equal(githubResolved.resource_ref.repo, "multi-business-multi-role-growth-intelligence-os");
assert.equal(githubResolved.resource_ref.branch, "gpt/example");

const pluginResolved = resolveResourceRefInput({ resource_ref: { contribution_id: "ppc_test" } });
assert.equal(pluginResolved.resource_type, "platform_plugin_contribution");
assert.equal(pluginResolved.resource_uri, "platform-plugin-contribution://ppc_test");

console.log("platform resource recipe capability migration and runtime contract ok");
