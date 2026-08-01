#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateRepository, executePhaseTests, matchesPattern } from "./e2e-phase-governance.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../../.specify/e2e-phase-governance.json", import.meta.url), "utf8"));

function tempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-phase-governance-"));
  fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
  fs.writeFileSync(path.join(root, ".specify", "e2e-phase-governance.json"), `${JSON.stringify(policy, null, 2)}\n`);
  return root;
}

function write(root, relative, content = "export default true;\n") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function contract(overrides = {}) {
  return {
    schema_version: 1,
    feature_key: "001-example",
    title: "Example feature",
    delivery_mode: "multi_pr",
    current_phase: "mvp",
    scope: { include: ["http-generic-api/example/**", "specs/001-example/**"] },
    merge_contract: { minimum_phase: "mvp" },
    phases: [
      {
        id: "mvp",
        status: "implemented",
        objective: "Complete a runnable request-to-readback slice.",
        e2e_journeys: [
          {
            id: "example-request-to-readback",
            end_to_end: true,
            level: "synthetic_runtime",
            actor: "tenant_operator",
            entrypoint: "POST /example",
            terminal_outcome: "The created example is returned by readback.",
            steps: ["Submit the request", "Persist and process it", "Read the result"],
            assertions: ["The readback returns the created identifier"],
            tests: [{ id: "example-e2e", runner: "node", working_directory: "http-generic-api", path: "example/e2e.mjs", args: [] }],
            evidence_paths: ["http-generic-api/example/e2e.mjs"]
          }
        ]
      },
      { id: "operational", status: "planned", objective: "Add retries and operational controls." },
      { id: "resilient", status: "planned", objective: "Add fault recovery and reconciliation." },
      { id: "canary", status: "planned", objective: "Run against one non-production target." },
      { id: "production", status: "planned", objective: "Verify exact production readback." }
    ],
    ...overrides
  };
}

assert.equal(matchesPattern("http-generic-api/a/b.mjs", "http-generic-api/**"), true);
assert.equal(matchesPattern("docs/a.md", "**/*.md"), true);
assert.equal(matchesPattern("src/a.ts", "docs/**"), false);

{
  const root = tempRepo();
  write(root, "docs/readme.md", "hello\n");
  const result = evaluateRepository({ root, policy, changedFiles: ["docs/readme.md"] });
  assert.equal(result.report.ok, true);
  assert.equal(result.report.change_class, "docs_only");
}

{
  const root = tempRepo();
  write(root, "http-generic-api/example/service.mjs");
  const result = evaluateRepository({ root, policy, changedFiles: ["http-generic-api/example/service.mjs"] });
  assert.equal(result.report.ok, false);
  assert(result.report.findings.some((row) => row.code === "feature_change_missing_e2e_phase_contract"));
}

{
  const root = tempRepo();
  write(root, "http-generic-api/example/service.mjs");
  write(root, "http-generic-api/example/e2e.mjs", "process.exit(0);\n");
  const declaration = contract();
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(declaration, null, 2)}\n`);
  const changedFiles = ["http-generic-api/example/service.mjs", "http-generic-api/example/e2e.mjs", "specs/001-example/e2e-phases.json"];
  const result = evaluateRepository({ root, policy, changedFiles });
  assert.equal(result.report.ok, true, JSON.stringify(result.report.findings));
  const execution = executePhaseTests(result, { root });
  assert.equal(execution.ok, true);
  assert.equal(execution.test_count, 1);
}

{
  const root = tempRepo();
  write(root, "http-generic-api/example/service.mjs");
  write(root, "http-generic-api/example/e2e.mjs", "process.exit(0);\n");
  const declaration = contract();
  declaration.phases[0].e2e_journeys[0].level = "component";
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(declaration, null, 2)}\n`);
  const result = evaluateRepository({ root, policy, changedFiles: ["http-generic-api/example/service.mjs", "specs/001-example/e2e-phases.json"] });
  assert.equal(result.report.ok, false);
  assert(result.report.findings.some((row) => row.code === "journey_level_below_phase_minimum"));
}

{
  const root = tempRepo();
  write(root, "http-generic-api/example/service.mjs");
  write(root, "http-generic-api/example/e2e.mjs", "process.exit(0);\n");
  const declaration = contract();
  declaration.phases[0].status = "blocked";
  declaration.phases[0].blockers = ["Runtime entrypoint is not mounted."];
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(declaration, null, 2)}\n`);
  const result = evaluateRepository({ root, policy, changedFiles: ["http-generic-api/example/service.mjs", "specs/001-example/e2e-phases.json"] });
  assert.equal(result.report.ok, false);
  assert(result.report.findings.some((row) => row.code === "mvp_not_implemented"));
}

{
  const root = tempRepo();
  write(root, "http-generic-api/other/service.mjs");
  write(root, "http-generic-api/example/e2e.mjs", "process.exit(0);\n");
  write(root, "specs/001-example/e2e-phases.json", `${JSON.stringify(contract(), null, 2)}\n`);
  const result = evaluateRepository({ root, policy, changedFiles: ["http-generic-api/other/service.mjs", "specs/001-example/e2e-phases.json"] });
  assert.equal(result.report.ok, false);
  assert(result.report.findings.some((row) => row.code === "runtime_change_not_covered_by_e2e_contract"));
}

console.log(JSON.stringify({ ok: true, tests: 7, gate: "e2e_phase_governance", secrets_included: false }));
