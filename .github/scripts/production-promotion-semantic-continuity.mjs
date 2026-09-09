#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT = "mad4b.production-promotion-semantic-continuity.v1";
const SHA_RE = /^[0-9a-f]{40}$/u;
const POLICY_CONTRACT = "mad4b.deployment-branch-policy.v1";

const FIXED_PROMOTION_SENSITIVE_PATTERNS = Object.freeze([
  ".github/scripts/production-*.mjs",
  ".github/tests/production-promotion-*.test.mjs",
  ".github/contracts/production-*.json",
  ".github/workflows/governed-production-*.yml",
  ".github/workflows/production-*.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/policy-objection-ci.yml",
  ".github/workflows/derived-state-closure.yml",
  ".github/workflows/spec-kit-work-map-integration.yml",
  ".github/workflows/pr-generated-artifact-refresh.yml",
  ".github/workflows/repository-tool-lifecycle-governance.yml",
  ".github/workflows/e2e-phase-governance.yml",
  ".github/workflows/runtime-startup-deployment-evidence.yml",
  ".github/workflows/staging-main-deploy-eligibility.yml",
  ".github/workflows/staging-live-certification.yml",
  ".github/governance/*.json",
  ".github/derived-state-governance.json",
  ".specify/e2e-phase-governance.json",
  ".specify/schemas/e2e-phases.schema.json",
  "scripts/repository-governance-*.mjs",
  "scripts/derived-state-closure.mjs",
  "http-generic-api/config/repository-governance-constitution.json",
  "http-generic-api/config/deployment-branch-policy.json",
  "http-generic-api/config/domain-family-policy.json",
  "http-generic-api/scripts/environment-impact-closure.mjs",
  "http-generic-api/scripts/generate-deployment-manifest.mjs",
  "http-generic-api/scripts/hostinger-*.mjs",
  "package.json",
  "package-lock.json",
  "http-generic-api/package.json",
  "http-generic-api/package-lock.json",
  "http-generic-api/Dockerfile*",
  "http-generic-api/docker-compose.yml"
]);

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

function stable(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function globToRegExp(pattern) {
  const normalized = String(pattern || "").replaceAll("\\", "/");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === "*" && next === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function validatePolicy(policy, label) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error(`${label} deployment policy must be an object`);
  }
  if (policy.schema_version !== POLICY_CONTRACT) {
    throw new Error(`${label} deployment policy contract mismatch`);
  }
  const pathClasses = policy.environment_impact?.path_classes;
  if (!Array.isArray(pathClasses) || pathClasses.length === 0) {
    throw new Error(`${label} deployment policy has no environment-impact path classes`);
  }
  const productionClasses = pathClasses.filter((entry) =>
    Array.isArray(entry?.environments) && entry.environments.includes("production"));
  if (productionClasses.length === 0) {
    throw new Error(`${label} deployment policy has no production-impact class`);
  }
  if (policy.environment_impact?.fail_closed?.unclassified_paths !== true) {
    throw new Error(`${label} deployment policy does not fail closed on unclassified paths`);
  }
  return policy;
}

function rulesFromPolicy(policy, label) {
  const rules = [];
  for (const entry of policy.environment_impact.path_classes || []) {
    if (!Array.isArray(entry?.environments) || !entry.environments.includes("production")) continue;
    rules.push({
      id: `${label}:environment_class:${entry.id}`,
      patterns: stable(entry.patterns || []),
      exclude_patterns: stable(entry.exclude_patterns || [])
    });
  }
  for (const exactPath of policy.environment_impact?.source_of_truth_paths || []) {
    rules.push({
      id: `${label}:environment_authority:${exactPath}`,
      patterns: [String(exactPath)],
      exclude_patterns: []
    });
  }
  return rules;
}

function buildRules(releasePolicy, currentPolicy) {
  return [
    {
      id: "fixed:promotion_control_plane_floor",
      patterns: [...FIXED_PROMOTION_SENSITIVE_PATTERNS],
      exclude_patterns: []
    },
    ...rulesFromPolicy(releasePolicy, "release"),
    ...rulesFromPolicy(currentPolicy, "current")
  ];
}

function matchesRule(filePath, rule) {
  const normalized = String(filePath || "").replaceAll("\\", "/");
  const included = (rule.patterns || []).some((pattern) => globToRegExp(pattern).test(normalized));
  if (!included) return false;
  return !(rule.exclude_patterns || []).some((pattern) => globToRegExp(pattern).test(normalized));
}

function matchingRuleIds(filePath, rules) {
  return stable(rules.filter((rule) => matchesRule(filePath, rule)).map((rule) => rule.id));
}

