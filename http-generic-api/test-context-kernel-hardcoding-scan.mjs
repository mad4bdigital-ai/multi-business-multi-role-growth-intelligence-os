import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatReport,
  parseChangedLineRanges,
  readChangedFiles,
  scanRepository,
} from "./scripts/context-kernel-hardcoding-scan.mjs";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-kernel-scan-"));

try {
  fs.mkdirSync(path.join(temporaryRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, "tests"), { recursive: true });

  fs.writeFileSync(path.join(temporaryRoot, "src", "resolver.js"), `
const tenantId = "11111111-2222-4333-8444-555555555555";
const selectedConnection = connections[0];
const connectionRows = await db.query("SELECT * FROM connections WHERE tenant_id = ? LIMIT 1");
const grantMode = requestedMode || "permissive";
const resolvedRows = await resolveConnection().catch(() => [[]]);
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "src", "zero-scope.js"), `
const DEFAULT_SCOPE = {
  tenant_id: "00000000-0000-0000-0000-000000000000",
  workspace_id: "missing"
};
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "src", "clean.js"), `
export function resolveTenantRef(principal) {
  return principal.tenantRef;
}
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "src", "suppressed.js"), `
// context-kernel-scan: allow fixed_customer_identifier -- Synthetic compatibility fixture with an external protocol.
const customerRef = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "tests", "fixture.js"), `
export const tenantFixture = "99999999-8888-4777-8666-555555555555";
`, "utf8");

  const config = {
    schema_version: 1,
    mode: "runtime_ratchet",
    scan_roots: ["src", "tests"],
    exclude_path_segments: ["node_modules", ".git"],
    extensions: [".js"],
  };

  const report = scanRepository({ repositoryRoot: temporaryRoot, config });
  const active = report.findings.filter((item) => !item.suppressed);
  const runtimeRules = new Set(active.filter((item) => item.zone === "runtime").map((item) => item.rule_id));

  for (const ruleId of [
    "fixed_customer_identifier",
    "zero_scope_fallback",
    "first_candidate_selection",
    "unproven_single_candidate_query",
    "silent_resolution_failure",
    "permissive_authority_default",
    "implicit_scope_default",
  ]) assert(runtimeRules.has(ruleId), `expected runtime rule ${ruleId}`);

  assert.equal(report.scan_scope, "repository");
  assert.equal(report.changed_file_count, null);
  assert(active.some((item) => item.zone === "test" && item.rule_id === "fixed_customer_identifier"));
  assert(report.findings.some((item) => item.path.endsWith("suppressed.js") && item.rule_id === "fixed_customer_identifier" && item.suppressed));

  const cleanChangedReport = scanRepository({
    repositoryRoot: temporaryRoot,
    config,
    changedFiles: ["src/clean.js", "docs/deleted.md"],
  });
  assert.equal(cleanChangedReport.scan_scope, "changed_files");
  assert.equal(cleanChangedReport.changed_file_count, 2);
  assert.equal(cleanChangedReport.summary.scanned_files, 1);
  assert.equal(cleanChangedReport.summary.runtime_finding_count, 0);
  assert.deepEqual(cleanChangedReport.findings, []);

  const failingChangedReport = scanRepository({
    repositoryRoot: temporaryRoot,
    config,
    changedFiles: ["./src/resolver.js"],
  });
  assert.equal(failingChangedReport.scan_scope, "changed_files");
  assert.equal(failingChangedReport.summary.scanned_files, 1);
  assert.ok(failingChangedReport.summary.runtime_finding_count > 0);
  assert.ok(failingChangedReport.findings.every((item) => item.path === "src/resolver.js"));

  const parsedRanges = parseChangedLineRanges([
    "diff --git a/src/resolver.js b/src/resolver.js",
    "--- a/src/resolver.js",
    "+++ b/src/resolver.js",
    "@@ -1,0 +2,1 @@",
    "+const tenantId = synthetic;",
    "@@ -8,2 +10,0 @@",
  ].join("\n"));
  assert.deepEqual(parsedRanges.get("src/resolver.js"), [{ start: 2, end: 2 }]);

  const changedLineReport = scanRepository({
    repositoryRoot: temporaryRoot,
    config,
    changedFiles: ["src/resolver.js"],
    changedLineRanges: new Map([["src/resolver.js", [{ start: 2, end: 2 }]]]),
  });
  assert.equal(changedLineReport.scan_scope, "changed_lines");
  assert.deepEqual(
    changedLineReport.findings.filter((item) => !item.suppressed).map((item) => item.rule_id),
    ["fixed_customer_identifier"],
  );

  const unchangedDebtReport = scanRepository({
    repositoryRoot: temporaryRoot,
    config,
    changedFiles: ["src/resolver.js"],
    changedLineRanges: new Map([["src/resolver.js", [{ start: 1, end: 1 }]]]),
  });
  assert.equal(unchangedDebtReport.scan_scope, "changed_lines");
  assert.equal(unchangedDebtReport.summary.runtime_finding_count, 0);

  const changedFilesPath = path.join(temporaryRoot, "changed-files.txt");
  fs.writeFileSync(changedFilesPath, "./src/clean.js\n\nsrc/resolver.js\n", "utf8");
  assert.deepEqual(readChangedFiles(changedFilesPath), ["src/clean.js", "src/resolver.js"]);
  assert.equal(readChangedFiles(""), null);

  const serialized = JSON.stringify(report);
  assert(!serialized.includes("11111111-2222-4333-8444-555555555555"));
  assert(!serialized.includes("00000000-0000-0000-0000-000000000000"));
  assert.match(formatReport(report, "text"), /Mode: runtime_ratchet/);
  assert.match(formatReport(report, "text"), /Scope: repository/);
  assert.match(formatReport(failingChangedReport, "github"), /::warning/);
  assert.match(formatReport(failingChangedReport, "github"), /changed_files/);
  assert.match(formatReport(changedLineReport, "github"), /changed_lines/);

  console.log("context-kernel hardcoding scanner tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
