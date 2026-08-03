import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const MIGRATION_FILE = "20260730_hostinger_production_resync_policy.sql";
const POLICY_KEY = "repository_main_moved_trigger_policy_v1";
const MIGRATION_PATH = path.join(API_ROOT, "migrations", MIGRATION_FILE);
const ATTESTATION_PATH = path.join(REPO_ROOT, "docs", "surface-contract-safety-attestations.json");
const CLASSIFICATION_PATH = path.join(API_ROOT, "surface-contract-classification-evidence.json");

function fail(code, details = {}) {
  const error = new Error(code);
  error.details = details;
  throw error;
}

function assert(condition, code, details = {}) {
  if (!condition) fail(code, details);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function canonicalBytes(buffer) {
  return Buffer.from(buffer.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
}

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  return crypto.createHash("sha1").update(Buffer.concat([header, buffer])).digest("hex");
}

function exactSingle(items, predicate, code) {
  const matches = items.filter(predicate);
  assert(matches.length === 1, code, { match_count: matches.length });
  return matches[0];
}

function assertExactObject(actual, expected, code) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), code, { expected, actual });
}

assert(fs.existsSync(MIGRATION_PATH), "hostinger_policy_migration_missing");
assert(fs.existsSync(ATTESTATION_PATH), "hostinger_safety_attestation_missing");
assert(fs.existsSync(CLASSIFICATION_PATH), "hostinger_classification_evidence_missing");

const raw = fs.readFileSync(MIGRATION_PATH);
const canonical = canonicalBytes(raw);
const source = canonical.toString("utf8");
const sha256 = crypto.createHash("sha256").update(canonical).digest("hex");
const blobSha = gitBlobSha(raw);

const attestations = readJson(ATTESTATION_PATH);
assert(attestations.schema_version === "surface-contract-safety-attestations-v1", "hostinger_attestation_schema_mismatch");
assert(Array.isArray(attestations.items), "hostinger_attestation_items_missing");
assert(attestations.item_count === attestations.items.length, "hostinger_attestation_count_mismatch");
const attestation = exactSingle(
  attestations.items,
  (item) => item.migration_file === MIGRATION_FILE,
  "hostinger_attestation_expected_once",
);

assert(attestation.migration_sha256 === sha256, "hostinger_attestation_checksum_mismatch", {
  expected: sha256,
  actual: attestation.migration_sha256,
});
assert(attestation.checksum_canonicalization === "utf8_lf_v1", "hostinger_attestation_canonicalization_mismatch");
assert(attestation.attestation_status === "verified_static_no_external_side_effects", "hostinger_attestation_status_mismatch");
assert(attestation.evidence_mode === "checksum_bound_static_contract", "hostinger_attestation_evidence_mode_mismatch");
assert(attestation.preflight_status === "pass", "hostinger_attestation_preflight_failed");
assert(attestation.preflight_risk_count === 0, "hostinger_attestation_preflight_risks_present");
assertExactObject(attestation.surface_counts, { plugins: 0, tools: 0, views: 0, policies: 1, routes: 0 }, "hostinger_surface_counts_mismatch");
assertExactObject(
  attestation.runtime_reviews,
  [{ action_key: "verify_policy_seed_readiness", targets: [POLICY_KEY] }],
  "hostinger_policy_review_target_mismatch",
);
assertExactObject(
  attestation.safety_markers,
  {
    no_provider_call: true,
    no_credential_payload_read: true,
    no_raw_secrets: true,
    no_external_send: true,
    no_external_write: true,
    secrets_included_false: true,
  },
  "hostinger_safety_markers_mismatch",
);
assertExactObject(
  attestation.safety,
  {
    executes_provider_calls: false,
    reads_credentials: false,
    mutates_runtime: false,
    writes_database: false,
    external_sends: false,
    deploys: false,
    secrets_included: false,
  },
  "hostinger_safety_contract_mismatch",
);

const classification = readJson(CLASSIFICATION_PATH);
assert(Array.isArray(classification.items), "hostinger_classification_items_missing");
const classificationItem = exactSingle(
  classification.items,
  (item) => item.migration_file === MIGRATION_FILE,
  "hostinger_classification_expected_once",
);
assert(classificationItem.source_git_blob_sha === blobSha, "hostinger_classification_blob_mismatch");
assert(classificationItem.classification_status === "verified_evidence_only", "hostinger_classification_status_mismatch");
assertExactObject(classificationItem.route_literals, [], "hostinger_classification_route_literals_mismatch");

const requiredFragments = [
  "-- no_provider_call=true",
  "-- no_credential_payload_read=true",
  "-- no_raw_secrets=true",
  "-- no_external_send=true",
  "-- no_external_write=true",
  "-- no_deploy_execution=true",
  "-- no_restart_execution=true",
  "-- secrets_included=false",
  `'${POLICY_KEY}'`,
  "'provider_calls_forbidden', true",
  "'external_writes_forbidden', true",
  "'deploy_forbidden', true",
  "'restart_forbidden', true",
  "'execution_allowed', false",
  "'same_cycle_readback_required', true",
  "'secrets_included', false",
  "PREPARE repository_main_moved_coordination_stmt FROM @repository_main_moved_coordination_sql;",
  "EXECUTE repository_main_moved_coordination_stmt;",
  "DEALLOCATE PREPARE repository_main_moved_coordination_stmt;",
];
for (const fragment of requiredFragments) {
  assert(source.includes(fragment), "hostinger_required_safety_fragment_missing", { fragment });
}

const prohibitedPatterns = [
  /\bCALL\s+[A-Za-z0-9_.]+\s*\(/i,
  /\bLOAD\s+DATA\b/i,
  /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/i,
  /\b(?:INSTALL|UNINSTALL)\s+PLUGIN\b/i,
  /\b(?:sys_exec|sys_eval)\s*\(/i,
  /\b(?:curl|wget)\s+/i,
];
for (const pattern of prohibitedPatterns) {
  assert(!pattern.test(source), "hostinger_prohibited_external_effect_pattern", { pattern: pattern.source });
}

assert((source.match(/^PREPARE\s+/gim) || []).length === 1, "hostinger_prepare_count_mismatch");
assert((source.match(/^EXECUTE\s+/gim) || []).length === 1, "hostinger_execute_count_mismatch");
assert((source.match(/\bDEALLOCATE\s+PREPARE\s+/gi) || []).length === 1, "hostinger_deallocate_count_mismatch");

console.log(JSON.stringify({
  ok: true,
  migration_file: MIGRATION_FILE,
  policy_key: POLICY_KEY,
  migration_sha256: sha256,
  source_git_blob_sha: blobSha,
  attestation_status: attestation.attestation_status,
  classification_status: classificationItem.classification_status,
  provider_calls: false,
  external_writes: false,
  deploys: false,
  secrets_included: false,
}));
