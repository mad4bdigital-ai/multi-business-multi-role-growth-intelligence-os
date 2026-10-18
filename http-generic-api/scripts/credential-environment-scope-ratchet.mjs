#!/usr/bin/env node
// Fail-closed, read-only GitHub Actions Environment-secret scope ratchet.
// Kept outside ci.yml so that the canonical pull_request CI YAML contains
// no runtime mutation secret names, expressions, or privileged bindings.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const targets = [
  ["github-repository-policy-1049-governed-rollout.yml", ["readiness", "apply", "verify"]],
  ["github-repository-policy-1050-governed-rollout.yml", ["readiness", "apply", "verify"]],
  ["github-repository-policy-1051-governed-rollout.yml", ["readiness", "reconcile_record_only", "apply_after_record_only_reconcile", "apply"]],
  ["transport-response-schema-1048-governed-rollout.yml", ["readiness", "apply", "verify"]],
];

function jobsIn(yaml) {
  const jobsStart = yaml.indexOf("\njobs:\n");
  if (jobsStart < 0) return [];
  const section = yaml.slice(jobsStart + "\njobs:\n".length);
  const starts = [...section.matchAll(/^  ([a-zA-Z_][\w-]*):\s*$/gm)];
  return starts.map((match, i) => ({
    name: match[1],
    source: section.slice(match.index, starts[i + 1]?.index ?? section.length),
  }));
}

function assertProductionEnvironment(block, description) {
  assert.match(block, /^    environment:\n      name: Production\n      deployment: false$/m,
    description + ": explicit non-deploying Production Environment binding required");
}

function verifyGovernedWorkflow(file, requiredJobs) {
  const yaml = readFileSync(".github/workflows/" + file, "utf8");
  const jobs = jobsIn(yaml);
  for (const name of requiredJobs) {
    const matches = jobs.filter((job) => job.name === name);
    assert.equal(matches.length, 1, file + ": exactly one governed job " + name + " required");
    const block = matches[0].source;
    assertProductionEnvironment(block, file + " / " + name);
    assert.match(block, /secrets\.BACKEND_API_KEY\b/,
      file + " / " + name + ": existing backend-key reference required");
    assert.match(block, /RUNTIME_BASE_URL:\s*https:\/\/auth\.mad4b\.com/,
      file + " / " + name + ": fixed Production endpoint required");
  }
  return jobs.length;
}

// Actual Actions expressions only; inert occurrences inside JavaScript tests
// and documentation must not be treated as credential exposure.
const secretExpression = /\$\{\{\s*secrets\.(HOSTINGER_API_TOKEN|BACKEND_API_KEY)\s*\}\}/g;

function inspectChangedWorkflow(file, yaml, baseYaml = "") {
  let count = 0;
  const previousJobs = new Map(jobsIn(baseYaml).map((job) => [job.name, job.source]));
  for (const job of jobsIn(yaml)) {
    const used = [...new Set([...job.source.matchAll(secretExpression)].map((m) => m[1]))];
    if (!used.length) continue;
    // Preserve unmodified historical jobs exactly as they existed on base.
    // Changing any byte of a legacy secret-consuming job requires passing
    // the new Environment contract; no policy exception is granted to edits.
    if (previousJobs.get(job.name) === job.source) {
      count++;
      continue;
    }
    const description = file + " / " + job.name;
    const explicitEnvironment = /^    environment:\s*[A-Za-z][\w-]*\s*$/m.test(job.source)
      || /^    environment:\n      name:\s*[A-Za-z][\w-]*\s*$/m.test(job.source);
    assert.equal(explicitEnvironment, true,
      description + ": credential-consuming job needs a static, explicit GitHub Environment");
    if (used.includes("HOSTINGER_API_TOKEN")
        || (used.includes("BACKEND_API_KEY") && /RUNTIME_BASE_URL:\s*https:\/\/auth\.mad4b\.com/.test(job.source))) {
      assertProductionEnvironment(job.source, description);
    }
    count++;
  }
  return count;
}

let governedJobs = 0;
for (const [file, requiredJobs] of targets) {
  verifyGovernedWorkflow(file, requiredJobs);
  governedJobs += requiredJobs.length;
}
assert.equal(governedJobs, 13);

const event = String(process.env.CREDENTIAL_PROVENANCE_EVENT || "");
const baseSha = String(process.env.CREDENTIAL_PROVENANCE_BASE_SHA || "").trim();
let ratchetJobs = 0;
if (event === "pull_request" || event === "push") {
  assert.match(baseSha, /^[a-f0-9]{40}$/,
    "credential scope ratchet requires an immutable branch baseline SHA");
  const changed = execFileSync("git",
    ["diff", "--name-only", baseSha + "...HEAD", "--", ".github/workflows"],
    { encoding: "utf8" }).split(/\r?\n/)
    .filter((item) => /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(item));
  for (const file of changed) {
    const existed = execFileSync("git", ["ls-tree", "--name-only", baseSha, "--", file],
      { encoding: "utf8" }).trim() === file;
    const baselineYaml = existed
      ? execFileSync("git", ["show", baseSha + ":" + file], { encoding: "utf8" })
      : "";
    ratchetJobs += inspectChangedWorkflow(file, readFileSync(file, "utf8"), baselineYaml);
  }
}

// Positive and negative fixtures cannot contact a provider or read any secret.
const expression = "$" + "{{ secrets.HOSTINGER_API_TOKEN }}";
const good = "\njobs:\n  fixture:\n    environment:\n      name: Production\n      deployment: false\n    env:\n      TOKEN: " + expression + "\n";
assert.equal(inspectChangedWorkflow("valid-fixture", good), 1);
assert.throws(() => inspectChangedWorkflow("unbound-fixture",
  good.replace("    environment:\n      name: Production\n      deployment: false\n", "")),
  /static, explicit GitHub Environment/);
assert.throws(() => inspectChangedWorkflow("wrong-scope-fixture",
  good.replace("name: Production", "name: staging")),
  /Production Environment binding required/);
const legacyFixture = "\njobs:\n  fixture:\n    environment: Production\n    env:\n      TOKEN: " + expression + "\n";
assert.equal(inspectChangedWorkflow("unchanged-base", legacyFixture, legacyFixture), 1);
assert.throws(() => inspectChangedWorkflow("changed-legacy", legacyFixture + "    # edited\n", legacyFixture),
  /Production Environment binding required/);
const inert = "\njobs:\n  fixture:\n    run: echo 'secrets.BACKEND_API_KEY'\n";
assert.equal(inspectChangedWorkflow("inert-reference-fixture", inert), 0);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.credential-environment-scope-ratchet.v1",
  governed_production_jobs_checked: governedJobs,
  changed_secret_consuming_jobs_checked: ratchetJobs,
  fixture_cases_passed: 6,
  secret_values_accessed: false,
  provider_requests_performed: false,
  repository_mutation_performed: false,
}, null, 2));
