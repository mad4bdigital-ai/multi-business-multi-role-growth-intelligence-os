import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDispatchPlan } from "./frontend-surface-dispatch.mjs";

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPOSITORY_ROOT = resolve(API_ROOT, "..");
const OUTPUT_PATH = resolve(REPOSITORY_ROOT, "specs/020-platform-resource-identity-brand-governance/openapi-detail-gap-classification.json");
const DISPATCH_PATH = resolve(API_ROOT, "frontend-surface-dispatch.generated.json");
const SCHEMA_PATH = resolve(REPOSITORY_ROOT, "specs/020-platform-resource-identity-brand-governance/contracts/openapi-detail-gap-classification.schema.json");

function stableCounts(values, keyName) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ [keyName]: key, count }))
    .sort((left, right) => right.count - left.count || String(left[keyName]).localeCompare(String(right[keyName])));
}

function normalizePathSegment(path) {
  const first = String(path || "").replace(/^\/+|\/+$/gu, "").split("/", 1)[0] || "root";
  return first.replace(/^\{[^}]+\}$/u, "{param}");
}

function collectDetailGapRows(families) {
  const rows = [];
  for (const family of families || []) {
    const familyKey = String(family.family_key || "unknown");
    const surfaceDecision = String(family.surface_decision?.decision || "unclassified");
    for (const rawSignature of family.openapi_detail_gaps || []) {
      const signature = String(rawSignature);
      const separator = signature.indexOf(" ");
      const method = separator > 0 ? signature.slice(0, separator) : "unknown";
      const path = separator > 0 ? signature.slice(separator + 1) : "";
      rows.push({
        family_key: familyKey,
        surface_decision: surfaceDecision,
        signature,
        method,
        path_first_segment: normalizePathSegment(path),
      });
    }
  }
  return rows;
}

function buildClassification() {
  const baselineRef = "main";
  const plan = buildDispatchPlan({ apiRoot: API_ROOT, baselineRef });
  const rows = collectDetailGapRows(plan.families);
  const familyDecisions = (plan.families || []).map((family) => ({
    family_key: String(family.family_key || "unknown"),
    surface_decision: String(family.surface_decision?.decision || "unclassified"),
    detail_gap_count: (family.openapi_detail_gaps || []).length,
  }));
  const surfaceDecisionCounts = stableCounts(familyDecisions.map((entry) => entry.surface_decision), "decision");
  const detailDecisionCounts = stableCounts(rows.map((entry) => entry.surface_decision), "decision");
  const familyCounts = stableCounts(rows.map((entry) => entry.family_key), "family_key");
  const methodCounts = stableCounts(rows.map((entry) => entry.method), "method");
  const pathCounts = stableCounts(rows.map((entry) => entry.path_first_segment), "path_first_segment");
  const requiresReviewFamilies = familyDecisions
    .filter((entry) => entry.surface_decision === "requires_review")
    .sort((left, right) => right.detail_gap_count - left.detail_gap_count || left.family_key.localeCompare(right.family_key));
  const sourceArtifact = JSON.parse(readFileSync(DISPATCH_PATH, "utf8"));
  const sourceDigest = plan.baseline?.source_digest || sourceArtifact.baseline?.source_digest || null;
  const dispatchArtifactSha256 = createHash("sha256").update(readFileSync(DISPATCH_PATH)).digest("hex");
  assert.equal(plan.coverage.openapi_gap_count, 0, "classification must not hide OpenAPI presence gaps");
  assert.equal(plan.coverage.auth_contract_gap_count, 0, "classification must not hide auth contract gaps");
  return {
    $schema: "https://schemas.mad4b.com/spec020/openapi-detail-gap-classification.schema.json",
    schema_version: "spec020-openapi-detail-gap-classification-v1",
    status: "classification_only",
    review_state: "documentation_and_surface_decision_readiness",
    source: {
      baseline_ref: baselineRef,
      dispatch_artifact: "http-generic-api/frontend-surface-dispatch.generated.json",
      dispatch_source_digest: sourceDigest,
      dispatch_artifact_sha256: dispatchArtifactSha256,
    },
    coverage: {
      operation_count: plan.coverage.operation_count,
      openapi_documented_count: plan.coverage.openapi_documented_count,
      openapi_canonical_documented_count: plan.coverage.openapi_canonical_documented_count,
      openapi_generated_index_count: plan.coverage.openapi_generated_index_count,
      openapi_gap_count: plan.coverage.openapi_gap_count,
      auth_contract_gap_count: plan.coverage.auth_contract_gap_count,
      openapi_detail_gap_count: plan.coverage.openapi_detail_gap_count,
      unresolved_surface_decision_count: plan.coverage.unresolved_surface_decision_count,
      coverage_complete: plan.coverage.coverage_complete,
    },
    distributions: {
      surface_decisions_by_family: surfaceDecisionCounts,
      detail_gap_entries_by_surface_decision: detailDecisionCounts,
      detail_gap_entries_by_method: methodCounts,
      detail_gap_entries_by_path_first_segment: pathCounts,
      detail_gap_entries_by_family: familyCounts,
    },
    priority_rules: [
      {
        id: "canonical-contract-blocker",
        condition: "openapi_gap_count > 0 OR auth_contract_gap_count > 0",
        tier: "blocking_contract_gap",
        action: "stop_and_open_separate_contract_repair_review",
      },
      {
        id: "surface-decision-review",
        condition: "family.surface_decision.decision == requires_review",
        tier: "surface_decision_required",
        action: "document_owner_and_decision_before_any_projection",
      },
      {
        id: "detail-traceability-only",
        condition: "openapi_detail_gap_count > 0 AND openapi_gap_count == 0",
        tier: "documentation_only",
        action: "classify_and_add_evidence_without_claiming_canonical_coverage",
      },
    ],
    priority_summary: {
      blocking_contract_gap_count: plan.coverage.openapi_gap_count + plan.coverage.auth_contract_gap_count,
      surface_decision_required_family_count: requiresReviewFamilies.length,
      documentation_only_detail_gap_count: plan.coverage.openapi_detail_gap_count,
      top_surface_decision_families: requiresReviewFamilies.slice(0, 30),
    },
    scope_boundary: {
      route_wiring: false,
      runtime_authority: false,
      rest_projection: false,
      custom_gpt_projection: false,
      remote_mcp_projection: false,
      frontend_projection: false,
      database_write: false,
      migration_apply: false,
      grant_execution: false,
      provider_call: false,
      credential_read: false,
      production_activation: false,
    },
  };
}

function parseMode(argv) {
  if (argv.includes("--write")) return "write";
  if (argv.includes("--check")) return "check";
  return "check";
}

function main() {
  const mode = parseMode(process.argv.slice(2));
  const generated = buildClassification();
  if (mode === "write") {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(generated, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, mode, output: OUTPUT_PATH, coverage: generated.coverage }));
    return;
  }
  if (!existsSync(OUTPUT_PATH)) throw new Error(`Missing generated classification: ${OUTPUT_PATH}`);
  const persisted = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  assert.deepEqual(persisted, generated, "OpenAPI detail-gap classification drift detected");
  console.log(JSON.stringify({ ok: true, mode, output: OUTPUT_PATH, coverage: generated.coverage }));
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();

export { buildClassification, collectDetailGapRows };
