import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeAutomationOverlap,
  detectAutomationOverlaps,
  buildAutomationInventory,
} from "./scripts/automation-overlap-analyzer.mjs";

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture({ sameConcurrency = false, readbackMinute = 17 } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "automation-overlap-"));
  write(root, "http-generic-api/package.json", JSON.stringify({ type: "module", scripts: {} }));
  write(
    root,
    "http-generic-api/scripts/writer.mjs",
    'import { writeFileSync } from "node:fs";\nwriteFileSync("generated.txt", "ok");\n',
  );
  const rightGroup = sameConcurrency ? "shared-${{ github.ref }}" : "second-${{ github.ref }}";
  write(
    root,
    ".github/workflows/left.yml",
    `on:\n  schedule:\n    - cron: "17 3 * * *"\nconcurrency:\n  group: shared-\${{ github.ref }}\n  cancel-in-progress: false\njobs:\n  run:\n    steps:\n      - run: node http-generic-api/scripts/writer.mjs\n`,
  );
  write(
    root,
    ".github/workflows/right.yml",
    `on:\n  schedule:\n    - cron: "${readbackMinute} 3 * * *"\nconcurrency:\n  group: ${rightGroup}\n  cancel-in-progress: false\njobs:\n  run:\n    steps:\n      - run: node http-generic-api/scripts/writer.mjs\n`,
  );
  return root;
}

const behavioralRoot = fixture();
const behavioralInventory = buildAutomationInventory({ repoRoot: behavioralRoot });
const behavioralFindings = detectAutomationOverlaps(behavioralInventory, {
  version: "test",
  enforcement: { discovered_overlap_default_severity: "high" },
});
assert.equal(
  behavioralFindings.some((item) => item.code === "shared_writer_different_concurrency"),
  true,
  "shared file writer should be detected across different concurrency groups",
);
assert.equal(
  behavioralFindings.some((item) => item.code === "identical_schedule_different_concurrency"),
  true,
  "identical schedules without shared concurrency should be reported",
);

const serializedRoot = fixture({ sameConcurrency: true, readbackMinute: 47 });
const serializedInventory = buildAutomationInventory({ repoRoot: serializedRoot });
const serializedFindings = detectAutomationOverlaps(serializedInventory, {
  version: "test",
  enforcement: { discovered_overlap_default_severity: "high" },
});
assert.equal(
  serializedFindings.some((item) => item.code === "shared_writer_different_concurrency"),
  false,
  "shared concurrency should suppress the shared-writer overlap finding",
);

const policyRoot = fixture({ sameConcurrency: false, readbackMinute: 17 });
const policy = {
  version: "test-policy",
  enforcement: {
    fail_severity: "critical",
    discovered_overlap_default_severity: "high",
  },
  resource_groups: [
    {
      key: "generated",
      required_concurrency_group: "shared-${{ github.ref }}",
      workflows: [
        { path: ".github/workflows/left.yml", access: "write" },
        { path: ".github/workflows/right.yml", access: "write" },
      ],
    },
  ],
  schedule_separation_rules: [
    {
      before_workflow: ".github/workflows/left.yml",
      after_workflow: ".github/workflows/right.yml",
      minimum_minutes: 20,
      severity: "critical",
    },
  ],
};
const policyReport = analyzeAutomationOverlap({ repoRoot: policyRoot, policy });
assert.equal(policyReport.ok, false);
assert.equal(policyReport.enforcement.blocking_count >= 2, true);
assert.equal(
  policyReport.findings.some((item) => item.code === "resource_group_concurrency_mismatch"),
  true,
);
assert.equal(
  policyReport.findings.some((item) => item.code === "schedule_separation_insufficient"),
  true,
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workMapWorkflowPath = path.join(repoRoot, ".github/workflows/spec-kit-work-map-autofix.yml");
const overlapPolicyPath = path.join(repoRoot, "http-generic-api/scripts/taxonomy/automation-overlap-policy.json");
const workMapWorkflow = readFileSync(workMapWorkflowPath, "utf8");
const overlapPolicy = JSON.parse(readFileSync(overlapPolicyPath, "utf8"));
const workMapResourceGroup = overlapPolicy.resource_groups.find(
  (entry) => entry.key === "pull-request-work-map-generated-artifacts",
);
const expectedWorkMapConcurrency = "spec-kit-work-map-artifacts-${{ github.repository }}-${{ inputs.branch }}";

assert(workMapResourceGroup, "Work Map generated-artifact resource group must remain registered");
assert.equal(
  workMapResourceGroup.required_concurrency_group,
  expectedWorkMapConcurrency,
  "Work Map resource-group policy must match the workflow-dispatch-only writer concurrency identity",
);
assert.deepEqual(
  workMapResourceGroup.workflows,
  [{ path: ".github/workflows/spec-kit-work-map-autofix.yml", access: "write" }],
  "Work Map generated artifacts must retain one governed writer",
);
assert(
  workMapWorkflow.includes(`group: ${expectedWorkMapConcurrency}`),
  "Work Map writer workflow must use the policy-required concurrency group",
);
assert(
  workMapWorkflow.includes("cancel-in-progress: false"),
  "Work Map writer must queue rather than cancel in-progress mutations",
);
assert(
  !workMapWorkflow.includes("contains(github.event.pull_request.body"),
  "retired pull-request authorization-marker concurrency must not return",
);

const realReport = analyzeAutomationOverlap({ repoRoot });
assert.equal(
  realReport.enforcement.blocking_count,
  0,
  `real repository has blocking automation overlap findings: ${JSON.stringify(realReport.findings, null, 2)}`,
);

console.log("automation overlap analyzer tests passed");
