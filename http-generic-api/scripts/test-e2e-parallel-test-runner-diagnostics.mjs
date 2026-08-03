#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, "e2e-parallel-test-runner.mjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-parallel-diagnostic-"));
const apiRoot = path.join(root, "http-generic-api");
const specRoot = path.join(root, "specs", "001-example");
const reportFile = path.join(root, "report.json");

try {
  fs.mkdirSync(path.join(apiRoot, "example"), { recursive: true });
  fs.mkdirSync(specRoot, { recursive: true });
  fs.writeFileSync(path.join(apiRoot, "example", "failure.mjs"), [
    'console.log("token=clear-token-value");',
    'console.error("AssertionError: expected canonical subject binding");',
    "process.exit(1);",
    ""
  ].join("\n"));
  const contract = {
    schema_version: 1,
    feature_key: "001-example",
    parallel_work: {
      enabled: true,
      workstreams: [{
        id: "runtime",
        status: "ready_for_integration",
        required_tests: [{
          id: "runtime-contract",
          runner: "node",
          working_directory: "http-generic-api",
          path: "example/failure.mjs",
          args: []
        }]
      }],
      integration: { convergence_tests: [] }
    }
  };
  const contractPath = path.join("specs", "001-example", "e2e-phases.json");
  fs.writeFileSync(path.join(root, contractPath), `${JSON.stringify(contract, null, 2)}\n`);

  const result = spawnSync(process.execPath, [
    RUNNER,
    "--root", root,
    "--contract", contractPath,
    "--mode", "workstream",
    "--workstream-id", "runtime",
    "--report-file", reportFile
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /clear-token-value/u);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.ok, false);
  assert.equal(report.results[0].status, "failed");
  assert.match(report.results[0].diagnostic.stderr.tail, /expected canonical subject binding/u);
  assert.doesNotMatch(JSON.stringify(report), /clear-token-value/u);
  assert.equal(report.diagnostics.job_logs_role, "diagnostic_only");
  assert.equal(report.secrets_included, false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, tests: 1, gate: "e2e_parallel_report_diagnostics", secrets_included: false }));
