#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(HERE, "..", ".github", "workflows", "spec-kit-work-map-autofix.yml");
const producerPath = path.join(HERE, "scripts", "spec014-refresh-final-work-map-binding.mjs");
const maintenancePath = path.join(HERE, "scripts", "maintenance-tools", "generated-artifact-refresh.mjs");
const publisherPath = path.join(HERE, "scripts", "generated-artifact-refresh-pr-publisher.mjs");
const generatorPath = path.join(HERE, "scripts", "platform-work-map-generator.mjs");
const supervisorRunbookPath = path.resolve(HERE, "..", "docs", "runbooks", "supervisor-runtime-assurance.md");
const maintenanceGovernancePath = path.resolve(HERE, "..", ".github", "repository-maintenance-tool-governance.json");
const overlapPolicyPath = path.join(HERE, "scripts", "taxonomy", "automation-overlap-policy.json");
const workflow = fs.readFileSync(workflowPath, "utf8");
const producer = fs.readFileSync(producerPath, "utf8");
const maintenance = fs.readFileSync(maintenancePath, "utf8");
const publisher = fs.readFileSync(publisherPath, "utf8");
const generator = fs.readFileSync(generatorPath, "utf8");
const supervisorRunbook = fs.readFileSync(supervisorRunbookPath, "utf8");
const maintenanceGovernance = JSON.parse(fs.readFileSync(maintenanceGovernancePath, "utf8"));
const overlapPolicy = JSON.parse(fs.readFileSync(overlapPolicyPath, "utf8"));

const hostingerManifest = "specs/014-governed-hostinger-storage-orchestration/work-map-integration.json";
const hostingerTasks = "specs/014-governed-hostinger-storage-orchestration/tasks.md";
const retailManifest = "specs/014-retail-commerce-operations-growth-os/work-map-integration.json";
const runtimeIntegrityManifest = "specs/018-environment-promotion-runtime-integrity/work-map-integration.json";
const databaseLifecycleManifest = "specs/019-governed-database-lifecycle-pressure-relief/work-map-integration.json";
const dynamicManifestPattern = "specs/[0-9][0-9][0-9]-[a-z0-9][a-z0-9-]*/work-map-integration.json";

assert.match(workflow, /node http-generic-api\/scripts\/platform-work-map-generator\.mjs --write/u);
assert.match(workflow, /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs\s*$/mu);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 014-retail-commerce-operations-growth-os/u,
);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 018-environment-promotion-runtime-integrity/u,
);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 019-governed-database-lifecycle-pressure-relief/u,
);
assert.match(workflow, /node http-generic-api\/scripts\/platform-work-map-generator\.mjs --check/u);
assert.match(workflow, /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --check/u);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 014-retail-commerce-operations-growth-os --check/u,
);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 018-environment-promotion-runtime-integrity --check/u,
);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 019-governed-database-lifecycle-pressure-relief --check/u,
);

for (const governedPath of [hostingerManifest, hostingerTasks, retailManifest, runtimeIntegrityManifest, databaseLifecycleManifest]) {
  assert.ok(workflow.includes(governedPath), `writer allowlist/staging must include ${governedPath}`);
  assert.ok(maintenance.includes(governedPath), `self-hosting maintenance must include ${governedPath}`);
}
assert.ok(
  publisher.includes(runtimeIntegrityManifest),
  "trusted generated-artifact evidence publisher must accept the Spec018 integration manifest output",
);
assert.ok(
  publisher.includes(databaseLifecycleManifest),
  "trusted generated-artifact evidence publisher must accept the Spec019 integration manifest output",
);
assert.ok(
  generator.includes(runtimeIntegrityManifest),
  "generated README source must declare the Spec018 integration manifest in the bounded writer set",
);
assert.ok(
  generator.includes(databaseLifecycleManifest),
  "generated README source must declare the Spec019 integration manifest in the bounded writer set",
);
assert.ok(
  supervisorRunbook.includes(runtimeIntegrityManifest),
  "supervisor runbook must declare the Spec018 integration manifest in the bounded writer set",
);
assert.ok(
  supervisorRunbook.includes(databaseLifecycleManifest),
  "supervisor runbook must declare the Spec019 integration manifest in the bounded writer set",
);

