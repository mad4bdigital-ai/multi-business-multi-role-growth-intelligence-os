import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyStagingEmptyRoleCensus } from "./scripts/classify-staging-empty-role-census.mjs";
import { canonicalObjectCountFingerprint, computeStagingDatabaseTargetFingerprint } from "./scripts/prepare-staging-rebuild-empty-inspection.mjs";
import { computeTargetBindingFingerprint, sha256Hex } from "./runtimeBootstrapContract.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const classifier = path.join(root, "http-generic-api/scripts/classify-staging-empty-role-census.mjs");
const roles = ["runtime", "governance", "runtime_persistence"];
const empty = roles.map((role) => ({ role, object_count: 0 }));
const emptyResult = classifyStagingEmptyRoleCensus(empty);
assert.equal(emptyResult.ready_for_rebuild_empty, true);
assert.equal(emptyResult.candidate_for_governed_rebuild_empty, true);
assert.equal(emptyResult.ready_for_local_mutation, false);
assert.deepEqual(emptyResult.roles.map((row) => row.role), ["governance", "runtime", "runtime_persistence"]);

const mixed = classifyStagingEmptyRoleCensus([
  { role: "runtime", object_count: 782 },
  { role: "governance", object_count: 0 },
  { role: "runtime_persistence", object_count: 0 },
]);
assert.deepEqual(mixed.selected_zero_object_roles, ["governance", "runtime_persistence"]);
assert.deepEqual(mixed.preserved_nonempty_roles, ["runtime"]);
assert.equal(mixed.role_selection_authoritative, false);
assert.equal(mixed.mutation_requires_durable_inspection_proof, true);
assert.equal(mixed.ready_for_rebuild_empty, true);
assert.equal(mixed.ready_for_local_mutation, false);
assert.equal(mixed.next_authority, "staging_durable_full_inspection");
for (const i of [0, 1, 2]) {
  const partial = empty.map((row, index) => ({ ...row, object_count: index === i ? 1 : 0 }));
  const result = classifyStagingEmptyRoleCensus(partial);
  assert.equal(result.ready_for_rebuild_empty, true);
  assert.equal(result.roles.find((row) => row.role === roles[i]).classification, "preserve_nonempty");
  assert.equal(spawnSync(process.execPath, [classifier, "--census-json", JSON.stringify(partial)], { encoding: "utf8" }).status, 0);
}
const noZero = roles.map((role) => ({ role, object_count: 1 }));
assert.equal(classifyStagingEmptyRoleCensus(noZero).ready_for_rebuild_empty, false);
assert.equal(spawnSync(process.execPath, [classifier, "--census-json", JSON.stringify(noZero)], { encoding: "utf8" }).status, 2);
for (const invalid of [empty.slice(1), [...empty, empty[0]], [{ ...empty[0], object_count: -1 }, ...empty.slice(1)],
  [{ ...empty[0], role: "production" }, ...empty.slice(1)], [{ ...empty[0], object_count: 0.5 }, ...empty.slice(1)]]) {
  assert.throws(() => classifyStagingEmptyRoleCensus(invalid));
}
assert.equal(spawnSync(process.execPath, [classifier, "--census-json", JSON.stringify(empty)], { encoding: "utf8" }).status, 0);

