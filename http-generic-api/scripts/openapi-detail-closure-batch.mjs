#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const dispatchPath = path.join(root, "http-generic-api/frontend-surface-dispatch.generated.json");
const outputPath = path.join(
  root,
  "specs/020-platform-resource-identity-brand-governance/openapi-detail-closure-batch-full.json",
);
const batchId = "spec020-openapi-detail-closure-batch-full";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const stableJson = (value) => JSON.stringify(value, null, 2) + "\n";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dispatchText = await readFile(dispatchPath, "utf8");
const dispatch = JSON.parse(dispatchText);
const families = dispatch.families;
assert(Array.isArray(families) && families.length > 0, "dispatch has no families");

const detailFamilies = families.filter((family) => {
  assert(Array.isArray(family.operations), `dispatch family has no operations: ${family.family_key}`);
  return family.operations.some((operation) => operation.openapi_contract_level === "operation-index-only");
});
const operations = detailFamilies.flatMap((family) => {
  return family.operations
    .filter((operation) => operation.openapi_contract_level === "operation-index-only")
    .map((operation) => {
  const pathValue = operation.path;
  const evidenceRefs = [
    "http-generic-api/frontend-surface-dispatch.generated.json",
    ...(operation.governance?.evidence_refs ?? []),
  ];
  assert(operation.openapi_contract_level === "operation-index-only", `unexpected contract level: ${operation.signature}`);
  assert(operation.openapi_documented === true, `operation is not OpenAPI documented: ${operation.signature}`);
  assert(operation.openapi_canonical_documented === false, `operation is already canonical: ${operation.signature}`);
  assert(operation.auth_parity?.state === "equivalent", `auth parity is not equivalent: ${operation.signature}`);
  assert(operation.governance?.classification, `missing governance classification: ${operation.signature}`);
    return {
      family_key: family.family_key,
      method: operation.method,
    path: pathValue,
    signature: operation.signature,
    source_file: operation.source_file,
    scope: operation.scope,
    delivery_kind: operation.delivery_kind,
    openapi_contract_level: operation.openapi_contract_level,
    auth_parity: operation.auth_parity.state,
    governance_classification: operation.governance.classification,
    governance_rule_id: operation.governance.rule_id,
    evidence_refs: [...new Set(evidenceRefs)].sort(),
    closure_status: "detail_evidence_required",
    canonical_openapi_added: false,
    route_wiring: false,
    runtime_authority: false,
      production_activation: false,
    };
  });
});

const artifact = {
  $schema: "https://schemas.mad4b.com/spec020/openapi-detail-closure-batch.schema.json",
  schema_version: "spec020-openapi-detail-closure-batch-v1",
  status: "shadow_detail_evidence_batch",
  batch_id: batchId,
  source: {
    baseline_ref: "main",
    dispatch_artifact: "http-generic-api/frontend-surface-dispatch.generated.json",
    dispatch_artifact_sha256: sha256(dispatchText),
    family_count: families.length,
    detail_family_count: detailFamilies.length,
    dispatch_operation_count: dispatch.coverage.operation_count,
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
  exclusions: [
    "All dispatch families and paths are included; no family or path exclusion is applied",
    "canonical OpenAPI projection",
    "runtime route wiring",
    "runtime authority activation",
  ],
  closure_policy: {
    priority: "P2_detail_traceability",
    action: "add_detail_evidence_without_claiming_canonical_coverage",
    canonical_openapi_added: false,
    evidence_only: true,
  },
  summary: {
    family_count: detailFamilies.length,
    dispatch_family_count: families.length,
    operation_count: operations.length,
    detail_evidence_required_count: operations.length,
    canonical_openapi_added_count: 0,
    excluded_scope_count: 0,
  },
  operations,
};

const output = stableJson(artifact);
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8");
  assert(current === output, `artifact is stale: ${path.relative(root, outputPath)}`);
  console.log(JSON.stringify({ ok: true, mode: "check", batch_id: artifact.batch_id, operation_count: operations.length }));
} else {
  await writeFile(outputPath, output);
  console.log(JSON.stringify({ ok: true, mode: "write", output: path.relative(root, outputPath), operation_count: operations.length }));
}
