import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDispatchPlan } from "./frontend-surface-dispatch.mjs";

const API_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPOSITORY_ROOT = resolve(API_ROOT, "..");
const OUTPUT_PATH = resolve(REPOSITORY_ROOT, "specs/020-platform-resource-identity-brand-governance/openapi-gap-closure-plan.json");
const DISPATCH_PATH = resolve(API_ROOT, "frontend-surface-dispatch.generated.json");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function familyPriority(family) {
  const decision = String(family.surface_decision?.decision || "unclassified");
  if (decision === "requires_review") return "P1_surface_decision";
  if ((family.openapi_detail_gaps || []).length > 0) return "P2_detail_traceability";
  return "P3_observe";
}

function familyNextAction(family) {
  const decision = String(family.surface_decision?.decision || "unclassified");
  if (decision === "requires_review") return "assign_owner_and_record_surface_decision_before_projection";
  if ((family.openapi_detail_gaps || []).length > 0) return "add_detail_evidence_without_claiming_canonical_coverage";
  return "continue_deterministic_observation_and_regression_checks";
}

function buildPlan() {
  const baselineRef = "main";
  const dispatch = buildDispatchPlan({ apiRoot: API_ROOT, baselineRef });
  const dispatchArtifact = JSON.parse(readFileSync(DISPATCH_PATH, "utf8"));
  const families = (dispatch.families || []).map((family) => {
    const decision = String(family.surface_decision?.decision || "unclassified");
    const detailGapCount = (family.openapi_detail_gaps || []).length;
    return {
      family_key: String(family.family_key || "unknown"),
      label: String(family.label || family.family_key || "unknown"),
      scope: String(family.scope || "unresolved"),
      surface_decision: decision,
      priority: familyPriority(family),
      detail_gap_count: detailGapCount,
      operation_count: (family.operations || []).length,
      untested_operation_count: (family.untested_operations || []).length,
      unresolved_operation_count: (family.operations || []).filter((operation) => operation.governance?.classification === "unresolved").length,
      next_action: familyNextAction(family),
      activation_allowed: false,
      evidence_refs: unique(family.source_refs || []),
    };
  }).sort((left, right) => left.priority.localeCompare(right.priority) || right.detail_gap_count - left.detail_gap_count || left.family_key.localeCompare(right.family_key));

  assert.equal(dispatch.coverage.openapi_gap_count, 0, "gap-closure plan must not hide OpenAPI presence gaps");
  assert.equal(dispatch.coverage.auth_contract_gap_count, 0, "gap-closure plan must not hide auth contract gaps");
  assert.equal(families.length, dispatch.coverage.mounted_family_count, "family inventory must match dispatch coverage");

  const priorityCounts = Object.fromEntries(["P1_surface_decision", "P2_detail_traceability", "P3_observe"].map((priority) => [
    priority,
    families.filter((family) => family.priority === priority).length,
  ]));
  const decisionCounts = Object.fromEntries(unique(families.map((family) => family.surface_decision)).map((decision) => [
    decision,
    families.filter((family) => family.surface_decision === decision).length,
  ]));

  return {
    $schema: "https://schemas.mad4b.com/spec020/openapi-gap-closure-plan.schema.json",
    schema_version: "spec020-openapi-gap-closure-plan-v1",
    status: "bounded_comprehensive_readiness",
    review_state: "all_safe_read_only_closures_recorded_pending_separate_activation_approval",
    source: {
      baseline_ref: baselineRef,
      dispatch_artifact: "http-generic-api/frontend-surface-dispatch.generated.json",
      dispatch_source_digest: dispatch.baseline?.source_digest || dispatchArtifact.baseline?.source_digest || null,
      dispatch_artifact_sha256: sha256(DISPATCH_PATH),
    },
    coverage: {
      operation_count: dispatch.coverage.operation_count,
      mounted_family_count: dispatch.coverage.mounted_family_count,
      openapi_gap_count: dispatch.coverage.openapi_gap_count,
      auth_contract_gap_count: dispatch.coverage.auth_contract_gap_count,
      openapi_detail_gap_count: dispatch.coverage.openapi_detail_gap_count,
      unresolved_surface_decision_count: dispatch.coverage.unresolved_surface_decision_count,
      unresolved_operation_class_count: dispatch.coverage.unresolved_operation_class_count,
      untested_family_count: dispatch.coverage.untested_family_count,
      untested_operation_count: dispatch.coverage.untested_operation_count,
      coverage_complete: dispatch.coverage.coverage_complete,
    },
    closure_summary: {
      blocking_contract_gaps: dispatch.coverage.openapi_gap_count + dispatch.coverage.auth_contract_gap_count,
      read_only_traceability_closures: dispatch.coverage.openapi_detail_gap_count,
      surface_decisions_requiring_owner: dispatch.coverage.unresolved_surface_decision_count,
      priority_family_counts: priorityCounts,
      surface_decision_family_counts: decisionCounts,
      all_safe_closures_included: true,
      activation_remains_separate: true,
    },
    workstreams: [
      { id: "canonical_openapi_contract", status: "closed_zero_gap", evidence: "dispatch.coverage.openapi_gap_count" },
      { id: "auth_contract", status: "closed_zero_gap", evidence: "dispatch.coverage.auth_contract_gap_count" },
      { id: "detail_traceability", status: "classified_and_regression_guarded", evidence: "dispatch.coverage.openapi_detail_gap_count" },
      { id: "surface_decision_review", status: "owner_decision_required", evidence: "dispatch.coverage.unresolved_surface_decision_count" },
      { id: "test_ownership", status: "remaining_gap_classified", evidence: "dispatch.coverage.untested_operation_count" },
      { id: "projection_activation", status: "blocked_by_separate_approval", evidence: "scope_boundary" },
      { id: "runtime_authority", status: "forbidden_in_this_pr", evidence: "scope_boundary" },
    ],
    families,
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

function mode(argv) {
  if (argv.includes("--write")) return "write";
  if (argv.includes("--check")) return "check";
  return "check";
}

function main() {
  const currentMode = mode(process.argv.slice(2));
  const generated = buildPlan();
  if (currentMode === "write") {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(generated, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, mode: currentMode, output: OUTPUT_PATH, coverage: generated.coverage, closure_summary: generated.closure_summary }, null, 2));
    return;
  }
  if (!existsSync(OUTPUT_PATH)) throw new Error(`Missing generated gap-closure plan: ${OUTPUT_PATH}`);
  const persisted = JSON.parse(readFileSync(OUTPUT_PATH, "utf8"));
  assert.deepEqual(persisted, generated, "OpenAPI gap-closure plan drift detected");
  console.log(JSON.stringify({ ok: true, mode: currentMode, output: OUTPUT_PATH, coverage: generated.coverage, closure_summary: generated.closure_summary }, null, 2));
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();

export { buildPlan };
