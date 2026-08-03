#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INITIALIZER = path.join(HERE, "e2e-parallel-plan-init.mjs");

function run(program, args, cwd) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-parallel-plan-init-"));
run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "baseline"], root);

const contract = {
  schema_version: 1,
  feature_key: "001-example",
  title: "Example",
  delivery_mode: "multi_pr",
  current_phase: "mvp",
  scope: { include: ["specs/001-example/**", "http-generic-api/example/**"] },
  merge_contract: { minimum_phase: "mvp" },
  phases: [{ id: "mvp", status: "blocked", objective: "Complete the journey.", blockers: ["Pending work."], planned_e2e_journey: { id: "example-e2e", required_level: "synthetic_runtime", actor: "tenant", entrypoint: "POST /example", terminal_outcome: "Readback succeeds.", steps: ["Submit", "Read back"] } }]
};

const contractPath = "specs/001-example/e2e-phases.json";
fs.mkdirSync(path.join(root, "specs", "001-example"), { recursive: true });
fs.mkdirSync(path.join(root, "migrations"), { recursive: true });
fs.mkdirSync(path.join(root, "http-generic-api", "example"), { recursive: true });
fs.writeFileSync(path.join(root, contractPath), `${JSON.stringify(contract, null, 2)}\n`);
fs.writeFileSync(path.join(root, "specs", "001-example", "spec.md"), "# Example\n");
fs.writeFileSync(path.join(root, "migrations", "0001_example.sql"), "SELECT 1;\n");
fs.writeFileSync(path.join(root, "http-generic-api", "example", "service.mjs"), "export default true;\n");
fs.writeFileSync(path.join(root, "http-generic-api", "test-example-e2e.mjs"), "process.exit(0);\n");

const preview = JSON.parse(run(process.execPath, [INITIALIZER, "--root", root, "--contract", contractPath, "--dry-run"], root));
assert.equal(preview.ok, true);
assert.equal(preview.action, "previewed");
assert(preview.workstreams.some((row) => row.id === "contracts"));
assert(preview.workstreams.some((row) => row.id === "data"));
assert(preview.workstreams.some((row) => row.id === "runtime"));
assert(preview.workstreams.some((row) => row.id === "verification"));
assert.equal(JSON.parse(fs.readFileSync(path.join(root, contractPath), "utf8")).parallel_work, undefined);

const written = JSON.parse(run(process.execPath, [INITIALIZER, "--root", root, "--contract", contractPath], root));
assert.equal(written.action, "parallel_plan_written");
const updated = JSON.parse(fs.readFileSync(path.join(root, contractPath), "utf8"));
assert.equal(updated.parallel_work.enabled, true);
assert.equal(updated.parallel_work.strategy, "dependency_dag");
assert.equal(updated.parallel_work.file_ownership, "exclusive_by_default");
assert.equal(updated.parallel_work.no_partial_feature_merge, true);
assert(updated.parallel_work.integration.required_workstreams.includes("verification"));
assert.equal(updated.parallel_work.integration.e2e_journey_ids[0], "example-e2e");
assert(updated.parallel_work.workstreams.every((row) => row.status === "planned"));

console.log(JSON.stringify({ ok: true, tests: 13, helper: "e2e_parallel_plan_init", secrets_included: false }));
