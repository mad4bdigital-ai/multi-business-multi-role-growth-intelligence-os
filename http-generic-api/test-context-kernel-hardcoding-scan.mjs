import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { formatReport, scanRepository } from "./scripts/context-kernel-hardcoding-scan.mjs";

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

  fs.writeFileSync(path.join(temporaryRoot, "src", "suppressed.js"), `
// context-kernel-scan: allow fixed_customer_identifier -- Synthetic compatibility fixture with an external protocol.
const customerRef = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "tests", "fixture.js"), `
export const tenantFixture = "99999999-8888-4777-8666-555555555555";
`, "utf8");

  const report = scanRepository({
    repositoryRoot: temporaryRoot,
    config: {
      schema_version: 1,
      mode: "report_only",
      scan_roots: ["src", "tests"],
      exclude_path_segments: ["node_modules", ".git"],
      extensions: [".js"],
    },
  });

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

  assert(active.some((item) => item.zone === "test" && item.rule_id === "fixed_customer_identifier"));
  assert(report.findings.some((item) => item.path.endsWith("suppressed.js") && item.rule_id === "fixed_customer_identifier" && item.suppressed));

  const serialized = JSON.stringify(report);
  assert(!serialized.includes("11111111-2222-4333-8444-555555555555"));
  assert(!serialized.includes("00000000-0000-0000-0000-000000000000"));
  assert.match(formatReport(report, "text"), /Mode: report_only/);
  assert.match(formatReport(report, "github"), /::warning/);

  console.log("context-kernel hardcoding scanner tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
