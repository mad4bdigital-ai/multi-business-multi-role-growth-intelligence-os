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

for (const governedPath of [hostingerManifest, hostingerTasks, retailManifest, runtimeIntegrityManifest]) {
  assert.ok(workflow.includes(governedPath), `writer allowlist/staging must include ${governedPath}`);
  assert.ok(maintenance.includes(governedPath), `self-hosting maintenance must include ${governedPath}`);
}
assert.ok(
  publisher.includes(runtimeIntegrityManifest),
  "trusted generated-artifact evidence publisher must accept the Spec018 integration manifest output",
);
assert.ok(
  generator.includes(runtimeIntegrityManifest),
  "generated README source must declare the Spec018 integration manifest in the bounded writer set",
);
assert.ok(
  supervisorRunbook.includes(runtimeIntegrityManifest),
  "supervisor runbook must declare the Spec018 integration manifest in the bounded writer set",
);

assert.match(
  workflow,
  /pulls\/\$\{actual_pr_number\}\/files\?per_page=100/u,
  "target binding discovery must come from the exact resolved pull request",
);
assert.match(
  workflow,
  /\^specs\/\[0-9\]\{3\}-\[A-Za-z0-9\._-\]\+\/work-map-integration\\\.json\$/u,
  "target binding discovery must remain restricted to safe Spec feature integration manifests",
);
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
  /014-governed-hostinger-storage-orchestration\|014-retail-commerce-operations-growth-os\|018-environment-promotion-runtime-integrity\) continue/u,
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
assert.doesNotMatch(maintenance, /"git", \["push"[^\n]*(?:"--force"|"-f")/u);

const maintenanceRegistration = maintenanceGovernance.tools?.["generated-artifact-refresh"];
assert.ok(maintenanceRegistration, "generated-artifact-refresh maintenance registration is required");
assert.ok(
  maintenanceRegistration.allowed_changed_path_patterns?.includes(
    "^specs/018-environment-promotion-runtime-integrity/work-map-integration\\.json$",
  ),
  "maintenance governance must register the Spec018 integration manifest output",
);

const writerOwnership = overlapPolicy.resource_groups?.find(
  (group) => group.key === "pull-request-work-map-generated-artifacts",
);
assert.ok(writerOwnership, "Work Map writer ownership group is required");
assert.ok(
  writerOwnership.write_patterns?.includes(runtimeIntegrityManifest),
  "automation overlap policy must assign Spec018 to the sole Work Map writer",
);

assert.match(producer, /const DEFAULT_FEATURE_KEY = "014-governed-hostinger-storage-orchestration"/u);
assert.match(producer, /--feature-key/u);
assert.match(producer, /--check/u);
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
  target_pr_binding_discovery: true,
  target_pr_binding_write_set_bounded: true,
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