export function parseLsTree(bufferOrText) {
  const text = Buffer.isBuffer(bufferOrText) ? bufferOrText.toString("utf8") : String(bufferOrText || "");
  const rows = [];
  for (const record of text.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) throw new Error("invalid git ls-tree record");
    const meta = record.slice(0, tab).trim().split(/\s+/u);
    if (meta.length !== 3) throw new Error("invalid git ls-tree metadata");
    const [mode, type, object] = meta;
    const filePath = record.slice(tab + 1);
    if (!/^[0-9]{6}$/u.test(mode) || !/^[0-9a-f]{40,64}$/u.test(object) || !filePath) {
      throw new Error("invalid git ls-tree identity");
    }
    rows.push({ path: filePath, mode, type, object });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

function sensitiveManifest(entries, rules) {
  return entries
    .map((entry) => ({ ...entry, rule_ids: matchingRuleIds(entry.path, rules) }))
    .filter((entry) => entry.rule_ids.length > 0)
    .sort((left, right) => left.path.localeCompare(right.path));
}

function digestManifest(entries) {
  const canonical = entries.map(({ path, mode, type, object }) => [path, mode, type, object]);
  return sha256(JSON.stringify(canonical));
}

function changedSensitivePaths(releaseManifest, currentManifest, rules) {
  const release = new Map(releaseManifest.map((entry) => [entry.path, entry]));
  const current = new Map(currentManifest.map((entry) => [entry.path, entry]));
  const paths = stable([...release.keys(), ...current.keys()]);
  return paths.flatMap((filePath) => {
    const before = release.get(filePath) || null;
    const after = current.get(filePath) || null;
    if (before && after &&
        before.mode === after.mode &&
        before.type === after.type &&
        before.object === after.object) return [];
    let change = "modified";
    if (!before) change = "added";
    else if (!after) change = "deleted";
    return [{
      path: filePath,
      change,
      release_object: before?.object || null,
      current_object: after?.object || null,
      rule_ids: matchingRuleIds(filePath, rules)
    }];
  });
}

export function buildSemanticContinuityReport({
  releaseCutSha,
  currentMainSha,
  releasePolicy,
  currentPolicy,
  releaseTree,
  currentTree
} = {}) {
  if (!SHA_RE.test(String(releaseCutSha || ""))) throw new Error("releaseCutSha must be an exact lowercase SHA");
  if (!SHA_RE.test(String(currentMainSha || ""))) throw new Error("currentMainSha must be an exact lowercase SHA");
  validatePolicy(releasePolicy, "release");
  validatePolicy(currentPolicy, "current");

  const rules = buildRules(releasePolicy, currentPolicy);
  const releaseManifest = sensitiveManifest(releaseTree || [], rules);
  const currentManifest = sensitiveManifest(currentTree || [], rules);
  const releaseDigest = digestManifest(releaseManifest);
  const currentDigest = digestManifest(currentManifest);
  const changedPaths = changedSensitivePaths(releaseManifest, currentManifest, rules);
  const semanticContinuity = releaseDigest === currentDigest && changedPaths.length === 0;

  return {
    contract: CONTRACT,
    evaluation_ok: true,
    release_cut_sha: releaseCutSha,
    current_main_sha: currentMainSha,
    release_cut_is_current_main: releaseCutSha === currentMainSha,
    semantic_continuity: semanticContinuity,
    promotion_surface_changed: !semanticContinuity,
    release_cut_promotion_digest: releaseDigest,
    current_main_promotion_digest: currentDigest,
    release_cut_sensitive_path_count: releaseManifest.length,
    current_main_sensitive_path_count: currentManifest.length,
    changed_sensitive_path_count: changedPaths.length,
    changed_sensitive_paths: changedPaths,
    rule_source: "union_of_release_and_current_deployment_policy_plus_fixed_control_plane_floor",
    rule_count: rules.length,
    main_tip_may_advance: semanticContinuity,
    main_advance_requires_semantic_continuity: true,
    invalidation_required: !semanticContinuity,
    invalidation_reason: semanticContinuity ? null : "production_relevant_main_advance",
    fresh_governed_release_cut_required: !semanticContinuity,
    fail_closed: {
      deployment_policy_contract_required: true,
      production_path_class_required: true,
      unclassified_path_policy_required: true,
      release_and_current_policy_union_required: true,
      fixed_control_plane_floor_required: true
    },
    merge_executed: false,
    deployment_executed: false,
    migration_executed: false,
    grant_executed: false,
    provider_call_executed: false,
    credential_payload_read: false,
    secrets_included: false
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const releaseCutSha = arg("release-cut-sha");
  const currentMainSha = arg("current-main-sha");
  const releasePolicyPath = arg("release-policy");
  const currentPolicyPath = arg("current-policy");
  const releaseTreePath = arg("release-tree");
  const currentTreePath = arg("current-tree");
  const outputPath = arg("output");
  for (const [name, value] of Object.entries({
    "release-cut-sha": releaseCutSha,
    "current-main-sha": currentMainSha,
    "release-policy": releasePolicyPath,
    "current-policy": currentPolicyPath,
    "release-tree": releaseTreePath,
    "current-tree": currentTreePath,
    output: outputPath
  })) {
    if (!value) throw new Error(`--${name} is required`);
  }

  const report = buildSemanticContinuityReport({
    releaseCutSha,
    currentMainSha,
    releasePolicy: readJson(releasePolicyPath),
    currentPolicy: readJson(currentPolicyPath),
    releaseTree: parseLsTree(fs.readFileSync(releaseTreePath)),
    currentTree: parseLsTree(fs.readFileSync(currentTreePath))
  });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
