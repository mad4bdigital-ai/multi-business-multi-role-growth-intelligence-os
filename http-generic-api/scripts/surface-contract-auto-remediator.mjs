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
  /\bEXECUTE\s+[A-Za-z0-9_]+\b/i,
  /\bCREATE\s+(?:PROCEDURE|FUNCTION|TRIGGER)\b/i,
  /\bGRANT\s+.+\s+ON\b/i,
  /\bREVOKE\s+.+\s+ON\b/i,
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

export function buildAttestation({ item, source }) {
  const preflight = assessMigrationSqlPreflight(item.migration_file, source);
  const forbiddenPatterns = FORBIDDEN_SQL_PATTERNS
    .filter((pattern) => pattern.test(source))
    .map((pattern) => pattern.source);
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
    return `- \`${item.migration_file}\` — SHA-256 \`${item.migration_sha256}\`; surfaces: ${surfaces}; static preflight: ${item.preflight_status}/${item.preflight_risk_count}; runtime reviews: ${runtimeReviews}.`;
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
  const byMigration = new Map((existing.items || []).filter(validExistingAttestation).map((item) => [item.migration_file, item]));
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
      manual.push(result);
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

function main() {
  const write = process.argv.includes("--write");
  const check = process.argv.includes("--check");
  const state = buildState();
  const block = renderGeneratedBlock(state.attestations);
  const expectedManifest = `${JSON.stringify(state.manifest, null, 2)}\n`;
  const mismatches = [];

  if (write) {
    fs.mkdirSync(path.dirname(ATTESTATION_PATH), { recursive: true });
    fs.writeFileSync(ATTESTATION_PATH, expectedManifest);
    for (const target of DOC_TARGETS) {
      const filePath = path.join(REPO_ROOT, target);
      const content = fs.readFileSync(filePath, "utf8");
      fs.writeFileSync(filePath, upsertGeneratedBlock(content, block));
    }
    runGenerator("scripts/surface-contract-discovery.mjs", ["--write"]);
    runGenerator("scripts/surface-contract-gap-triage.mjs", ["--write"]);
  }

  if (check) {
    if (!fs.existsSync(ATTESTATION_PATH) || fs.readFileSync(ATTESTATION_PATH, "utf8") !== expectedManifest) {
      mismatches.push(path.relative(REPO_ROOT, ATTESTATION_PATH));
    }
    for (const target of DOC_TARGETS) {
      const filePath = path.join(REPO_ROOT, target);
      const content = fs.readFileSync(filePath, "utf8");
      if (content !== upsertGeneratedBlock(content, block)) mismatches.push(target);
    }
    if (mismatches.length) {
      console.error(`surface-contract-auto-remediator: generated outputs are stale: ${mismatches.join(", ")}`);
      process.exitCode = 1;
    }
  }

  const refreshedQueue = write ? readJson(QUEUE_PATH, { total_items: 0 }) : state.queue;
  const autoMergeEligible = state.manual.length === 0 && Number(refreshedQueue.total_items || 0) === 0;
  writeGithubOutput({
    auto_merge_eligible: autoMergeEligible ? "true" : "false",
    manual_review_count: state.manual.length,
    remaining_queue_items: Number(refreshedQueue.total_items || 0),
  });
  console.log(JSON.stringify({
    ok: autoMergeEligible,
    schema_version: state.manifest.schema_version,
    write,
    check,
    attestation_count: state.attestations.length,
    added_or_refreshed: state.added,
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
