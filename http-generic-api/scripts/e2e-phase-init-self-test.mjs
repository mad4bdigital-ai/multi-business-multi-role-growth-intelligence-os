#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INITIALIZER = path.join(HERE, "e2e-phase-init.mjs");
const POLICY = path.resolve(HERE, "..", "..", ".specify", "e2e-phase-governance.json");

function run(program, args, cwd) {
  return execFileSync(program, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-phase-init-"));
fs.mkdirSync(path.join(root, ".specify"), { recursive: true });
fs.copyFileSync(POLICY, path.join(root, ".specify", "e2e-phase-governance.json"));

run("git", ["init"], root);
run("git", ["config", "user.email", "ci@example.invalid"], root);
run("git", ["config", "user.name", "CI"], root);
fs.writeFileSync(path.join(root, "README.md"), "baseline\n");
run("git", ["add", "."], root);
run("git", ["commit", "-m", "baseline"], root);

fs.mkdirSync(path.join(root, "http-generic-api", "example"), { recursive: true });
fs.mkdirSync(path.join(root, "specs", "001-example"), { recursive: true });
fs.writeFileSync(path.join(root, "http-generic-api", "example", "service.mjs"), "export default true;\n");
fs.writeFileSync(path.join(root, "specs", "001-example", "spec.md"), "# Example\n");

const preview = JSON.parse(run(process.execPath, [INITIALIZER, "--root", root, "--feature-key", "001-example", "--dry-run"], root));
assert.equal(preview.ok, true);
assert.equal(preview.contract_path, "specs/001-example/e2e-phases.json");
assert(preview.proposed_scope.includes("http-generic-api/example/service.mjs"));
assert(preview.proposed_scope.includes("specs/001-example/**"));
assert.equal(fs.existsSync(path.join(root, preview.contract_path)), false);

const created = JSON.parse(run(process.execPath, [INITIALIZER, "--root", root, "--feature-key", "001-example"], root));
assert.equal(created.action, "created");
const contractPath = path.join(root, created.contract_path);
const initial = JSON.parse(fs.readFileSync(contractPath, "utf8"));
assert.equal(initial.current_phase, "mvp");
assert.equal(initial.phases[0].status, "blocked");
assert(!initial.scope.include.includes("*"));

fs.writeFileSync(path.join(root, "http-generic-api", "example", "route.mjs"), "export default true;\n");
const refreshed = JSON.parse(run(process.execPath, [INITIALIZER, "--root", root, "--feature-key", "001-example", "--refresh-scope"], root));
assert.equal(refreshed.action, "scope_refreshed");
const updated = JSON.parse(fs.readFileSync(contractPath, "utf8"));
assert(updated.scope.include.includes("http-generic-api/example/route.mjs"));

console.log(JSON.stringify({ ok: true, tests: 8, helper: "e2e_phase_init", secrets_included: false }));