const zeroCounts = { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 };
const runtimeNormalized = { ...zeroCounts, legacy_table_only: false, secrets_included: false };
assert.equal(canonicalObjectCountFingerprint(zeroCounts), sha256Hex(JSON.stringify(runtimeNormalized)));

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-staging-target-"));
const tempEnv = path.join(tempDir, ".env.staging");
fs.writeFileSync(tempEnv, [
  "DB_NAME=runtime_db",
  "GOVERNANCE_DB_NAME=governance_db",
  "RUNTIME_PERSISTENCE_DB_NAME=persistence_db",
  "DB_USER=runtime_user",
  "GOVERNANCE_DB_USER=governance_user",
  "RUNTIME_PERSISTENCE_DB_USER=persistence_user",
  "DB_PRINCIPAL_HOST=localhost",
].join("\n"));
const expectedTargetFingerprint = computeTargetBindingFingerprint({
  repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  branch: "main",
  key: "staging-runtime",
  database: "runtime_db",
  governance_database: "governance_db",
  runtime_persistence_database: "persistence_db",
  principal: "runtime_user",
  principal_host: "localhost",
  runtime_principal: "runtime_user",
  runtime_principal_host: "localhost",
  governance_principal: "governance_user",
  governance_principal_host: "localhost",
  runtime_persistence_principal: "persistence_user",
  runtime_persistence_principal_host: "localhost",
});
assert.equal(computeStagingDatabaseTargetFingerprint({ envFile: tempEnv }), expectedTargetFingerprint);
fs.rmSync(tempDir, { recursive: true, force: true });

const importer = fs.readFileSync(path.join(root, "autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1"), "utf8");
const replay = fs.readFileSync(path.join(root, "http-generic-api/scripts/prepare-staging-role-schema-replay.mjs"), "utf8");
const entry = fs.readFileSync(path.join(root, "autopilot-portable-staging/Rebuild-EmptyStagingRoleDatabases.ps1"), "utf8");
const authority = fs.readFileSync(path.join(root, "http-generic-api/stagingRebuildEmptyAuthority.js"), "utf8");
const handoff = fs.readFileSync(path.join(root, "http-generic-api/stagingRebuildEmptyHandoff.js"), "utf8");
const bundleBinding = fs.readFileSync(path.join(root, "http-generic-api/stagingRoleBundleBinding.js"), "utf8");
const bundleVerifier = fs.readFileSync(path.join(root, "http-generic-api/stagingRebuildBundleVerifier.js"), "utf8");
const adminRoutes = fs.readFileSync(path.join(root, "http-generic-api/routes/adminHostBreakglassRoutes.js"), "utf8");
const recoveryRoutes = fs.readFileSync(path.join(root, "http-generic-api/routes/recoverySystemToolOverlayRoutes.js"), "utf8");
const recoveryAdminRoutes = fs.readFileSync(path.join(root, "http-generic-api/routes/stagingRecoveryAdminRoutes.js"), "utf8");
const systemTools = fs.readFileSync(path.join(root, "http-generic-api/stagingRecoverySystemTools.js"), "utf8");
const localVerified = fs.readFileSync(path.join(root, "http-generic-api/scripts/host-breakglass-local-verified.mjs"), "utf8");
const localRunner = fs.readFileSync(path.join(root, "http-generic-api/scripts/host-breakglass-local.mjs"), "utf8");

assert.match(importer, /function Assert-EmptyRoleDatabases/u);
for (const surface of ["information_schema.TABLES", "information_schema.ROUTINES", "information_schema.TRIGGERS", "information_schema.EVENTS"]) assert.ok(importer.includes(surface) && entry.includes(surface), `${surface} must remain covered by root census surfaces`);
assert.match(entry, /information_schema\.VIEWS/u);
assert.match(entry, /TABLE_TYPE='BASE TABLE'/u);
assert.match(replay, /views: plan\.roles\[role\]\.views/u);
assert.match(importer, /Assert-SetEqual \$item\.ExpectedViews \$observedViews/u);
assert.match(entry, /classify-staging-empty-role-census\.mjs/u);
assert.match(entry, /prepare-staging-rebuild-empty-inspection\.mjs/u);
assert.match(entry, /--env-file \$envFile/u);
assert.match(entry, /\/admin\/system\/tools\/call/u);
for (const tool of ["staging_recovery_rebuild_empty_inspection_record", "staging_recovery_rebuild_empty_prepare", "staging_recovery_rebuild_empty_approve"]) assert.ok(entry.includes(tool) && systemTools.includes(tool) && recoveryRoutes.includes(tool));
assert.doesNotMatch(entry, /\/admin\/runtime-bootstrap\/staging\/rebuild-empty\/(?:inspection|prepare|approve)/u);
assert.match(entry, /host-breakglass-local-verified\.mjs/u);
assert.doesNotMatch(entry, /Clone-StagingDatabases\.ps1|Clone-StagingDatabases\.Legacy\.ps1|-Mode schema_only -Apply|staging-empty-governance-certification-seed\.sql/u);
assert.match(entry, /Legacy REBUILD_EMPTY_LOCAL_STAGING_DATABASES confirmation is retired/u);
assert.match(entry, /grants=not_applied runtime_certification=not_asserted gateway_apply_certification=pending next_action=database\.access_repair/u);
assert.doesNotMatch(entry, /Repair-StagingDatabaseReadiness|GrantConfirmation|RepairConfirmation/u);

