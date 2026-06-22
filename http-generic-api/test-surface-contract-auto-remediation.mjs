import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildAttestation,
  convergeGeneratedState,
  isAutoEligible,
  renderGeneratedBlock,
  upsertGeneratedBlock,
  validateManualAttestation,
} from "./scripts/surface-contract-auto-remediator.mjs";

const safeItem = {
  migration_file: "9999_safe_surface.sql",
  queue_class: "high_review",
  gap_severity: "medium",
  missing_openapi_routes: [],
  surface_counts: { plugins: 0, tools: 1, views: 1, policies: 0, routes: 0 },
  remediation: [
    { action_key: "document_surface_contract", targets: ["docs/example.md"] },
    { action_key: "verify_tool_registry_binding", targets: ["example_tool"] },
    { action_key: "verify_readback_view", targets: ["v_example"] },
    { action_key: "add_explicit_safety_markers", targets: ["no_external_write"] },
  ],
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

assert.equal(isAutoEligible(safeItem), true, "safe docs/safety-only queue items should be auto eligible");
assert.equal(isAutoEligible({ ...safeItem, missing_openapi_routes: ["/missing"] }), false, "OpenAPI gaps must remain manual");
assert.equal(isAutoEligible({ ...safeItem, safety: { ...safeItem.safety, executes_provider_calls: true } }), false, "provider-capable items must remain manual");

const safeSql = `
-- Additive readback-only migration.
CREATE OR REPLACE VIEW v_example AS SELECT 1 AS ok;
`;
const attested = buildAttestation({ item: safeItem, source: safeSql });
assert.equal(attested.eligible, true, "safe additive SQL should receive a checksum-bound attestation");
assert.match(attested.attestation.migration_sha256, /^[0-9a-f]{64}$/);
assert.equal(attested.attestation.preflight_status, "pass");
assert.equal(attested.attestation.preflight_risk_count, 0);
assert.equal(attested.attestation.safety_markers.no_provider_call, true);
assert.equal(attested.attestation.safety_markers.secrets_included_false, true);
assert.deepEqual(
  attested.attestation.runtime_reviews.map((entry) => entry.action_key),
  ["verify_readback_view", "verify_tool_registry_binding"],
  "runtime reviews should remain explicit evidence requirements",
);

const descriptiveGrantSql = `
INSERT INTO example_registry (description)
VALUES ('This binding does not grant provider-write authority by itself.')
ON DUPLICATE KEY UPDATE description = VALUES(description);
`;
const descriptiveGrant = buildAttestation({ item: safeItem, source: descriptiveGrantSql });
assert.equal(descriptiveGrant.eligible, true, "descriptive grant text followed by ON DUPLICATE must not be treated as a GRANT statement");

const descriptiveExecuteSql = `
-- This route cannot execute or install source assets.
INSERT INTO example_registry (description)
VALUES ('No source execution or external send.')
ON DUPLICATE KEY UPDATE description = VALUES(description);
`;
const descriptiveExecute = buildAttestation({ item: safeItem, source: descriptiveExecuteSql });
assert.equal(descriptiveExecute.eligible, true, "descriptive execute text must not be treated as an EXECUTE statement");

const actualGrant = buildAttestation({ item: safeItem, source: "GRANT SELECT ON example.* TO 'reader'@'%';" });
assert.equal(actualGrant.eligible, false, "actual GRANT statements must remain manual review only");
assert(actualGrant.reasons.includes("forbidden_sql_pattern_detected"));

const actualExecute = buildAttestation({ item: safeItem, source: "EXECUTE prepared_statement;" });
assert.equal(actualExecute.eligible, false, "actual EXECUTE statements must remain manual review only");
assert(actualExecute.reasons.includes("forbidden_sql_pattern_detected"));

const manualManifest = JSON.parse(readFileSync("../docs/surface-contract-manual-safety-attestations.json", "utf8"));
assert.equal(manualManifest.schema_version, "surface-contract-manual-safety-attestations-v1");
assert.equal(manualManifest.item_count, manualManifest.items.length);
const manualItem = manualManifest.items.find((item) => item.migration_file === "1013_sprint69_approval_hold_identity_collation_alignment.sql");
assert(manualItem, "manual registry should include the guarded approval-hold collation migration");
const manualSource = readFileSync(`migrations/${manualItem.migration_file}`, "utf8");
const manualValidation = validateManualAttestation({ item: manualItem, source: manualSource });
assert.equal(manualValidation.valid, true, `manual attestation should validate: ${manualValidation.reasons.join(", ")}`);
assert.equal(manualValidation.actual.preflight_risk_count, 0);
assert.equal(manualValidation.actual.preflight_status, "pass");
assert.equal(manualValidation.actual.forbidden_patterns.length, 2);
assert.equal(manualValidation.attestation.execution_authorized, false);

const windowsLineEndings = manualSource.replace(/\r?\n/g, "\r\n");
const windowsLineEndingValidation = validateManualAttestation({ item: manualItem, source: windowsLineEndings });
assert.equal(windowsLineEndingValidation.valid, true, "manual attestation checksum must be stable across LF and CRLF checkouts");

const checksumDrift = validateManualAttestation({ item: manualItem, source: `${manualSource}\n-- drift` });
assert.equal(checksumDrift.valid, false, "manual attestations must fail closed on checksum drift");
assert(checksumDrift.reasons.includes("manual_attestation_checksum_mismatch"));

const missingReviewer = validateManualAttestation({ item: { ...manualItem, reviewed_by: "" }, source: manualSource });
assert.equal(missingReviewer.valid, false, "manual attestations require an explicit reviewer");
assert(missingReviewer.reasons.includes("manual_attestation_reviewer_missing"));

const tamperedForbiddenReview = validateManualAttestation({ item: { ...manualItem, accepted_forbidden_patterns: [] }, source: manualSource });
assert.equal(tamperedForbiddenReview.valid, false, "manual attestations must enumerate every accepted forbidden SQL pattern");
assert(tamperedForbiddenReview.reasons.includes("manual_attestation_forbidden_patterns_mismatch"));

const convergenceStates = [
  { id: "first", added: ["first.sql"], attestations: [{ migration_file: "first.sql" }], manual: [] },
  { id: "second", added: ["second.sql"], attestations: [{ migration_file: "first.sql" }, { migration_file: "second.sql" }], manual: [] },
  { id: "final", added: [], attestations: [{ migration_file: "first.sql" }, { migration_file: "second.sql" }], manual: [] },
];
let convergenceBuildCount = 0;
const convergenceWrites = [];
const convergence = convergeGeneratedState({
  maxPasses: 4,
  build: () => convergenceStates[Math.min(convergenceBuildCount++, convergenceStates.length - 1)],
  writeState: (state) => convergenceWrites.push(state.id),
  runDiscovery: () => {},
  runTriage: () => {},
  diffState: (state) => state.id === "final" ? [] : ["pending"],
});
assert.equal(convergence.converged, true, "generated state should converge within the bounded pass limit");
assert.equal(convergence.passes.length, 2, "two-stage generated queues should settle in two write passes");
assert.deepEqual(convergenceWrites, ["first", "second"]);
assert.deepEqual(convergence.added, ["first.sql", "second.sql"]);

const destructive = buildAttestation({ item: safeItem, source: "DELETE FROM execution_policies;" });
assert.equal(destructive.eligible, false, "destructive SQL must never be auto attested");
assert(destructive.reasons.includes("forbidden_sql_pattern_detected"));

const block = renderGeneratedBlock([attested.attestation]);
assert(block.includes("surface-contract-auto-remediation:start"));
assert(block.includes("9999_safe_surface.sql"));
assert(block.includes("does not authorize execution"));

const original = "# Example\n\nHuman text.\n";
const once = upsertGeneratedBlock(original, block);
const twice = upsertGeneratedBlock(once, block);
assert.equal(once, twice, "generated block updates must be idempotent");
assert.equal((once.match(/surface-contract-auto-remediation:start/g) || []).length, 1);

const discovery = readFileSync("scripts/surface-contract-discovery.mjs", "utf8");
assert(discovery.includes("surface-contract-safety-attestations-v1"));
assert(discovery.includes("item.migration_sha256 !== sha256(source)"), "discovery must reject checksum drift");
assert(discovery.includes("canonicalizeChecksumText"), "discovery and remediator must share line-ending-independent checksum semantics");
assert(discovery.includes("utf8_lf_v1"), "discovery must expose the checksum canonicalization contract");
assert(discovery.includes("verified_static_no_external_side_effects"));

const workflow = readFileSync("../.github/workflows/surface-contract-auto-remediation.yml", "utf8");
assert(workflow.includes("schedule:"), "automation must run on a schedule");
assert(workflow.includes("Enforce documentation-only mutation boundary"));
assert(workflow.includes("git status --porcelain=v1 -z"), "workflow must parse changed paths with NUL delimiters");
assert(workflow.includes('changed+=("${entry:3}")'), "workflow must preserve spaces in repository paths");
assert(!workflow.includes("git status --porcelain | sed"), "quoted porcelain paths must not be parsed with sed");
assert(workflow.includes("auto_merge_eligible"));
assert(workflow.includes('if gh pr merge "$PR_URL" --auto --squash; then'), "auto-merge requests must not fail the workflow when repository auto-merge is disabled");
assert(workflow.includes("Repository auto-merge is unavailable; the remediation PR remains open for governed review."), "workflow must leave a clear governed-review fallback warning");
assert(!workflow.includes("http-generic-api/migrations/*.sql\n          git add"), "workflow must not stage migration SQL");

console.log("surface contract auto remediation tests passed");
