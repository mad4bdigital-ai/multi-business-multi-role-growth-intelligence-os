import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LEGACY_PUBLISHER = ".github/workflows/hostinger-ci-evidence-pr-publisher.yml";
const CANONICAL_PUBLISHER = ".github/workflows/ci-evidence-pr-publisher.yml";
const CANONICAL_CANARY = ".github/workflows/hostinger-storage-tenant-canary-canonical-guard.yml";
const ROUTING = ".github/ci-evidence-routing.json";
const BOOTSTRAP_TEST = ".github/tests/spec014/hostinger-tenant-canary-main-bootstrap.mjs";
const CONTRACTS = [
  ".changes/e2e/hostinger-tenant-canary-context-availability-fix.json",
  ".changes/e2e/hostinger-tenant-canary-main-bootstrap.json",
  ".changes/e2e/hostinger-tenant-canary-workflow-reregistration.json",
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

for (const requiredPath of [CANONICAL_PUBLISHER, CANONICAL_CANARY, ROUTING, BOOTSTRAP_TEST]) {
  assert(fs.existsSync(path.join(ROOT, requiredPath)), `missing canonical evidence dependency: ${requiredPath}`);
}
assert(!fs.existsSync(path.join(ROOT, LEGACY_PUBLISHER)), "legacy Hostinger-only publisher must remain retired");

for (const contractPath of CONTRACTS) {
  const source = read(contractPath);
  const contract = JSON.parse(source);
  assert(!source.includes(LEGACY_PUBLISHER), `${contractPath} still references the retired publisher`);
  const current = contract.phases.find((phase) => phase.id === contract.current_phase);
  assert.equal(current?.status, "implemented", `${contractPath} current phase must remain implemented`);
  assert(current.e2e_journeys.length > 0, `${contractPath} must retain an executable journey`);
  for (const journey of current.e2e_journeys) {
    assert(journey.evidence_paths.includes(CANONICAL_PUBLISHER), `${contractPath} must bind the canonical publisher`);
    assert(!journey.evidence_paths.includes(LEGACY_PUBLISHER), `${contractPath} must not bind the retired publisher`);
    for (const evidencePath of journey.evidence_paths) {
      assert(fs.existsSync(path.join(ROOT, evidencePath)), `${contractPath} has missing evidence: ${evidencePath}`);
    }
  }
}

const publisher = read(CANONICAL_PUBLISHER);
assert(publisher.includes("Hostinger Storage Tenant Canary Guard"), "canonical publisher must subscribe to the Tenant Canary workflow");
assert(publisher.includes("hostinger-storage-tenant-canary-${{ github.event.workflow_run.id }}-summary"), "canonical publisher must download the run-bound Tenant Canary artifact");
assert(publisher.includes("hostinger-ci-evidence-pr-comment.mjs"), "canonical publisher must invoke the bounded Hostinger evidence renderer");
assert(publisher.includes("ref: main"), "canonical publisher must execute from trusted main");

console.log("Hostinger evidence publisher reference parity tests passed");