assert.match(authority, /source: "durable_full_inspection"/u);
assert.match(authority, /selected_zero_object_roles/u);
assert.match(authority, /preserved_nonempty_roles/u);
assert.match(authority, /caller_role_selection_allowed: false/u);
assert.match(authority, /access_repair_separate: true/u);
assert.match(authority, /role_bundle_bindings/u);
assert.match(authority, /STAGING_REBUILD_EMPTY_INSPECTION_FINGERPRINT_MISMATCH/u);
assert.match(authority, /control_plane_target_fingerprint/u);
assert.match(authority, /database_target_fingerprint/u);
assert.match(authority, /idempotency_key: idempotencyKey/u);
assert.match(authority, /approved_idempotency_key/u);
assert.match(handoff, /verified_local_execution_transport_only|buildVerifiedHostBreakglassLocalRequest/u);
assert.match(bundleBinding, /computeStagingRoleBundleBindings/u);
assert.match(bundleBinding, /validateSchemaBundleManifest/u);
assert.match(bundleBinding, /statementFingerprints/u);
assert.match(bundleVerifier, /verifyExecutionTicket/u);
assert.match(bundleVerifier, /role_bundle_bindings/u);
assert.match(bundleVerifier, /ticket_role_bundle_bindings_verified/u);
assert.match(adminRoutes, /STAGING_REBUILD_EMPTY_RECOVERY_SYSTEM_TOOL_REQUIRED/u);
assert.doesNotMatch(adminRoutes, /\/admin\/runtime-bootstrap\/staging\/rebuild-empty\/(?:inspection|prepare|approve|ticket-bundle-verify)/u);
assert.match(recoveryAdminRoutes, /\/admin\/recovery\/staging\/bootstrap-ticket\/bundle-verify/u);
assert.match(localVerified, /proofResolver: \(\) => durableProof/u);
assert.match(localVerified, /computeStagingRoleBundleBindings/u);
assert.match(localVerified, /\/admin\/recovery\/staging\/bootstrap-ticket\/bundle-verify/u);
assert.match(localVerified, /ticket_role_bundle_bindings_verified/u);
assert.ok(localVerified.indexOf("await verifySelectiveRoleBundles") < localVerified.indexOf("spawnSync(process.execPath, [LEGACY_RUNNER"));
assert.match(localRunner, /HOST_BREAKGLASS_ROLE_BUNDLE_VERIFICATION !== "ticket_role_bundle_bindings_verified"/u);
assert.match(localRunner, /verifyPreservedRolesAfterSelectiveRebuild/u);
assert.match(localRunner, /preserved_roles_unchanged: true/u);
assert.match(localRunner, /RECOVERY_PRESERVED_ROLE_CHANGED/u);
assert.match(localRunner, /BOOTSTRAP_ROLE_OBJECT_COUNT_FINGERPRINTS: plan\.role_selection_proof \? JSON\.stringify\(plan\.role_selection_proof\)/u);
assert.match(localRunner, /BOOTSTRAP_PLAN_SHA256: authorityPlanHash/u);
console.log("Staging mixed-topology selective rebuild Recovery authority, target binding, handoff and preservation contracts passed");
