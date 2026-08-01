#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stampEvidenceFile } from "./ci-evidence-source-stamp.mjs";

function fixture(name, report) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-evidence-stamp-"));
  const file = path.join(root, name);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return { root, file };
}

const candidate = { candidateKind: "head", candidateSha: "a".repeat(40) };

{
  const { root, file } = fixture("e2e-phase-evaluation.json", { ok: true, findings: [], secrets_included: false });
  try {
    const result = stampEvidenceFile(file, candidate);
    assert.equal(result.status, "stamped");
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(report.contract, "mad4b.e2e-phase-evaluation.v1");
    assert.equal(report.candidate_kind, "head");
    assert.equal(report.candidate_sha, candidate.candidateSha);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

{
  const { root, file } = fixture("e2e-phase-evaluation.json", { ok: true });
  try {
    assert.throws(() => stampEvidenceFile(file, candidate), /secrets_included=false/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

{
  const { root, file } = fixture("e2e-phase-evaluation.json", { ok: true, secrets_included: false, candidate_sha: "b".repeat(40) });
  try {
    assert.throws(() => stampEvidenceFile(file, candidate), /candidate_sha conflicts/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

{
  const { root, file } = fixture("e2e-phase-evaluation.json", { ok: true, secrets_included: false, contract: "wrong.contract" });
  try {
    assert.throws(() => stampEvidenceFile(file, candidate), /unexpected contract/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

console.log(JSON.stringify({ ok: true, tests: 4, gate: "ci_evidence_source_stamp", secrets_included: false }));
