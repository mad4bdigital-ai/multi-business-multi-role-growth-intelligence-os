import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  return fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function requiredWorkflowDispatchInputs(source) {
  const required = [];
  let inWorkflowDispatch = false;
  let inInputs = false;
  let currentInput = null;

  for (const line of source.split("\n")) {
    if (line === "  workflow_dispatch:") {
      inWorkflowDispatch = true;
      inInputs = false;
      currentInput = null;
      continue;
    }
    if (!inWorkflowDispatch) continue;
    if (line === "    inputs:") {
      inInputs = true;
      continue;
    }
    if (inInputs && /^\S/u.test(line)) break;
    if (!inInputs) continue;

    const inputMatch = line.match(/^      ([A-Za-z0-9_]+):\s*$/u);
    if (inputMatch) {
      currentInput = inputMatch[1];
      continue;
    }
    if (currentInput && /^        required:\s*true\s*$/u.test(line)) {
      required.push(currentInput);
    }
  }

  return [...new Set(required)];
}

function assertCallerSuppliesRequiredInputs(caller, label, requiredInputs) {
  assert.match(caller, /gh workflow run production-promotion-candidate\.yml/u, `${label} must invoke the candidate builder`);
  for (const input of requiredInputs) {
    assert.match(caller, new RegExp(`--field\\s+${input}=`, "u"), `${label} must supply required candidate input ${input}`);
  }
}

const candidate = read(".github/workflows/production-promotion-candidate.yml");
const dispatcher = read(".github/workflows/governed-production-candidate-dispatch-request-dispatcher.yml");
const launcher = read(".github/workflows/governed-production-promotion-request-launcher.yml");
const requiredInputs = requiredWorkflowDispatchInputs(candidate);

assert.ok(requiredInputs.length > 0, "candidate workflow must expose required workflow_dispatch inputs");
assertCallerSuppliesRequiredInputs(dispatcher, "candidate dispatch request dispatcher", requiredInputs);
assertCallerSuppliesRequiredInputs(launcher, "production promotion launcher", requiredInputs);
assert.match(dispatcher, /--field expected_head_sha="\$\{MAIN_SHA\}"/u, "dispatcher must bind expected_head_sha to the exact trusted main SHA");

console.log(`Production candidate dispatch input parity passed (${requiredInputs.join(", ")})`);
