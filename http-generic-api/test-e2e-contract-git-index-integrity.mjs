import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enforceGitIndexIntegrity } from "./scripts/e2e-contract-git-index-integrity.mjs";

function runGit(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(root, relativePath, content = "evidence\n") {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function baseReport(contractPath, evidencePath) {
  return {
    schema_version: 1,
    contract: "mad4b.e2e-contract-reference-integrity.v1",
    enforcement_mode: "fail_closed",
    evaluation_mode: "changed_contracts_and_deleted_evidence",
    ok: true,
    targeted_contracts: [contractPath],
    checked_evidence: [{ contract_path: contractPath, path: evidencePath }],
    findings: [],
    secrets_included: false,
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-git-index-integrity-"));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-git-index-outside-"));
try {
  runGit(root, ["init", "--quiet"]);
  write(root, ".changes/e2e/valid.json", "{}\n");
  write(root, "evidence/present.json", "{}\n");
  runGit(root, ["add", ".changes/e2e/valid.json", "evidence/present.json"]);

  const valid = enforceGitIndexIntegrity({
    root,
    report: baseReport(".changes/e2e/valid.json", "evidence/present.json"),
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.findings.length, 0);
  assert(valid.path_integrity.every((item) => item.regular_git_blob));
  assert(valid.path_integrity.every((item) => item.symbolic_link_components.length === 0));
  assert(valid.path_integrity.every((item) => item.realpath_inside));

  write(root, "evidence/untracked.json", "{}\n");
  const untracked = enforceGitIndexIntegrity({
    root,
    report: baseReport(".changes/e2e/valid.json", "evidence/untracked.json"),
  });
  assert.equal(untracked.ok, false);
  assert(untracked.findings.some((finding) => finding.code === "repository_path_not_tracked"));

  write(outside, "outside.json", "{}\n");
  fs.symlinkSync(outside, path.join(root, "evidence/linked-directory"), "dir");
  const parentSymlink = enforceGitIndexIntegrity({
    root,
    report: baseReport(".changes/e2e/valid.json", "evidence/linked-directory/outside.json"),
  });
  assert.equal(parentSymlink.ok, false);
  assert(parentSymlink.findings.some((finding) => finding.code === "repository_path_contains_symbolic_link"));
  assert(parentSymlink.findings.some((finding) => finding.code === "repository_path_realpath_escapes_root"));
  assert(parentSymlink.findings.some((finding) => finding.code === "repository_path_not_tracked"));

  fs.symlinkSync("present.json", path.join(root, "evidence/final-link.json"));
  runGit(root, ["add", "evidence/final-link.json"]);
  const finalSymlink = enforceGitIndexIntegrity({
    root,
    report: baseReport(".changes/e2e/valid.json", "evidence/final-link.json"),
  });
  assert.equal(finalSymlink.ok, false);
  assert(finalSymlink.findings.some((finding) => finding.code === "repository_path_contains_symbolic_link"));
  assert(finalSymlink.findings.some((finding) =>
    finding.code === "repository_path_not_regular_stage_zero_blob" && finding.git_mode === "120000"));

  const escaping = enforceGitIndexIntegrity({
    root,
    report: baseReport(".changes/e2e/valid.json", "../outside.json"),
  });
  assert.equal(escaping.ok, false);
  assert(escaping.findings.some((finding) => finding.code === "repository_path_escapes_root"));

  console.log("E2E contract Git index integrity tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}
