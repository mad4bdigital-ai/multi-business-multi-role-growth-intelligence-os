#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflowPath = path.join(root, ".github/workflows/ci.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const runnerTemp = "$" + "{{ runner.temp }}";
const evidenceName = "governed-local-connector-production-closure.json";

const jobStart = workflow.indexOf("  local-connector-production-closure:\n");
const jobEnd = workflow.indexOf("\n  test:\n", jobStart);
assert(jobStart >= 0 && jobEnd > jobStart, "closure job boundaries must exist");
const closureJob = workflow.slice(jobStart, jobEnd);
const stepsStart = closureJob.indexOf("\n    steps:\n");
assert(stepsStart > 0, "closure job steps boundary must exist");
const jobDeclaration = closureJob.slice(0, stepsStart);

assert(!jobDeclaration.includes(runnerTemp), "runner context must not appear in jobs.<job_id>.env");
assert(closureJob.includes(
  "      - name: Execute bounded trusted closure\n" +
  "        id: closure\n" +
  "        env:\n" +
  `          EVIDENCE_PATH: ${runnerTemp}/${evidenceName}\n` +
  "        run: node .github/scripts/governed-local-connector-production-closure.mjs\n"
), "closure execution step must own the runner-temp evidence path");
assert(closureJob.includes(`          path: ${runnerTemp}/${evidenceName}\n`), "artifact upload must read the runner-temp path directly");
assert(!closureJob.includes("path: $" + "{{ env.EVIDENCE_PATH }}"), "artifact upload must not depend on job env evidence path");
assert(workflow.includes("name: CI\n"), "canonical CI workflow name must remain unchanged");
assert(workflow.includes("  pull_request:\n    branches: [main, Production]\n"), "canonical CI pull-request trigger must remain unchanged");
assert(workflow.includes("github.event_name == 'push'"), "governed closure must remain push-only");
assert(workflow.includes("RUN_LOCAL_CONNECTOR_PRODUCTION_CLOSURE_CI_V18_PR_3945_792FF63A"), "one-shot closure token must remain unchanged");

console.log(JSON.stringify({
  ok: true,
  tests: 10,
  workflow: ".github/workflows/ci.yml",
  invalid_job_level_runner_context: false,
  step_level_runner_context: true,
  trigger_or_authority_changed: false,
  secrets_included: false
}));