assert.match(
  workflow,
  /pulls\/\$\{actual_pr_number\}\/files\?per_page=100/u,
  "target PR files API must remain a fail-closed completeness cross-check",
);
assert.ok(
  workflow.includes('target_pr_meta="${RUNNER_TEMP}/work-map-autofix-target-pr-meta.json"'),
  "target PR exact metadata must be fetched before file inventory discovery",
);
assert.ok(
  workflow.includes('gh api --method GET "repos/${GITHUB_REPOSITORY}/pulls/${actual_pr_number}" > "${target_pr_meta}"'),
  "target PR metadata fetch must use the exact resolved pull request endpoint",
);
assert.ok(
  workflow.includes('test "$(jq -r \'\.head.sha\' "${target_pr_meta}")" = "${EXPECTED_HEAD_SHA}"'),
  "exact PR metadata must bind the inventory to expected_head_sha",
);
assert.ok(
  workflow.includes('expected_base_sha="$(jq -er \'\.base.sha\' "${target_pr_meta}")"'),
  "the immutable PR base SHA must come from the same exact metadata snapshot",
);
assert.ok(
  workflow.includes('[[ "${expected_base_sha}" =~ ^[0-9a-f]{40}$ ]]'),
  "the immutable PR base SHA must be a full lowercase commit SHA",
);
assert.ok(
  workflow.includes('expected_changed_files="$(jq -er \'\.changed_files\' "${target_pr_meta}")"'),
  "target PR changed_files must come from exact PR metadata",
);
assert.ok(
  workflow.includes('if (( expected_changed_files > 3000 )); then'),
  "target PRs above GitHub's 3000-file API completeness cap must fail closed",
);
assert.ok(
  workflow.includes('git cat-file -e "${expected_base_sha}^{commit}"'),
  "the immutable base commit object must exist locally before inventory derivation",
);
assert.ok(
  workflow.includes('git cat-file -e "${EXPECTED_HEAD_SHA}^{commit}"'),
  "the authorized exact-head commit object must exist locally before inventory derivation",
);
assert.ok(
  workflow.includes('git diff --name-only --find-renames "${expected_base_sha}...${EXPECTED_HEAD_SHA}"'),
  "target binding authority must derive from the immutable exact-base/exact-head three-dot Git diff",
);
assert.ok(
  workflow.includes('immutable_changed_files="$(wc -l < "${immutable_target_pr_files}" | tr -d \'[:space:]\')"'),
  "the immutable Git inventory must be counted",
);
assert.ok(
  workflow.includes('if [[ "${immutable_changed_files}" != "${expected_changed_files}" ]]; then'),
  "the immutable Git inventory count must equal exact PR changed_files",
);
assert.match(
  workflow,
  /gh api --paginate [^\n]+ --jq '\.\[\]\.filename' > "\$\{target_pr_files_api\}"/u,
  "target PR file API cross-check must write output directly so API/auth/pagination failures remain fatal",
);
assert.doesNotMatch(
  workflow,
  /gh api --paginate[^\n]*(?:\n[^\n]*){0,3}\|\| true/u,
  "target PR API discovery must never mask failures with blanket || true",
);
assert.ok(
  workflow.includes('fetched_changed_files="$(wc -l < "${target_pr_files_api}" | tr -d \'[:space:]\')"'),
  "target PR file API cross-check must count successfully fetched filenames",
);
assert.ok(
  workflow.includes('if [[ "${fetched_changed_files}" != "${expected_changed_files}" ]]; then'),
  "target PR API filename count must equal exact PR changed_files",
);
assert.ok(
  workflow.includes('sort -u "${target_pr_files_api}" > "${target_pr_files_api_sorted}"'),
  "target PR API filenames must be normalized before exact-set comparison",
);
assert.ok(
  workflow.includes('if ! cmp -s "${immutable_target_pr_files}" "${target_pr_files_api_sorted}"; then'),
  "mutable PR-files API results must exactly match the immutable Git inventory before delegation",
);
assert.ok(
  workflow.includes('target_pr_meta_after="${RUNNER_TEMP}/work-map-autofix-target-pr-meta-after.json"'),
  "target PR metadata must be re-read after API pagination",
);
assert.ok(
  workflow.includes('test "$(jq -r \'\.head.sha\' "${target_pr_meta_after}")" = "${EXPECTED_HEAD_SHA}"'),
  "post-pagination metadata must still bind to expected_head_sha",
);
assert.ok(
  workflow.includes('test "$(jq -r \'\.base.sha\' "${target_pr_meta_after}")" = "${expected_base_sha}"'),
  "post-pagination metadata must retain the immutable base SHA",
);
assert.ok(
  workflow.includes('test "$(jq -er \'\.changed_files\' "${target_pr_meta_after}")" = "${expected_changed_files}"'),
  "post-pagination metadata must retain changed_files",
);
assert.ok(
  workflow.includes('awk \'/^specs\\/[0-9]{3}-[^/]+\\/work-map-integration\\.json$/\' "${immutable_target_pr_files}"'),
  "target-derived candidates must come only from the immutable Git inventory",
);
assert.doesNotMatch(
  workflow,
  /awk '\^?\/\^specs[^\n]*"\$\{target_pr_files_api\}"/u,
  "the mutable API inventory must never directly grant target-derived binding authority",
);
assert.ok(
  workflow.includes('^specs/([0-9]{3}-[a-z0-9][a-z0-9-]*)/work-map-integration\\.json$'),
  "target binding feature keys must use the canonical producer-compatible lowercase/hyphen syntax",
);
assert.match(workflow, /manifest_feature_key="\$\(jq -er '\.feature_key' "\$\{binding_path\}"\)"/u);
assert.match(workflow, /review_state="\$\(jq -er '\.review_state' "\$\{binding_path\}"\)"/u);
assert.match(workflow, /test "\$\{manifest_feature_key\}" = "\$\{feature_key\}"/u);
assert.match(workflow, /test "\$\{review_state\}" = "ready_for_implementation"/u);
const metadataIndex = workflow.indexOf('gh api --method GET "repos/${GITHUB_REPOSITORY}/pulls/${actual_pr_number}" > "${target_pr_meta}"');
const capIndex = workflow.indexOf("if (( expected_changed_files > 3000 )); then");
const immutableInventoryIndex = workflow.indexOf('git diff --name-only --find-renames "${expected_base_sha}...${EXPECTED_HEAD_SHA}"');
const immutableCompletenessIndex = workflow.indexOf('if [[ "${immutable_changed_files}" != "${expected_changed_files}" ]]; then');
const discoveryIndex = workflow.indexOf('gh api --paginate "repos/${GITHUB_REPOSITORY}/pulls/${actual_pr_number}/files?per_page=100"');
const apiCompletenessIndex = workflow.indexOf('if [[ "${fetched_changed_files}" != "${expected_changed_files}" ]]; then');
const setEqualityIndex = workflow.indexOf('if ! cmp -s "${immutable_target_pr_files}" "${target_pr_files_api_sorted}"; then');
const metadataRereadIndex = workflow.indexOf('target_pr_meta_after="${RUNNER_TEMP}/work-map-autofix-target-pr-meta-after.json"');
const candidateIndex = workflow.indexOf('"${immutable_target_pr_files}" \\\n            | sort -u > "${target_binding_candidates}"');
const eligibilityIndex = workflow.indexOf('manifest_feature_key="$(jq -er \'\.feature_key\' "${binding_path}")"');
const consumeIndex = workflow.indexOf("- name: Verify and consume Recovery-issued writer delegation");
assert.ok(metadataIndex >= 0 && capIndex > metadataIndex, "3000-file cap must follow exact PR metadata fetch");
assert.ok(immutableInventoryIndex > capIndex, "immutable Git inventory must be derived only after metadata and cap validation");
assert.ok(immutableCompletenessIndex > immutableInventoryIndex, "immutable inventory count must be validated after exact-SHA diff derivation");
assert.ok(discoveryIndex > immutableCompletenessIndex, "mutable API enumeration must be only a cross-check after immutable authority is established");
assert.ok(apiCompletenessIndex > discoveryIndex, "API inventory completeness must be checked after successful enumeration");
assert.ok(setEqualityIndex > apiCompletenessIndex, "API and immutable filename sets must be compared only after both counts are complete");
assert.ok(metadataRereadIndex > setEqualityIndex, "metadata must be re-read after API pagination and exact-set verification");
assert.ok(candidateIndex > metadataRereadIndex, "binding candidates must derive from immutable inventory only after all cross-checks pass");
assert.ok(eligibilityIndex > candidateIndex, "manifest eligibility must follow immutable exact-head candidate derivation");
assert.ok(consumeIndex > eligibilityIndex, "all immutable inventory, API cross-check, metadata reread, and manifest eligibility checks must complete before delegation consumption");
assert.match(workflow, /TARGET_BINDING_FILE/u);
assert.match(workflow, /feature_key="\$\{BASH_REMATCH\[1\]\}"/u);
assert.match(
  workflow,
  /spec014-refresh-final-work-map-binding\.mjs --feature-key "\$\{feature_key\}"/u,
  "the canonical binding producer must refresh every target-derived feature key",
);
assert.match(
  workflow,
  /grep -Fxq "\$\{changed_file\}" "\$\{TARGET_BINDING_FILE\}"/u,
  "dynamic write authority must be bounded by the discovered target manifest set",
);
assert.match(workflow, /target_binding_paths=\(\)/u);
assert.match(workflow, /git add -- "\$\{target_binding_paths\[@\]\}"/u);
assert.doesNotMatch(workflow, /inputs\.(?:feature_key|binding_path|work_map_manifest)/u);
assert.match(
  workflow,
  /014-governed-hostinger-storage-orchestration\|014-retail-commerce-operations-growth-os\|018-environment-promotion-runtime-integrity\|019-governed-database-lifecycle-pressure-relief\) continue/u,
  "registered static bindings must be excluded from target-derived replay",
);

