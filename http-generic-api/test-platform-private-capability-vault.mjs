import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLATFORM_PRIVATE_CAPABILITY_VAULT_GUARDRAILS,
  buildCapabilityMirrorPlan,
  buildInstallRequestPlan,
  buildReinstallDiffPlan,
  buildRepoIngestionPlan,
  buildSanitizedPackagePlan,
  buildVariantPatchPlan,
  buildVariantMergePlan,
  classifyCapabilityAsset,
  extractGoogleFileId,
  resolveCapabilityRuntime,
  resolveGoogleFileReadDecision,
} from "./platformPrivateCapabilityVault.js";

const migration = readFileSync(new URL("./migrations/189_sprint66_platform_private_capability_vault.sql", import.meta.url), "utf8");
const routesIndex = readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/platformPrivateCapabilityVaultRoutes.js", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");
const docs = readFileSync(new URL("../docs/platform-private-capability-vault.md", import.meta.url), "utf8");

assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_source_registry"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_ingestion_jobs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_snapshots"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_snapshot_files"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_candidate_assets"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_skill_candidates"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_capability_candidates"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_install_requests"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_certification_runs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_private_repo_mirrors"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_private_packages"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_private_package_assets"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_package_versions"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_install_diff_runs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS repo_install_diff_items"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS asset_equivalence_groups"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS tenant_package_installs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_package_variants"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_package_variant_patches"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_variant_merge_runs"));
assert(migration.includes("CREATE TABLE IF NOT EXISTS platform_capability_source_resolutions"));
assert(migration.includes("platform_private_capability_vault_engine"));
assert(migration.includes("platform_capability_vault_google_file_read_resolve"));
assert(migration.includes("supportsAllDrives"));
assert(migration.includes("web_url_fetch_allowed TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("executed_by_runtime TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("tenant_overrides_preserved TINYINT(1) NOT NULL DEFAULT 1"));
for (const destructiveSql of [/^\s*DROP\s+TABLE\b/mi, /^\s*TRUNCATE\s+TABLE\b/mi, /^\s*DELETE\s+FROM\b/mi]) {
  assert(!destructiveSql.test(migration), `capability vault migration must not include destructive SQL statement ${destructiveSql}`);
}

assert(routesIndex.includes("buildPlatformPrivateCapabilityVaultRoutes"));
assert(routes.includes('router.post("/platform/capability-vault/repo-ingestion-plan"'));
assert(routes.includes('router.post("/platform/capability-vault/package-plan"'));
assert(routes.includes('router.post("/platform/capability-vault/reinstall-diff-plan"'));
assert(routes.includes('router.post("/platform/capability-vault/google-file-read/resolve"'));
assert(routes.includes('router.post("/platform/capability-vault/install-request-plan"'));
assert(routes.includes('router.post("/platform/capability-vault/variant-merge-plan"'));
assert(!/router\.(delete|put|patch)\(/.test(routes), "capability vault routes must expose read/plan surfaces only in this phase");
assert(openapi.includes("/platform/capability-vault/repo-ingestion-plan"));
assert(openapi.includes("/platform/capability-vault/package-plan"));
assert(openapi.includes("/platform/capability-vault/reinstall-diff-plan"));
assert(openapi.includes("/platform/capability-vault/google-file-read/resolve"));
assert(openapi.includes("/platform/capability-vault/install-request-plan"));
assert(openapi.includes("/platform/capability-vault/variant-merge-plan"));
assert(openapi.includes("operationId: platformCapabilityVaultGoogleFileReadResolve"));
assert(docs.includes("Platform Private Capability Vault"));
assert(docs.includes("Google file reading is one adapter"));

assert.equal(PLATFORM_PRIVATE_CAPABILITY_VAULT_GUARDRAILS.raw_mirror_never_executed, true);
assert.equal(PLATFORM_PRIVATE_CAPABILITY_VAULT_GUARDRAILS.google_web_url_fetch_allowed, false);
assert.equal(PLATFORM_PRIVATE_CAPABILITY_VAULT_GUARDRAILS.google_drive_supports_all_drives_default, true);

assert.deepEqual(extractGoogleFileId({
  url: "https://docs.google.com/document/d/1-59-jUSf3Oo24StNRPtSHtfgx9-HDiI_hMFN1GHixVg/edit",
}).file_id, "1-59-jUSf3Oo24StNRPtSHtfgx9-HDiI_hMFN1GHixVg");
assert.equal(extractGoogleFileId({
  url: "https://drive.google.com/open?id=1LHkBMwzjBaG1fwoYS1uioy6LmFwZ616jm8ogHPaqR6U",
}).file_id, "1LHkBMwzjBaG1fwoYS1uioy6LmFwZ616jm8ogHPaqR6U");

const googleDecision = resolveGoogleFileReadDecision({
  url: "https://docs.google.com/document/d/1-59-jUSf3Oo24StNRPtSHtfgx9-HDiI_hMFN1GHixVg/edit",
  metadata: {
    name: "Session Transcript",
    mimeType: "application/vnd.google-apps.document",
  },
  drive_jsonl_id: "jsonl_1234567890",
});
assert.equal(googleDecision.ok, true);
assert.equal(googleDecision.detected_product, "google_docs");
assert.equal(googleDecision.metadata_probe.supportsAllDrives, true);
assert.equal(googleDecision.web_url_fetch_allowed, false);
assert.equal(googleDecision.diagnostics.web_url_fetch_allowed, false);
assert.equal(googleDecision.read_strategy, "drive_jsonl_chunked");
assert.equal(googleDecision.fallback_strategy, "docs_api_chunked");
assert.equal(googleDecision.selected_file_id, "jsonl_1234567890");
assert.equal(googleDecision.will_execute, false);

assert.equal(classifyCapabilityAsset({ path: "seo/SKILL.md" }).runtime_import_allowed, true);
assert.equal(classifyCapabilityAsset({ path: "references/guide.md" }).asset_type, "reference");
assert.equal(classifyCapabilityAsset({ path: ".github/workflows/test.yml" }).import_status, "blocked_evidence_only");
assert.equal(classifyCapabilityAsset({ path: "scripts/install.sh" }).runtime_import_allowed, false);
assert.equal(classifyCapabilityAsset({ path: ".mcp.json" }).import_status, "blocked_evidence_only");

const mirrorPlan = buildCapabilityMirrorPlan({
  source_repo_full_name: "mad4bdigital-ai/seo-geo-claude-skills",
  source_commit_sha: "abc123",
});
assert.equal(mirrorPlan.ok, true);
assert.equal(mirrorPlan.raw_mirror_immutable, true);
assert.equal(mirrorPlan.executed_by_runtime, false);

const packagePlan = buildSanitizedPackagePlan({
  package_key: "seo_geo_claude_skills",
  package_type: "skill_pack",
  license_spdx: "MIT",
  files: [
    { path: "seo/SKILL.md", size_bytes: 1200 },
    { path: "references/checklist.md", size_bytes: 800 },
    { path: ".github/workflows/ci.yml", size_bytes: 500 },
    { path: "scripts/install.sh", size_bytes: 300, executable: true },
  ],
});
assert.equal(packagePlan.ok, false);
assert.equal(packagePlan.summary.safe_assets, 2);
assert.equal(packagePlan.summary.blocked_assets, 2);
assert.equal(packagePlan.auto_install_allowed, false);
assert(packagePlan.blockers.includes("runtime_or_executable_assets_block_auto_install"));
assert.equal(packagePlan.blocked_asset_manifest.some((asset) => asset.source_path === "scripts/install.sh"), true);

const safePackagePlan = buildSanitizedPackagePlan({
  package_key: "safe_skill_pack",
  package_type: "skill_pack",
  license_spdx: "MIT",
  files: [
    { path: "content/SKILL.md", size_bytes: 1200 },
    { path: "references/checklist.md", size_bytes: 800 },
  ],
});
assert.equal(safePackagePlan.ok, true);
assert.equal(safePackagePlan.auto_install_allowed, true);
assert.equal(safePackagePlan.certification_status, "certification_ready");

const diffPlan = buildReinstallDiffPlan({
  package_key: "safe_skill_pack",
  tenant_id: "tenant-1",
  current_version: "v1",
  incoming_version: "v2",
  existing_assets: [{ path: "content/SKILL.md", normalized_hash: "old", size_bytes: 10 }],
  incoming_assets: [{ path: "content/SKILL.md", normalized_hash: "new", size_bytes: 10 }],
});
assert.equal(diffPlan.reinstall_is_idempotent, true);
assert.equal(diffPlan.will_duplicate_install, false);
assert.equal(diffPlan.tenant_overrides_preserved, true);
assert.equal(diffPlan.decision, "safe_patch_available");
assert(diffPlan.reset_forbidden.includes("agent_grants"));

const blockedDiffPlan = buildReinstallDiffPlan({
  package_key: "unsafe_pack",
  incoming_assets: [{ path: "hooks/preinstall.sh", size_bytes: 10 }],
});
assert.equal(blockedDiffPlan.decision, "blocked_by_policy");
assert.equal(blockedDiffPlan.ok, false);

const variantPlan = buildVariantPatchPlan({
  package_id: "pkg1",
  base_package_version_id: "pkgv1",
  scope_type: "brand",
  scope_id: "brand-a",
  variant_key: "brand-a-voice",
  patches: [
    { target_asset_type: "prompt", target_asset_key: "tone", patch_type: "append" },
    { target_asset_type: "policy", target_asset_key: "approval", patch_type: "policy_change", narrows_policy: true },
  ],
});
assert.equal(variantPlan.ok, true);
assert.equal(variantPlan.lower_layers_cannot_open_upper_policy, true);

const expansionVariantPlan = buildVariantPatchPlan({
  package_id: "pkg1",
  base_package_version_id: "pkgv1",
  scope_type: "tenant",
  scope_id: "tenant-1",
  variant_key: "unsafe-expand",
  patches: [{ target_asset_type: "tool_binding", target_asset_key: "write_tool", patch_type: "policy_change", expands_policy: true }],
});
assert.equal(expansionVariantPlan.ok, false);
assert(expansionVariantPlan.blockers.includes("permission_or_tool_expansion_requires_approval"));

const runtimeResolution = resolveCapabilityRuntime({
  package_key: "safe_skill_pack",
  base_version: "v2",
  variants: [
    { variant_key: "tenant-safe", scope_type: "tenant", scope_id: "tenant-1" },
    { variant_key: "brand-safe", scope_type: "brand", scope_id: "brand-a" },
  ],
  task_overlay: { tone: "formal" },
});
assert.equal(runtimeResolution.ok, true);
assert.equal(runtimeResolution.dispatch_ready, true);
assert.equal(runtimeResolution.task_overlay_applied, true);
assert.equal(runtimeResolution.applied_variants.length, 2);

const blockedRuntimeResolution = resolveCapabilityRuntime({
  package_key: "safe_skill_pack",
  base_version: "v2",
  variants: [{ variant_key: "unsafe", requires_approval: true }],
});
assert.equal(blockedRuntimeResolution.dispatch_ready, false);
assert.equal(blockedRuntimeResolution.requires_approval, true);


const repoIngestionPlan = buildRepoIngestionPlan({
  source_repo_full_name: "mad4bdigital-ai/seo-geo-claude-skills",
  source_commit_sha: "b69ebc6",
  license_spdx: "Apache-2.0",
  description: "20 SEO & GEO skills for Claude Code",
  files: [
    { path: "research/keyword-research/SKILL.md", size_bytes: 7448 },
    { path: "references/skill-contract.md", size_bytes: 16166 },
    { path: "hooks/claude-hook.sh", size_bytes: 6939, executable: true },
  ],
});
assert.equal(repoIngestionPlan.classification.install_mode, "private_skill_import");
assert.equal(repoIngestionPlan.candidate_counts.skill_candidates, 1);
assert.equal(repoIngestionPlan.summary.blocked_assets, 1);
assert.equal(repoIngestionPlan.will_execute, false);

const installRequestPlan = buildInstallRequestPlan({
  package_key: "seo_geo_growth_skills",
  tenant_id: "tenant-1",
  package_plan: { auto_install_allowed: true, risk_class: "low", certification_status: "certification_ready" },
});
assert.equal(installRequestPlan.ok, true);
assert.equal(installRequestPlan.resolved_install_mode, "tenant_private_install");
assert.equal(installRequestPlan.will_write, false);

const blockedInstallRequestPlan = buildInstallRequestPlan({
  package_key: "decepticon",
  tenant_id: "tenant-1",
  auto_install_allowed: false,
  risk_class: "critical",
  certification_status: "blocked",
});
assert.equal(blockedInstallRequestPlan.ok, false);
assert(blockedInstallRequestPlan.blockers.includes("risk_class_requires_manual_approval"));

const variantMergePlan = buildVariantMergePlan({
  variant_id: "variant-1",
  old_base_version_id: "v1",
  new_base_version_id: "v2",
  variant_patches: [
    { target_asset_key: "seo_content_writer", target_asset_type: "prompt", patch_type: "append" },
  ],
  changed_base_assets: [
    { path: "seo_content_writer", canonical_skill_key: "seo_content_writer", normalized_hash: "new" },
  ],
});
assert.equal(variantMergePlan.ok, true);
assert.equal(variantMergePlan.merge_status, "auto_merged");
assert.equal(variantMergePlan.preserves_user_patches, true);

const blockedVariantMergePlan = buildVariantMergePlan({
  variant_id: "variant-2",
  old_base_version_id: "v1",
  new_base_version_id: "v2",
  variant_patches: [
    { target_asset_key: "publisher", target_asset_type: "tool_binding", patch_type: "policy_change", expands_policy: true },
  ],
});
assert.equal(blockedVariantMergePlan.ok, false);
assert.equal(blockedVariantMergePlan.merge_status, "blocked");

console.log("platform private capability vault contract tests passed");
