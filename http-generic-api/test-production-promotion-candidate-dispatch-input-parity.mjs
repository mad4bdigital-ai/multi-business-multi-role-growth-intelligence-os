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
    if (currentInput && /^        required:\s*true\s*$/u.test(line)) required.push(currentInput);
  }
  return [...new Set(required)];
}

function assertCallerSuppliesRequiredInputs(caller, label, requiredInputs) {
  assert.match(
    caller,
    /(?:gh workflow run|dispatch_workflow_and_capture_run|dispatch_and_capture) production-promotion-candidate\.yml/u,
    `${label} must invoke the candidate builder`,
  );
  for (const input of requiredInputs) {
    assert.match(caller, new RegExp(`--field\\s+${input}=`, "u"), `${label} must supply required candidate input ${input}`);
  }
}

const candidate = read(".github/workflows/production-promotion-candidate.yml");
const dispatcher = read(".github/workflows/governed-production-candidate-dispatch-request-dispatcher.yml");
const launcher = read(".github/workflows/governed-production-promotion-request-launcher.yml");
const fullPromotionBridge = read(".github/workflows/governed-production-promotion-dispatch-bridge.yml");
const requiredInputs = requiredWorkflowDispatchInputs(candidate);

assert.ok(requiredInputs.length > 0, "candidate workflow must expose required workflow_dispatch inputs");
assertCallerSuppliesRequiredInputs(dispatcher, "legacy candidate dispatch request dispatcher", requiredInputs);
assertCallerSuppliesRequiredInputs(launcher, "release-cut production promotion controller", requiredInputs);

assert.match(
  dispatcher,
  /--field expected_head_sha="\$\{MAIN_SHA\}"/u,
  "legacy dispatcher must keep its exact trusted main binding",
);
assert.match(
  launcher,
  /--field expected_main_sha="\$RELEASE_CUT_SHA"/u,
  "release-cut controller must bind the candidate source to the authorized immutable cut",
);
assert.match(
  launcher,
  /--field expected_head_sha="\$EXPECTED_REQUEST_HEAD_SHA"/u,
  "release-cut controller must execute candidate code from the exact tree-identical request head",
);
assert.match(
  candidate,
  /trusted workflow source must be tree-identical to the authorized release cut/u,
  "candidate builder must independently prove request-head/release-cut tree parity",
);

assert.match(
  fullPromotionBridge,
  /DISPATCH_GOVERNED_PRODUCTION_PROMOTION/u,
  "full promotion bridge must expose an explicit promotion token distinct from the legacy builder-only token",
);
assert.match(
  fullPromotionBridge,
  /gh workflow run governed-production-promotion-request-launcher\.yml/u,
  "full promotion bridge must delegate to the authoritative promotion launcher",
);
assert.doesNotMatch(
  fullPromotionBridge,
  /gh workflow run production-promotion-candidate\.yml/u,
  "full promotion bridge must not bypass the authoritative launcher by dispatching the candidate builder directly",
);
assert.match(
  fullPromotionBridge,
  /--field expected_head_sha="\$\{MAIN_SHA\}"/u,
  "full promotion bridge must pin the launcher to exact current main",
);
assert.match(
  fullPromotionBridge,
  /--field expected_request_head_sha="\$\{REQUEST_HEAD_SHA\}"/u,
  "full promotion bridge must pass the exact tree-identical request head",
);
assert.match(
  fullPromotionBridge,
  /--field confirmation="AUTHORIZE_GOVERNED_PRODUCTION_PROMOTION_REQUEST"/u,
  "full promotion bridge must use the launcher's typed confirmation",
);
assert.match(
  fullPromotionBridge,
  /--field review_mode="\$\{REVIEW_MODE\}"/u,
  "full promotion bridge must preserve bounded human or ai_policy review mode",
);
assert.match(
  fullPromotionBridge,
  /\[\[ "\$\{GITHUB_SHA\}" != "\$\{main_sha\}" \]\]/u,
  "full promotion bridge must fail closed when main moves before bridge execution",
);
assert.match(
  fullPromotionBridge,
  /git diff --quiet "\$\{main_sha\}" "\$\{request_head_sha\}"/u,
  "full promotion bridge must require the request marker tree to equal current main",
);

const canonicalDecisionWrite = fullPromotionBridge.indexOf('.outcome="dispatched" | .dispatch_requested=true');
const optionalReceiptPost = fullPromotionBridge.lastIndexOf('gh api --method POST "/repos/${REPOSITORY}/issues/${REQUEST_PR}/comments"');
assert.ok(canonicalDecisionWrite >= 0, "full promotion bridge must persist the canonical dispatch decision");
assert.ok(optionalReceiptPost > canonicalDecisionWrite, "canonical dispatch evidence must be persisted before the optional PR receipt comment");
assert.match(
  fullPromotionBridge,
  /optional PR receipt comment could not be written/u,
  "receipt-comment transport failure must be explicitly downgraded to a warning after successful dispatch",
);
assert.doesNotMatch(
  fullPromotionBridge,
  /gh pr merge|git push[^\n]*Production|refs\/heads\/Production/u,
  "full promotion bridge must not merge or directly mutate Production",
);

console.log(`Production candidate dispatch input parity passed (${requiredInputs.join(", ")}); full promotion bridge routes through the authoritative launcher`);
