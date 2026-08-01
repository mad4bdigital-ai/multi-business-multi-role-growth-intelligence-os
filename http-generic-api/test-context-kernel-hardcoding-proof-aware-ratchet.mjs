import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hasScannerVisibleSelectionProof,
  scanRepository,
} from "./scripts/context-kernel-hardcoding-scan.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-kernel-proof-aware-ratchet-"));
const files = {
  "guarded.js": [
    "export function one(rows) {",
    "  if (rows.length > 1) throw new Error('ambiguous');",
    "  return rows[0] ?? null;",
    "}",
  ].join("\n"),
  "exact-query.js": [
    "export async function read(pool, proposalId) {",
    "  const [rows] = await pool.query(",
    "    'SELECT * FROM proposals WHERE proposal_id = ? LIMIT 1',",
    "    [proposalId],",
    "  );",
    "  return rows[0] ?? null;",
    "}",
  ].join("\n"),
  "ordered.js": [
    "export async function latest(pool, proposalId) {",
    "  const [rows] = await pool.query(",
    "    'SELECT * FROM approvals WHERE proposal_id = ? ORDER BY created_at DESC, approval_id DESC LIMIT 2',",
    "    [proposalId],",
    "  );",
    "  return rows[0] ?? null;",
    "}",
  ].join("\n"),
  "unsafe.js": [
    "export function first(rows) {",
    "  return rows[0] ?? null;",
    "}",
  ].join("\n"),
  "wrong-variable.js": [
    "export function wrong(rows, candidates) {",
    "  if (candidates.length > 1) throw new Error('ambiguous');",
    "  return rows[0] ?? null;",
    "}",
  ].join("\n"),
};

try {
  for (const [relative, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, relative), `${content}\n`, "utf8");
  }

  const proofFinding = (file, line) => ({
    rule_id: "first_candidate_selection",
    path: file,
    line,
  });

  assert.equal(hasScannerVisibleSelectionProof({
    repositoryRoot: root,
    finding: proofFinding("guarded.js", 3),
  }), true);
  assert.equal(hasScannerVisibleSelectionProof({
    repositoryRoot: root,
    finding: proofFinding("exact-query.js", 6),
  }), true);
  assert.equal(hasScannerVisibleSelectionProof({
    repositoryRoot: root,
    finding: proofFinding("ordered.js", 6),
  }), true);
  assert.equal(hasScannerVisibleSelectionProof({
    repositoryRoot: root,
    finding: proofFinding("unsafe.js", 2),
  }), false);
  assert.equal(hasScannerVisibleSelectionProof({
    repositoryRoot: root,
    finding: proofFinding("wrong-variable.js", 3),
  }), false);

  const changedFiles = Object.keys(files);
  const changedLineRanges = new Map(changedFiles.map((file) => [
    file,
    [{ start: 1, end: files[file].split(/\r?\n/u).length }],
  ]));
  const report = scanRepository({
    repositoryRoot: root,
    config: {
      schema_version: 1,
      scan_roots: ["."],
      extensions: [".js"],
      exclude_path_segments: [],
      approved_findings: [],
    },
    changedFiles,
    changedLineRanges,
  });

  const findings = report.findings.filter((finding) => finding.rule_id === "first_candidate_selection");
  assert.equal(findings.length, 5);
  assert.equal(findings.filter((finding) => finding.suppressed).length, 3);
  assert.equal(report.summary.runtime_finding_count, 2);
  assert.equal(report.summary.suppressed_count, 3);
  assert.deepEqual(
    findings.filter((finding) => !finding.suppressed).map((finding) => finding.path).sort(),
    ["unsafe.js", "wrong-variable.js"],
  );

  console.log("context kernel hardcoding proof-aware ratchet tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
