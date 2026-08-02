import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateEvidenceIntegrity } from "./scripts/e2e-contract-reference-integrity.mjs";

function write(root, relativePath, content = "evidence\n") {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function contract(featureKey, evidencePaths) {
  return {
    schema_version: 1,
    feature_key: featureKey,
    title: `${featureKey} evidence contract`,
    delivery_mode: "single_pr",
    current_phase: "mvp",
    scope: { include: [`src/${featureKey}.js`] },
    merge_contract: { minimum_phase: "mvp" },
    phases: [
      {
        id: "mvp",
        status: "implemented",
        objective: "Prove exact repository evidence integrity.",
        e2e_journeys: [
          {
            id: `${featureKey}-journey`,
            end_to_end: true,
            level: "synthetic_runtime",
            actor: "repository reviewer",
            entrypoint: "candidate repository tree",
            terminal_outcome: "Every implemented evidence reference resolves to a regular repository file on the candidate head.",
            steps: ["Load the contract.", "Resolve every evidence path."],
            assertions: ["Missing, deleted, non-file, or symbolic-link evidence fails closed."],
            tests: [
              {
                id: `${featureKey}-test`,
                runner: "node",
                working_directory: ".",
                path: "test.mjs",
                args: [],
              },
            ],
            evidence_paths: evidencePaths,
          },
        ],
      },
    ],
  };
}

function writeContract(root, relativePath, payload) {
  write(root, relativePath, `${JSON.stringify(payload, null, 2)}\n`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-reference-integrity-"));
write(root, "test.mjs", "console.log('fixture');\n");
write(root, "evidence/present.json", "{}\n");
writeContract(root, ".changes/e2e/valid.json", contract("valid", ["evidence/present.json"]));

const valid = evaluateEvidenceIntegrity({
  root,
  changedEntries: [{ status: "M", path: ".changes/e2e/valid.json", old_path: null }],
});
assert.equal(valid.ok, true);
assert.deepEqual(valid.targeted_contracts, [".changes/e2e/valid.json"]);
assert.equal(valid.checked_evidence[0].regular_file, true);
assert.equal(valid.checked_evidence[0].symbolic_link, false);

writeContract(root, ".changes/e2e/missing.json", contract("missing", ["evidence/not-created.json"]));
const missing = evaluateEvidenceIntegrity({
  root,
  changedEntries: [{ status: "A", path: ".changes/e2e/missing.json", old_path: null }],
});
assert.equal(missing.ok, false);
assert(missing.findings.some((finding) => finding.code === "missing_implemented_journey_evidence"));

write(root, "evidence/deleted.json", "{}\n");
writeContract(root, ".changes/e2e/deletion.json", contract("deletion", ["evidence/deleted.json"]));
fs.unlinkSync(path.join(root, "evidence/deleted.json"));
const deletion = evaluateEvidenceIntegrity({
  root,
  changedEntries: [{ status: "D", path: "evidence/deleted.json", old_path: null }],
});
assert.equal(deletion.ok, false);
assert(deletion.deletion_affected_contracts.includes(".changes/e2e/deletion.json"));
assert(deletion.findings.some((finding) => finding.code === "deleted_evidence_still_referenced"));

writeContract(root, ".changes/e2e/retired.json", contract("retired", ["evidence/present.json"]));
fs.unlinkSync(path.join(root, ".changes/e2e/retired.json"));
const deletedContract = evaluateEvidenceIntegrity({
  root,
  changedEntries: [{ status: "D", path: ".changes/e2e/retired.json", old_path: null }],
});
assert.equal(deletedContract.ok, false);
assert.deepEqual(deletedContract.deleted_contracts, [".changes/e2e/retired.json"]);
assert(deletedContract.findings.some((finding) =>
  finding.code === "deleted_or_renamed_e2e_contract_requires_explicit_retirement"));

fs.symlinkSync("present.json", path.join(root, "evidence/symbolic.json"));
writeContract(root, ".changes/e2e/symbolic.json", contract("symbolic", ["evidence/symbolic.json"]));
const symbolic = evaluateEvidenceIntegrity({
  root,
  changedEntries: [{ status: "A", path: ".changes/e2e/symbolic.json", old_path: null }],
});
assert.equal(symbolic.ok, false);
assert(symbolic.findings.some((finding) => finding.code === "symbolic_link_evidence_not_allowed"));

writeContract(root, ".changes/e2e/legacy-stale.json", contract("legacy-stale", ["evidence/legacy-missing.json"]));
const ratchet = evaluateEvidenceIntegrity({
  root,
  changedEntries: [{ status: "M", path: "docs/unrelated.md", old_path: null }],
});
assert.equal(ratchet.ok, true);
assert.equal(ratchet.targeted_contracts.length, 0);

const fullAudit = evaluateEvidenceIntegrity({ root, all: true });
assert.equal(fullAudit.ok, false);
assert(fullAudit.findings.some((finding) =>
  finding.code === "missing_implemented_journey_evidence"
  && finding.contract_path === ".changes/e2e/legacy-stale.json"));
assert(fullAudit.findings.some((finding) =>
  finding.code === "symbolic_link_evidence_not_allowed"
  && finding.contract_path === ".changes/e2e/symbolic.json"));

fs.rmSync(root, { recursive: true, force: true });
console.log("E2E contract reference integrity tests passed");
