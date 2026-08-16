#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  /manifest\.review_state === "ready_for_implementation" \|\| !policy\.review_states\.includes\(manifest\.review_state\)/u,
  "validator must keep ready manifests and malformed review-state manifests in fail-closed registry refresh scope",
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
  "writer_binding_file",
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
assert.ok(workflow.includes('"${changed_file}" = "${policy_file}"'));
assert.ok(workflow.includes('"${changed_file}" = "${policy_template_path}"'));
assert.ok(workflow.includes('"${changed_file}" = "http-generic-api/scripts/spec-kit-work-map-integration-gate.mjs"'));
assert.ok(workflow.includes('"${changed_file}" == "${work_map_root}/"*'));
assert.ok(
  workflow.includes('done < "${immutable_target_pr_files}"'),
  "registry refresh trigger must come from immutable exact-base/exact-head Git inventory",
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
  workflow.includes('if [[ "${review_state}" = "ready_for_implementation" ]]; then'),
  "only ready_for_implementation manifests may enter registry refresh write scope",
);
assert.ok(
  workflow.includes('cat "${target_binding_file}" "${registry_refresh_binding_file}" | sort -u > "${writer_binding_file}"'),
  "writer scope must be the deterministic union of target-diff and registry-refresh manifests",
);

const discoveryIndex = workflow.indexOf('registry_refresh_required=false');
const unionIndex = workflow.indexOf('cat "${target_binding_file}" "${registry_refresh_binding_file}" | sort -u > "${writer_binding_file}"');
const consumeIndex = workflow.indexOf("- name: Verify and consume Recovery-issued writer delegation");
assert.ok(discoveryIndex >= 0 && unionIndex > discoveryIndex, "registry refresh discovery must finish before writer union is created");
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