assert.match(workflow, /first_diff_hash=/u);
assert.match(workflow, /second_diff_hash=/u);
assert.match(workflow, /test "\$\{first_diff_hash\}" = "\$\{second_diff_hash\}"/u);
assert.match(workflow, /git add -- docs\/work-maps/u);
assert.doesNotMatch(workflow, /git push[^\n]*(?:--force|-f)(?:\s|$)/u);
assert.match(workflow, /remote_head_sha=.*git ls-remote/u);
assert.match(workflow, /test "\$\{remote_head_sha\}" = "\$\{EXPECTED_HEAD_SHA\}"/u);

assert.match(maintenance, /refresh_runtime_integrity_spec018_binding/u);
assert.match(maintenance, /verify_runtime_integrity_spec018_binding_current/u);
assert.match(maintenance, /018-environment-promotion-runtime-integrity/u);
assert.match(maintenance, /refresh_database_lifecycle_spec019_binding/u);
assert.match(maintenance, /verify_database_lifecycle_spec019_binding_current/u);
assert.match(maintenance, /019-governed-database-lifecycle-pressure-relief/u);
assert.doesNotMatch(maintenance, /"git", \["push"[^\n]*(?:"--force"|"-f")/u);

const maintenanceRegistration = maintenanceGovernance.tools?.["generated-artifact-refresh"];
assert.ok(maintenanceRegistration, "generated-artifact-refresh maintenance registration is required");
assert.ok(
  maintenanceRegistration.allowed_changed_path_patterns?.includes(
    "^specs/018-environment-promotion-runtime-integrity/work-map-integration\\.json$",
  ),
  "maintenance governance must register the Spec018 integration manifest output",
);
assert.ok(
  maintenanceRegistration.allowed_changed_path_patterns?.includes(
    "^specs/019-governed-database-lifecycle-pressure-relief/work-map-integration\\.json$",
  ),
  "maintenance governance must register the Spec019 integration manifest output",
);

const writerOwnership = overlapPolicy.resource_groups?.find(
  (group) => group.key === "pull-request-work-map-generated-artifacts",
);
assert.ok(writerOwnership, "Work Map writer ownership group is required");
assert.ok(
  writerOwnership.write_patterns?.includes(runtimeIntegrityManifest),
  "automation overlap policy must assign Spec018 to the sole Work Map writer",
);
assert.ok(
  writerOwnership.write_patterns?.includes(databaseLifecycleManifest),
  "automation overlap policy must assign Spec019 to the sole Work Map writer",
);
assert.ok(
  writerOwnership.write_patterns?.includes(dynamicManifestPattern),
  "automation overlap policy must register producer-compatible target-derived Work Map manifest authority",
);
assert.ok(
  supervisorRunbook.includes(dynamicManifestPattern),
  "supervisor runbook must register the same target-derived Work Map manifest authority",
);
assert.ok(
  supervisorRunbook.includes("immutable exact-base/exact-head Git inventory"),
  "supervisor runbook must document immutable exact-head inventory authority",
);
assert.ok(
  generator.includes(dynamicManifestPattern),
  "generated README source must register the same target-derived Work Map manifest authority",
);

assert.match(producer, /const DEFAULT_FEATURE_KEY = "014-governed-hostinger-storage-orchestration"/u);
assert.match(producer, /--feature-key/u);
assert.match(producer, /--check/u);
assert.match(producer, /\^\[a-z0-9\]\[a-z0-9-\]\*\$/u);
assert.match(producer, /manifest\.feature_key !== featureKey \|\| manifest\.review_state !== "ready_for_implementation"/u);
assert.match(producer, /classification_coverage_percent !== 100/u);
assert.match(producer, /effectiveRegistry\.maps\.length !== 19/u);
assert.match(producer, /effectiveRegistry\.domains\.length !== 16/u);
assert.match(producer, /provider_dispatch: false/u);
assert.match(producer, /live_database_access: false/u);
assert.match(producer, /migration_apply: false/u);
assert.match(producer, /secrets_included: false/u);

console.log(JSON.stringify({
  contract: "mad4b.work-map-autofix-spec014-binding-convergence-test.v1",
  ok: true,
  combined_idempotency: true,
  runtime_integrity_binding_convergence: true,
  database_lifecycle_binding_convergence: true,
  target_pr_binding_discovery: true,
  target_pr_file_discovery_fail_closed: true,
  target_pr_file_cap_guard: true,
  target_pr_file_inventory_complete: true,
  target_pr_inventory_authority: "immutable_exact_head_git_diff",
  target_pr_api_inventory_cross_check: true,
  target_pr_inventory_exact_set_match: true,
  target_pr_post_pagination_metadata_reread: true,
  target_pr_binding_producer_eligibility_predelegation: true,
  target_pr_binding_write_set_bounded: true,
  target_pr_dynamic_writer_scope_registered: true,
  static_binding_replay_excluded: true,
  self_hosting_maintenance_convergence: true,
  maintenance_governance_registered: true,
  publisher_scope_registered: true,
  overlap_ownership_registered: true,
  generated_readme_source_contract_registered: true,
  supervisor_runbook_contract_registered: true,
  exact_head_push: true,
  force_push: false,
  protected_branch_mutation: false,
  provider_dispatch: false,
  live_database_access: false,
  migration_apply: false,
  secrets_included: false,
}));
