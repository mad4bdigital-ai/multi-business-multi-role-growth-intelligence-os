#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessMigrationSqlPreflight } from "../releaseReadiness.js";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const MIGRATIONS_DIR = path.join(API_ROOT, "migrations");
const QUEUE_PATH = path.join(REPO_ROOT, "docs", "surface-contract-gap-queue.json");
const ATTESTATION_PATH = path.join(REPO_ROOT, "docs", "surface-contract-safety-attestations.json");
const MANUAL_ATTESTATION_PATH = path.join(REPO_ROOT, "docs", "surface-contract-manual-safety-attestations.json");
const DOC_TARGETS = [
  "Updating Registry Patch Index.md",
  "deployment_parity_checklist.md",
  "docs/ai-docs-agent-governance.md",
  "docs/auto-docs-agent/README.md",
  "docs/change-documentation-governance.md",
];
const BEGIN_MARKER = "<!-- surface-contract-auto-remediation:start -->";
const END_MARKER = "<!-- surface-contract-auto-remediation:end -->";
const SAFETY_MARKERS = [
  "no_provider_call",
  "no_credential_payload_read",
  "no_raw_secrets",
  "no_external_send",
  "no_external_write",
  "secrets_included_false",
];
const ALLOWED_REMEDIATION_ACTIONS = new Set([
  "document_surface_contract",
  "verify_tool_registry_binding",
  "verify_policy_seed_readiness",
  "verify_readback_view",
  "add_explicit_safety_markers",
]);
const FORBIDDEN_SQL_PATTERNS = [
  /\bDROP\s+(?:TABLE|VIEW|DATABASE)\b/i,
  /\bTRUNCATE\s+TABLE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bLOAD\s+DATA\b/i,
  /\bINTO\s+OUTFILE\b/i,
  /\bCALL\s+[A-Za-z0-9_]+\s*\(/i,
  /\bPREPARE\s+[A-Za-z0-9_]+\s+FROM\b/i,
  /^\s*EXECUTE\s+[A-Za-z0-9_]+\b/im,
  /\bCREATE\s+(?:PROCEDURE|FUNCTION|TRIGGER)\b/i,
  /^\s*GRANT\b[\s\S]*?\bON\b/im,
  /^\s*REVOKE\b[\s\S]*?\bON\b/im,
];

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function allFalseSafety(item = {}) {
  const safety = item.safety || {};
  return safety.executes_provider_calls === false
    && safety.reads_credentials === false
    && safety.mutates_runtime === false
    && safety.writes_database === false
    && safety.external_sends === false
    && safety.deploys === false
    && safety.secrets_included === false;
}

export function isAutoEligible(item = {}) {
  const actions = (item.remediation || []).map((entry) => entry.action_key);
  return Boolean(item.migration_file)
    && (item.missing_openapi_routes || []).length === 0
    && allFalseSafety(item)
    && actions.every((action) => ALLOWED_REMEDIATION_ACTIONS.has(action));
}

function forbiddenPatternsFor(source = "") {
  return FORBIDDEN_SQL_PATTERNS
    .filter((pattern) => pattern.test(source))
    .map((pattern) => pattern.source)
    .sort();
}

function preflightRiskCounts(preflight = {}) {
  return (preflight.risks || []).reduce((counts, risk) => {
    counts[risk.code] = (counts[risk.code] || 0) + 1;
    return counts;
  }, {});
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateManualAttestation({ item = {}, source = "" }) {
  const preflight = assessMigrationSqlPreflight(item.migration_file || "unknown.sql", source);
  const actualForbiddenPatterns = forbiddenPatternsFor(source);
  const acceptedForbiddenPatterns = [...(item.accepted_forbidden_patterns || [])].sort();
  const actualRiskCounts = preflightRiskCounts(preflight);
  const acceptedRiskCounts = Object.fromEntries(
    Object.entries(item.accepted_preflight_risks || {}).sort(([left], [right]) => left.localeCompare(right)),
  );
  const sortedActualRiskCounts = Object.fromEntries(
    Object.entries(actualRiskCounts).sort(([left], [right]) => left.localeCompare(right)),
  );
  const requiredFragments = item.required_sql_fragments || [];
  const reasons = [];
  if (!item.migration_file || !item.migration_sha256) reasons.push("manual_attestation_identity_missing");
  if (sha256(source) !== item.migration_sha256) reasons.push("manual_attestation_checksum_mismatch");
  if (item.attestation_status !== "verified_static_no_external_side_effects") reasons.push("manual_attestation_status_invalid");
  if (item.evidence_mode !== "checksum_bound_human_review") reasons.push("manual_attestation_evidence_mode_invalid");
  if (item.review_status !== "approved_checksum_bound_internal_sql") reasons.push("manual_attestation_review_status_invalid");
  if (item.execution_authorized !== false) reasons.push("manual_attestation_must_not_authorize_execution");
  if (typeof item.reviewed_by !== "string" || item.reviewed_by.length < 8) reasons.push("manual_attestation_reviewer_missing");
  if (!Number.isFinite(Date.parse(item.reviewed_at || ""))) reasons.push("manual_attestation_reviewed_at_invalid");
  if (typeof item.rationale !== "string" || item.rationale.length < 80) reasons.push("manual_attestation_rationale_too_short");
  if (!SAFETY_MARKERS.every((marker) => item.safety_markers?.[marker] === true)) reasons.push("manual_attestation_safety_markers_incomplete");
  if (!allFalseSafety(item)) reasons.push("manual_attestation_remediation_safety_invalid");
  if (item.preflight_status !== preflight.status) reasons.push("manual_attestation_preflight_status_mismatch");
  if (Number(item.preflight_risk_count) !== Number(preflight.risk_count || 0)) reasons.push("manual_attestation_preflight_risk_count_mismatch");
  if (Number(item.statement_count) !== Number(preflight.counts?.statements || 0)) reasons.push("manual_attestation_statement_count_mismatch");
  if (!sameJson(acceptedRiskCounts, sortedActualRiskCounts)) reasons.push("manual_attestation_preflight_risks_mismatch");
  if (!sameJson(acceptedForbiddenPatterns, actualForbiddenPatterns)) reasons.push("manual_attestation_forbidden_patterns_mismatch");
  if (!requiredFragments.length || requiredFragments.some((fragment) => !source.includes(fragment))) reasons.push("manual_attestation_required_sql_fragment_missing");
  if (item.migration_effects?.internal_database_write !== true
    || item.migration_effects?.external_write !== false
    || item.migration_effects?.provider_call !== false
    || item.migration_effects?.credential_payload_read !== false
    || item.migration_effects?.secrets_included !== false) {
    reasons.push("manual_attestation_migration_effects_invalid");
  }
  return {
    valid: reasons.length === 0,
    reasons,
    actual: {
      migration_sha256: sha256(source),
      preflight_status: preflight.status,
      preflight_risk_count: Number(preflight.risk_count || 0),
      statement_count: Number(preflight.counts?.statements || 0),
      preflight_risks: sortedActualRiskCounts,
      forbidden_patterns: actualForbiddenPatterns,
    },
    attestation: reasons.length === 0 ? { ...item } : null,
  };
}

export function buildAttestation({ item, source }) {
  const preflight = assessMigrationSqlPreflight(item.migration_file, source);
  const forbiddenPatterns = forbiddenPatternsFor(source);
  const eligible = isAutoEligible(item)
    && preflight.status === "pass"
    && Number(preflight.risk_count || 0) === 0
    && forbiddenPatterns.length === 0;
  if (!eligible) {
    return {
      eligible: false,
      migration_file: item.migration_file,
      reasons: [
        ...(isAutoEligible(item) ? [] : ["queue_item_not_auto_eligible"]),
        ...(preflight.status === "pass" ? [] : ["migration_preflight_not_pass"]),
        ...(Number(preflight.risk_count || 0) === 0 ? [] : ["migration_preflight_has_risks"]),
        ...(forbiddenPatterns.length ? ["forbidden_sql_pattern_detected"] : []),
      ],
      forbidden_patterns: forbiddenPatterns,
    };
  }

  const runtimeReviews = (item.remediation || [])
    .filter((entry) => entry.action_key.startsWith("verify_"))
    .map((entry) => ({ action_key: entry.action_key, targets: [...(entry.targets || [])].sort() }))
    .sort((a, b) => a.action_key.localeCompare(b.action_key));

  return {
    eligible: true,
    attestation: {
      migration_file: item.migration_file,
      migration_sha256: sha256(source),
      attestation_status: "verified_static_no_external_side_effects",
      evidence_mode: "checksum_bound_static_contract",
      queue_class_at_attestation: item.queue_class,
      gap_severity_at_attestation: item.gap_severity,
      preflight_status: preflight.status,
      preflight_risk_count: Number(preflight.risk_count || 0),
      statement_count: Number(preflight.counts?.statements || 0),
      surface_counts: { ...(item.surface_counts || {}) },
      runtime_reviews: runtimeReviews,
      safety_markers: Object.fromEntries(SAFETY_MARKERS.map((marker) => [marker, true])),
      safety: {
        executes_provider_calls: false,
        reads_credentials: false,
        mutates_runtime: false,
        writes_database: false,
        external_sends: false,
        deploys: false,
        secrets_included: false,
      },
    },
  };
}

function validExistingAttestation(item = {}) {
  if (!item.migration_file || !item.migration_sha256) return false;
  const migrationPath = path.join(MIGRATIONS_DIR, path.basename(item.migration_file));
  if (!fs.existsSync(migrationPath)) return false;
  const source = fs.readFileSync(migrationPath, "utf8");
  return sha256(source) === item.migration_sha256
    && item.attestation_status === "verified_static_no_external_side_effects"
    && SAFETY_MARKERS.every((marker) => item.safety_markers?.[marker] === true);
}

export function renderGeneratedBlock(attestations = []) {
  const rows = attestations.map((item) => {
    const surfaces = Object.entries(item.surface_counts || {})
      .filter(([, count]) => Number(count || 0) > 0)
      .map(([key, count]) => `${key}=${count}`)
      .join(", ") || "none";
    const runtimeReviews = item.runtime_reviews?.length
      ? item.runtime_reviews.map((entry) => entry.action_key).join(", ")
      : "none";
    const reviewEvidence = item.evidence_mode === "checksum_bound_human_review" ? `; evidence: human review by ${item.reviewed_by}` : "";
    return `- \`${item.migration_file}\` — SHA-256 \`${item.migration_sha256}\`; surfaces: ${surfaces}; static preflight: ${item.preflight_status}/${item.preflight_risk_count}; runtime reviews: ${runtimeReviews}${reviewEvidence}.`;
  });
  return `${BEGIN_MARKER}\n## Automated Surface Contract Attestations\n\n> Generated by \`surface-contract-auto-remediator.mjs\`. Each attestation is bound to the migration SHA-256 and becomes invalid automatically when SQL changes. This block documents static no-provider/no-secret/no-external-side-effect evidence only; it does not authorize execution, provider calls, credential access, database writes, deployment, or external sends.\n\n${rows.length ? rows.join("\n") : "- none"}\n${END_MARKER}`;
}

export function upsertGeneratedBlock(content = "", block = "") {
  const start = content.indexOf(BEGIN_MARKER);
  const end = content.indexOf(END_MARKER);
  if (start >= 0 && end > start) {
    return `${content.slice(0, start)}${block}${content.slice(end + END_MARKER.length)}`;
  }
  const firstNewline = content.indexOf("\n");
  if (firstNewline < 0) return `${content}\n\n${block}\n`;
  return `${content.slice(0, firstNewline + 1)}\n${block}\n${content.slice(firstNewline + 1)}`;
}

function runGenerator(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed: ${result.stderr || result.stdout}`);
  }
}

function writeGithubOutput(values = {}) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  fs.appendFileSync(outputPath, `${Object.entries(values).map(([key, value]) => `${key}=${String(value)}`).join("\n")}\n`);
}

function buildState() {
  const queue = readJson(QUEUE_PATH, { top_items: [], schema_version: "unknown" });
  const existing = readJson(ATTESTATION_PATH, { items: [] });
  const manualRegistry = readJson(MANUAL_ATTESTATION_PATH, { items: [], schema_version: "unknown" });
  const manualByMigration = new Map();
  const manualValidationByMigration = new Map();
  const manualItems = manualRegistry.schema_version === "surface-contract-manual-safety-attestations-v1" ? (manualRegistry.items || []) : [];
  for (const item of manualItems) {
    const migrationPath = path.join(MIGRATIONS_DIR, path.basename(item.migration_file || ""));
    const source = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
    const validation = validateManualAttestation({ item, source });
    manualValidationByMigration.set(item.migration_file, validation);
    if (validation.valid) manualByMigration.set(item.migration_file, validation.attestation);
  }
  const byMigration = new Map([
    ...(existing.items || []).filter(validExistingAttestation).map((item) => [item.migration_file, item]),
    ...manualByMigration.entries(),
  ]);
  const manual = [];
  const added = [];

  for (const item of queue.top_items || []) {
    const migrationPath = path.join(MIGRATIONS_DIR, path.basename(item.migration_file));
    if (!fs.existsSync(migrationPath)) {
      manual.push({ migration_file: item.migration_file, reasons: ["migration_file_missing"] });
      continue;
    }
    const source = fs.readFileSync(migrationPath, "utf8");
    const result = buildAttestation({ item, source });
    if (!result.eligible) {
      const manualAttestation = manualByMigration.get(item.migration_file);
      if (manualAttestation) {
        byMigration.set(item.migration_file, manualAttestation);
        added.push(item.migration_file);
        continue;
      }
      const manualValidation = manualValidationByMigration.get(item.migration_file);
      manual.push({
        ...result,
        ...(manualValidation ? { manual_attestation_reasons: manualValidation.reasons } : {}),
      });
      continue;
    }
    byMigration.set(item.migration_file, result.attestation);
    added.push(item.migration_file);
  }

  const attestations = [...byMigration.values()].sort((a, b) => a.migration_file.localeCompare(b.migration_file));
  const manifest = {
    ok: true,
    schema_version: "surface-contract-safety-attestations-v1",
    source_queue_schema: queue.schema_version,
    item_count: attestations.length,
    items: attestations,
    safety: {
      executes_provider_calls: false,
      reads_credentials: false,
      mutates_runtime: false,
      writes_database: false,
      external_sends: false,
      deploys: false,
      secrets_included: false,
    },
  };
  return { queue, manifest, attestations, manual, added };
}

function generatedMismatches(state) {
  const block = renderGeneratedBlock(state.attestations);
  const expectedManifest = `${JSON.stringify(state.manifest, null, 2)}\n`;
  const mismatches = [];
  if (!fs.existsSync(ATTESTATION_PATH) || fs.readFileSync(ATTESTATION_PATH, "utf8") !== expectedManifest) {
    mismatches.push(path.relative(REPO_ROOT, ATTESTATION_PATH));
  }
  for (const target of DOC_TARGETS) {
    const filePath = path.join(REPO_ROOT, target);
    const content = fs.readFileSync(filePath, "utf8");
    if (content !== upsertGeneratedBlock(content, block)) mismatches.push(target);
  }
  return mismatches;
}

function writeGeneratedState(state) {
  const block = renderGeneratedBlock(state.attestations);
  fs.mkdirSync(path.dirname(ATTESTATION_PATH), { recursive: true });
  fs.writeFileSync(ATTESTATION_PATH, `${JSON.stringify(state.manifest, null, 2)}\n`);
  for (const target of DOC_TARGETS) {
    const filePath = path.join(REPO_ROOT, target);
    const content = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(filePath, upsertGeneratedBlock(content, block));
  }
}

export function convergeGeneratedState({
  maxPasses = 5,
  build = buildState,
  writeState = writeGeneratedState,
  runDiscovery = () => runGenerator("scripts/surface-contract-discovery.mjs", ["--write"]),
  runTriage = () => runGenerator("scripts/surface-contract-gap-triage.mjs", ["--write"]),
  diffState = generatedMismatches,
} = {}) {
  let state = build();
  const passes = [];
  const added = new Set();
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    for (const migration of state.added || []) added.add(migration);
    const pendingBefore = diffState(state);
    writeState(state);
    runDiscovery();
    runTriage();
    const nextState = build();
    for (const migration of nextState.added || []) added.add(migration);
    const pendingAfter = diffState(nextState);
    passes.push({
      pass,
      pending_before: pendingBefore.length,
      pending_after: pendingAfter.length,
      attestation_count: nextState.attestations?.length || 0,
      manual_review_count: nextState.manual?.length || 0,
    });
    state = nextState;
    if (pendingAfter.length === 0) {
      return { converged: true, state, passes, added: [...added].sort() };
    }
  }
  return { converged: false, state, passes, added: [...added].sort() };
}

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  let state = buildState();
  let generation = { converged: true, passes: [], added: state.added || [] };

  if (write) {
    generation = convergeGeneratedState();
    state = generation.state;
    if (!generation.converged) {
      console.error(`surface-contract-auto-remediator: generated state did not converge after ${generation.passes.length} passes`);
      process.exitCode = 1;
    }
  }

  if (check) {
    const mismatches = generatedMismatches(state);
    if (mismatches.length) {
      console.error(`surface-contract-auto-remediator: generated outputs are stale: ${mismatches.join(", ")}`);
      process.exitCode = 1;
    }
  }

  const refreshedQueue = write ? readJson(QUEUE_PATH, { total_items: 0 }) : state.queue;
  const autoMergeEligible = generation.converged
    && state.manual.length === 0
    && Number(refreshedQueue.total_items || 0) === 0;
  writeGithubOutput({
    auto_merge_eligible: autoMergeEligible ? "true" : "false",
    manual_review_count: state.manual.length,
    remaining_queue_items: Number(refreshedQueue.total_items || 0),
    generation_pass_count: generation.passes.length,
  });
  console.log(JSON.stringify({
    ok: autoMergeEligible,
    schema_version: state.manifest.schema_version,
    write,
    check,
    converged: generation.converged,
    generation_pass_count: generation.passes.length,
    generation_passes: generation.passes,
    attestation_count: state.attestations.length,
    added_or_refreshed: generation.added,
    manual_review_count: state.manual.length,
    manual_review_items: state.manual,
    remaining_queue_items: Number(refreshedQueue.total_items || 0),
    auto_merge_eligible: autoMergeEligible,
    secrets_included: false,
  }, null, 2));
}

export function isDirectExecution(importMetaUrl, argvPath) {
  if (!argvPath) return false;
  return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(argvPath);
}

if (isDirectExecution(import.meta.url, process.argv[1])) main();
