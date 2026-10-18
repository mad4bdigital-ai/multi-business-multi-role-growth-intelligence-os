#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { assertDocsOnlyPaths, inspectDocsOnlyGit } from "./scripts/maintenance-tools/work-map-docs-only-guard.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(HERE, "..", ".github", "workflows", "spec-kit-work-map-autofix.yml");
const validatorPath = path.join(HERE, "scripts", "spec-kit-work-map-integration-gate.mjs");
const policyPath = path.resolve(HERE, "..", ".specify", "spec-kit-work-map-integration-policy.json");

const workflow = fs.readFileSync(workflowPath, "utf8");
const validator = fs.readFileSync(validatorPath, "utf8");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));

assert.ok(policy.review_states.includes("ready_for_implementation"));
assert.match(
  validator,
  /const policyChanged = changedFiles\.some\(\(file\) => \[/u,
  "validator must retain an explicit policy/registry refresh trigger",
);
assert.match(
  validator,
  /file\.startsWith\(`\$\{normalizePath\(policy\.work_map_root\)\}\/`\)/u,
  "validator must expand registry refresh scope when generated Work Maps change",
);
assert.match(
  validator,
  /manifest\.review_state === "ready_for_implementation"\s*\|\|\s*!policy\.review_states\.includes\(manifest\.review_state\)/u,
  "validator must keep ready manifests and malformed review-state manifests in fail-closed registry refresh scope",
);
assert.match(
  validator,
  /manifest\.review_state === "draft"[\s\S]*manifest\.implementation_readiness\?\.status === "blocked"[\s\S]*manifest\.secrets_included === false/u,
  "validator must include only blocked, secret-free draft manifests for governance-only maintenance refresh",
);
assert.match(
  validator,
  /\.\.\.\(policyChanged \? registryRefreshFeatures : \[\]\)/u,
  "validator targets must include registry refresh features only when policyChanged is true",
);

for (const token of [
  "REGISTRY_REFRESH_BINDING_FILE",
  "WRITER_BINDING_FILE",
  "REGISTRY_REFRESH_REQUIRED",
  "registry_refresh_binding_candidates",
  "registry_refresh_binding_file",
  "registry_refresh_skipped_binding_file",
  "writer_binding_file",
  "generator_preview_file",
  "generator_preview_exit_code",
  "generator_preview_drift_count",
]) {
  assert.ok(workflow.includes(token), `autofix writer must expose ${token}`);
}

assert.ok(
  workflow.includes('policy_file=".specify/spec-kit-work-map-integration-policy.json"'),
  "writer scope must be derived from the same Work Map integration policy",
);
assert.ok(workflow.includes('spec_root="$(jq -er \'\.spec_root\' "${policy_file}")"'));
assert.ok(workflow.includes('work_map_root="$(jq -er \'\.work_map_root\' "${policy_file}")"'));
assert.ok(workflow.includes('manifest_filename="$(jq -er \'\.manifest_filename\' "${policy_file}")"'));
assert.ok(workflow.includes('template_filename="$(jq -er \'\.template_filename\' "${policy_file}")"'));
assert.ok(
  workflow.includes('policy_template_path=".specify/templates/${template_filename}"'),
  "writer must derive the template trigger from policy rather than hardcoding a feature",
);
assert.ok(workflow.includes('registry_refresh_required=false'));
assert.ok(workflow.includes('registry_refresh_check_dir="${DIAGNOSTIC_ROOT}/registry-refresh-checks"'));
assert.ok(workflow.includes('generator_drift_scope="${registry_refresh_required}"'));
assert.ok(workflow.includes('Stale Work Map registry binding'));
assert.ok(workflow.includes('"${changed_file}" = "${policy_file}"'));
assert.ok(workflow.includes('"${changed_file}" = "${policy_template_path}"'));
assert.ok(workflow.includes('"${changed_file}" = "http-generic-api/scripts/spec-kit-work-map-integration-gate.mjs"'));
assert.ok(workflow.includes('"${changed_file}" == "${work_map_root}/"*'));
assert.ok(
  workflow.includes('done < "${immutable_target_pr_files}"'),
  "static registry refresh triggers must come from immutable exact-base/exact-head Git inventory",
);

assert.ok(
  workflow.includes('generator_preview_file="${DIAGNOSTIC_ROOT}/platform-work-map-generator-preview.json"'),
  "writer must persist a bounded read-only generator preview before authority is consumed",
);
assert.ok(
  workflow.includes('node http-generic-api/scripts/platform-work-map-generator.mjs --check > "${generator_preview_file}"'),
  "writer must detect prospective generated Work Map drift without writing",
);
assert.ok(workflow.includes('generator_preview_exit_code=$?'));
assert.ok(
  workflow.includes('if [[ "${generator_preview_exit_code}" -ne 0 && "${generator_preview_exit_code}" -ne 1 ]]; then'),
  "only the generator's current and stale check exits may continue discovery",
);
assert.ok(
  workflow.includes('.mode == "check"')
    && workflow.includes('(.drift_files | type == "array")')
    && workflow.includes('.secrets_included == false')
    && workflow.includes('.image_assets_generated == false'),
  "prospective drift evidence must be structured, read-only, secret-free, and text-only",
);
assert.ok(
  workflow.includes("if jq -e '.drift_files | length > 0' \"${generator_preview_file}\" >/dev/null; then"),
  "prospective generated Work Map drift must expand registry refresh scope before delegation",
);

assert.ok(
  workflow.includes('git ls-files -- "${spec_root}/[0-9][0-9][0-9]-*/${manifest_filename}"'),
  "registry refresh candidates must come from tracked exact-head manifests",
);
assert.ok(
  workflow.includes('manifest_feature_key="$(jq -er \'\.feature_key\' "${binding_path}")"'),
  "every candidate must bind path identity to manifest feature_key",
);
assert.ok(
  workflow.includes('review_state="$(jq -er \'\.review_state\' "${binding_path}")"'),
  "every candidate must expose review_state before authority is granted",
);
assert.ok(
  workflow.includes(".review_states | index($review_state) != null"),
  "unrecognized review states must fail closed against policy.review_states",
);
assert.ok(
  workflow.includes('implementation_status="$(jq -er \'.implementation_readiness.status // ""\' "${binding_path}")"'),
  "writer must inspect implementation readiness before granting maintenance refresh scope",
);
assert.ok(
  workflow.includes('"${review_state}" = "draft" && "${implementation_status}" = "blocked" && "${secrets_included}" = "false"'),
  "only blocked, secret-free draft manifests may enter governance-only registry refresh scope",
);
assert.ok(
  workflow.includes('registry_refresh_skipped_binding_file')
    && workflow.includes('>> "${registry_refresh_skipped_binding_file}"')
    && workflow.includes('continue'),
  "ineligible draft manifests must be skipped with bounded evidence rather than gaining writer authority",
);
assert.ok(
  workflow.includes('"${review_state}" = "ready_for_implementation"'),
  "ready_for_implementation manifests must remain in registry refresh write scope",
);
assert.ok(
  workflow.includes('cat "${target_binding_file}" "${registry_refresh_binding_file}" | sort -u > "${writer_binding_file}"'),
  "writer scope must be the deterministic union of target-diff and registry-refresh manifests",
);

const discoveryIndex = workflow.indexOf('registry_refresh_required=false');
const previewIndex = workflow.indexOf('generator_preview_file="${DIAGNOSTIC_ROOT}/platform-work-map-generator-preview.json"');
const unionIndex = workflow.indexOf('cat "${target_binding_file}" "${registry_refresh_binding_file}" | sort -u > "${writer_binding_file}"');
const consumeIndex = workflow.indexOf("- name: Verify and consume Recovery-issued writer delegation");
assert.ok(discoveryIndex >= 0 && previewIndex > discoveryIndex, "prospective drift discovery must follow immutable PR trigger discovery");
assert.ok(unionIndex > previewIndex, "prospective drift discovery must finish before writer union is created");
assert.ok(consumeIndex > unionIndex, "all writer authority discovery must finish before delegation consumption");

const writerLoopMatches = workflow.match(/done < "\$\{WRITER_BINDING_FILE\}"/gu) || [];
assert.ok(writerLoopMatches.length >= 3, "generation, verification, and publish must consume the unified writer binding set");
assert.match(
  workflow,
  /grep -Fxq "\$\{changed_file\}" "\$\{TARGET_BINDING_FILE\}"/u,
  "original PR-diff authority must remain an explicit bounded-write source",
);
assert.match(
  workflow,
  /grep -Fxq "\$\{changed_file\}" "\$\{REGISTRY_REFRESH_BINDING_FILE\}"/u,
  "registry-refresh authority must be an explicit bounded-write source",
);
assert.match(workflow, /target_binding_paths=\(\)/u);
assert.match(workflow, /git add -- "\$\{target_binding_paths\[@\]\}"/u);

assert.doesNotMatch(
  workflow,
  /020-platform-resource-identity-brand-governance|021-portable-staging-autopilot/u,
  "structural repair must never hardcode the two manifests that happened to expose the scope mismatch",
);
assert.doesNotMatch(workflow, /git push[^\n]*(?:--force|-f)(?:\s|$)/u);
assert.match(workflow, /test "\$\{remote_head_sha\}" = "\$\{EXPECTED_HEAD_SHA\}"/u);

console.log("Work Map autofix registry-refresh scope regression tests passed.");

// Exact-head docs-only delegated writer contract and real Git delta regression.
const recoveryWorkflow = fs.readFileSync(path.resolve(HERE, "..", ".github", "workflows", "spec-kit-work-map-autofix-recovery-dispatch.yml"), "utf8");
assert.ok(recoveryWorkflow.includes("write_scope:$write_scope"), "Recovery must carry scope into the dispatch payload");
assert.ok(recoveryWorkflow.includes("work-map-autofix:authorized docs_only {0}"), "docs-only owner marker must carry exact SHA");
assert.ok(recoveryWorkflow.includes("inputs.expected_head_sha"), "docs-only marker must bind owner approval to exact head");
assert.ok(recoveryWorkflow.includes("write_scope=${WRITE_SCOPE} authorization_consumed=true"), "Recovery must bind scope to its one-time grant");
assert.ok(recoveryWorkflow.includes('--arg scope "${WRITE_SCOPE}"'), "Retry must provide the requested write scope to grant lookup");
assert.ok(recoveryWorkflow.includes('contains(" write_scope=" + $scope + " ")'), "Retry must never restore a different-scope writer grant");
assert.ok(recoveryWorkflow.includes('write_scope:$write_scope,behind_by:$behind_by'), "Recovery report must bind audited scope");
assert.ok(workflow.includes("write_scope=${WRITE_SCOPE} authorization_consumed=true"), "Writer must verify exact delegated scope");
assert.ok(workflow.includes('node http-generic-api/scripts/maintenance-tools/work-map-docs-only-guard.mjs --expected-head-sha "${EXPECTED_HEAD_SHA}"'));
assert.ok(workflow.includes('if [[ "${WRITE_SCOPE}" == "docs_only" ]]; then'));
assert.doesNotThrow(() => assertDocsOnlyPaths(["docs/work-maps/README.md", "docs/work-maps/repository-automation-map.md"]));
for (const file of ["specs/014-retail-commerce-operations-growth-os/work-map-integration.json", ".github/workflows/ci.yml", "docs/work-maps/../secret", "docs/work-maps\\escape"]) {
  assert.throws(() => assertDocsOnlyPaths([file]), /docs_only_scope_violation/u);
}
assert.throws(() => inspectDocsOnlyGit({ expectedHeadSha: "invalid" }), /docs_only_expected_head_invalid/u);
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-work-map-docs-only-"));
const git = (...args) => execFileSync("git", args, { cwd: fixture, encoding: "utf8" }).trim();
try {
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Fixture");
  fs.mkdirSync(path.join(fixture, "docs", "work-maps"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "docs", "work-maps", "README.md"), "old\n");
  git("add", "--all");
  git("commit", "-qm", "baseline");
  const base = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(fixture, "docs", "work-maps", "README.md"), "new\n");
  assert.deepEqual(inspectDocsOnlyGit({ root: fixture, expectedHeadSha: base }).changed_paths, ["docs/work-maps/README.md"]);
  fs.mkdirSync(path.join(fixture, "specs", "014-test"), { recursive: true });
  const forbidden = path.join(fixture, "specs", "014-test", "work-map-integration.json");
  fs.writeFileSync(forbidden, "{}\n");
  assert.throws(() => inspectDocsOnlyGit({ root: fixture, expectedHeadSha: base }), /docs_only_scope_violation/u, "untracked specs file rejected");
  git("add", "--all");
  assert.throws(() => inspectDocsOnlyGit({ root: fixture, expectedHeadSha: base }), /docs_only_scope_violation/u, "staged specs file rejected");
  git("commit", "-qm", "forbidden committed output");
  assert.throws(() => inspectDocsOnlyGit({ root: fixture, expectedHeadSha: base }), /docs_only_scope_violation/u, "committed specs diff rejected");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
const renameFixture = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-docs-only-rename-"));
const renameGit = (...args) => execFileSync("git", args, { cwd: renameFixture, encoding: "utf8" }).trim();
try {
  renameGit("init", "-q");
  renameGit("config", "user.email", "test@example.invalid");
  renameGit("config", "user.name", "Fixture");
  fs.mkdirSync(path.join(renameFixture, "specs"), { recursive: true });
  fs.mkdirSync(path.join(renameFixture, "docs", "work-maps"), { recursive: true });
  fs.writeFileSync(path.join(renameFixture, "specs", "original.md"), "tracked origin\n");
  renameGit("add", "--all");
  renameGit("commit", "-qm", "baseline with protected origin");
  const renameBase = renameGit("rev-parse", "HEAD");
  renameGit("mv", "specs/original.md", "docs/work-maps/new.md");
  assert.throws(() => inspectDocsOnlyGit({ root: renameFixture, expectedHeadSha: renameBase }), /docs_only_scope_violation:specs\/original\.md/u, "rename source outside docs blocked before commit");
  renameGit("commit", "-qm", "move protected original into docs");
  assert.throws(() => inspectDocsOnlyGit({ root: renameFixture, expectedHeadSha: renameBase }), /docs_only_scope_violation:specs\/original\.md/u, "rename source outside docs blocked after commit");
} finally {
  fs.rmSync(renameFixture, { recursive: true, force: true });
}
console.log("Work Map docs-only scope and delegated grant regression tests passed.");
