#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const POLICY_PATH = path.join(REPO_ROOT, ".specify", "spec-kit-governance.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gitChangedFiles(root = REPO_ROOT) {
  const candidates = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
    "origin/main...HEAD",
    "HEAD~1...HEAD",
  ].filter(Boolean);
  for (const range of candidates) {
    try {
      return execFileSync("git", ["diff", "--name-only", range], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    } catch {}
  }
  return [];
}

function featureKeyFromFile(file, specRoot) {
  const normalized = file.replaceAll("\\", "/");
  const prefix = `${specRoot}/`;
  if (!normalized.startsWith(prefix)) return null;
  return normalized.slice(prefix.length).split("/")[0] || null;
}

function listFeatureDirectories(root, specRoot) {
  const base = path.join(root, specRoot);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function checklistState(file) {
  const source = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*[-*]\s+\[([^\]])\]\s+(.+)$/);
    if (!match) continue;
    rows.push({ line: index + 1, state: match[1], text: match[2].trim() });
  }
  return rows;
}

function validSha(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function validRunId(value) {
  return typeof value === "string" && value.trim().length >= 8;
}

function push(findings, type, feature, details = {}) {
  findings.push({ type, feature, ...details });
}

export function validateFeatureDirectory(feature, options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(POLICY_PATH);
  const headRef = options.headRef || process.env.GITHUB_HEAD_REF || "";
  const featureRoot = path.join(root, policy.spec_root, feature);
  const findings = [];

  for (const required of policy.required_feature_files) {
    if (!fs.existsSync(path.join(featureRoot, required))) {
      push(findings, "missing_required_feature_file", feature, { file: required });
    }
  }

  const completionPath = path.join(featureRoot, "completion.json");
  if (!fs.existsSync(completionPath)) return findings;

  let completion;
  try {
    completion = readJson(completionPath);
  } catch (error) {
    push(findings, "invalid_completion_json", feature, { message: error.message });
    return findings;
  }

  if (completion.schema_version !== policy.schema_version) push(findings, "invalid_schema_version", feature, { value: completion.schema_version });
  if (completion.feature_key !== feature) push(findings, "feature_key_mismatch", feature, { value: completion.feature_key });
  if (!policy.delivery_modes.includes(completion.delivery_mode)) push(findings, "invalid_delivery_mode", feature, { value: completion.delivery_mode });
  if (!policy.completion_statuses.includes(completion.status)) push(findings, "invalid_completion_status", feature, { value: completion.status });

  const checklistDir = path.join(featureRoot, policy.required_checklist_directory);
  const checklistFiles = fs.existsSync(checklistDir)
    ? fs.readdirSync(checklistDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => path.join(checklistDir, entry.name))
    : [];
  if (!checklistFiles.length) push(findings, "missing_feature_checklist", feature, { directory: policy.required_checklist_directory });

  const taskFile = path.join(featureRoot, "tasks.md");
  const checkboxFiles = [taskFile, ...checklistFiles].filter((file) => fs.existsSync(file));
  const unresolved = [];
  const invalidNa = [];
  for (const file of checkboxFiles) {
    for (const row of checklistState(file)) {
      if (row.state === " ") unresolved.push({ file: path.relative(root, file).replaceAll("\\", "/"), line: row.line, text: row.text });
      else if (row.state === "~" && !/(?:\bN\/A\b|not applicable|غير منطبق)/i.test(row.text)) {
        invalidNa.push({ file: path.relative(root, file).replaceAll("\\", "/"), line: row.line, text: row.text });
      } else if (![...policy.accepted_checkbox_states.complete, ...policy.accepted_checkbox_states.not_applicable].includes(row.state)) {
        push(findings, "invalid_checkbox_state", feature, { file: path.relative(root, file).replaceAll("\\", "/"), line: row.line, state: row.state });
      }
    }
  }

  for (const row of invalidNa) push(findings, "not_applicable_missing_rationale", feature, row);

  if (completion.status === "complete") {
    if (unresolved.length) push(findings, "unresolved_completion_items", feature, { count: unresolved.length, items: unresolved.slice(0, 100) });

    const requirements = completion.requirements || {};
    if (completion.delivery_mode === "single_pr") {
      const forbidden = policy.single_pr_forbidden_requirements.filter((key) => requirements[key] === true);
      if (forbidden.length) push(findings, "single_pr_has_post_merge_obligations", feature, { requirements: forbidden });
    }

    const delivery = completion.delivery || {};
    const implementationPrs = Array.isArray(delivery.implementation_prs) ? delivery.implementation_prs : [];
    if (!implementationPrs.length) push(findings, "missing_implementation_pr_evidence", feature);
    for (const row of implementationPrs) {
      if (!Number.isInteger(row.number) || row.number < 1 || row.status !== "merged" || !validSha(row.merge_sha)) {
        push(findings, "invalid_implementation_pr_evidence", feature, { row });
      }
    }

    if (completion.delivery_mode === "multi_pr") {
      const closeout = delivery.closeout_pr || {};
      const numberValid = Number.isInteger(closeout.number) && closeout.number > 0;
      const currentValid = closeout.number === policy.current_pr_marker && typeof closeout.branch === "string" && closeout.branch.length > 3;
      if ((!numberValid && !currentValid) || closeout.role !== "completion" || !["current_pr", "merged"].includes(closeout.status)) {
        push(findings, "invalid_closeout_pr_evidence", feature, { closeout });
      }
      if (currentValid && headRef && closeout.branch !== headRef) {
        push(findings, "closeout_branch_mismatch", feature, { expected: headRef, actual: closeout.branch });
      }
    }

    const evidence = completion.evidence || {};
    if (evidence.ci?.status !== "pass" || !validSha(evidence.ci?.head_sha)) push(findings, "missing_ci_evidence", feature);
    if (evidence.release_readiness?.status !== "pass") push(findings, "missing_release_readiness_evidence", feature);

    if (requirements.migration === true) {
      const migration = evidence.migration || {};
      if (migration.status !== "applied" || !/^[0-9a-f]{64}$/i.test(migration.checksum_sha256 || "") || !Number.isInteger(migration.statement_count) || migration.statement_count < 1 || !validRunId(migration.ledger_run_id)) {
        push(findings, "missing_migration_evidence", feature);
      }
    }

    if (requirements.production_verification === true) {
      const production = evidence.production_verification || {};
      if (production.status !== "verified" || !validRunId(production.run_id) || !validSha(production.expected_commit_sha) || production.expected_commit_sha !== production.deployed_commit_sha) {
        push(findings, "missing_production_verification_evidence", feature);
      }
    }

    if (requirements.post_merge_audit === true) {
      const audit = evidence.post_merge_audit || {};
      if (!["completed", "completed_with_backlog"].includes(audit.status) || !validRunId(audit.run_id)) {
        push(findings, "missing_post_merge_audit_evidence", feature);
      }
      if (audit.status === "completed_with_backlog" && (!Array.isArray(audit.backlog_refs) || audit.backlog_refs.length === 0)) {
        push(findings, "audit_backlog_not_tracked", feature);
      }
    }
  }

  return findings;
}

export function validateRepository(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, ".specify", "spec-kit-governance.json"));
  const changedFiles = options.changedFiles || gitChangedFiles(root);
  const allFeatures = listFeatureDirectories(root, policy.spec_root);
  const policySurfaceChanged = changedFiles.some((file) => file === ".specify/spec-kit-governance.json" || file.startsWith(".specify/templates/") || file.endsWith("spec-kit-completion-gate.mjs"));
  const changedFeatures = new Set(changedFiles.map((file) => featureKeyFromFile(file, policy.spec_root)).filter(Boolean));
  const targets = options.all
    ? allFeatures.filter((feature) => fs.existsSync(path.join(root, policy.spec_root, feature, "completion.json")))
    : policySurfaceChanged
      ? allFeatures.filter((feature) => fs.existsSync(path.join(root, policy.spec_root, feature, "completion.json")))
      : [...changedFeatures];

  const findings = [];
  for (const feature of targets) {
    const completionPath = path.join(root, policy.spec_root, feature, "completion.json");
    if (!fs.existsSync(completionPath)) {
      push(findings, "changed_spec_kit_missing_completion_manifest", feature, { file: path.relative(root, completionPath).replaceAll("\\", "/") });
      continue;
    }
    findings.push(...validateFeatureDirectory(feature, { root, policy }));
  }
  return { findings, changedFiles, targets, policy };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const result = validateRepository({ all: args.has("--all") });
  if (result.findings.length) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "spec_kit_completion_gate_failed",
        message: "One or more changed Spec Kits do not satisfy completion governance.",
        details: { findings: result.findings, targets: result.targets, changed_files: result.changedFiles },
      },
      secrets_included: false,
    }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    policy_key: result.policy.policy_key,
    enforcement_mode: result.policy.enforcement_mode,
    features_checked: result.targets,
    changed_files_checked: result.changedFiles.length,
    gate: "fail_closed",
    secrets_included: false,
  }));
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
