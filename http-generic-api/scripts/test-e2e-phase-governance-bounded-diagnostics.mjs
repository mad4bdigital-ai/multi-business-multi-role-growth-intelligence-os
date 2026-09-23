import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  executePhaseTests,
} from "./e2e-phase-governance.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../../.specify/e2e-phase-governance.json", import.meta.url), "utf8"));

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-direct-diagnostic-"));
const scriptPath = path.join(root, "failing-test.mjs");
fs.writeFileSync(scriptPath, [
  "console.log('safe-prefix');",
  "console.error('x'.repeat(20000));",
  "console.error('authorization: Bearer diagnostic-secret-value');",
  "process.exit(7);",
].join("\n"));

const evaluation = {
  policy: {
    max_test_count_per_contract: 5,
    test_timeout_ms: policy.test_timeout_ms,
  },
  contracts: [
    {
      featureKey: "bounded-direct-diagnostics",
      currentPhase: {
        id: "mvp",
        status: "implemented",
        e2e_journeys: [
          {
            id: "capture-failure",
            tests: [
              {
                id: "intentional-failure",
                runner: "node",
                working_directory: ".",
                path: "failing-test.mjs",
                args: [],
              },
            ],
          },
        ],
      },
    },
  ],
};

const execution = executePhaseTests(evaluation, { root });
assert.equal(execution.ok, false);
assert.equal(execution.test_count, 1);
assert.equal(execution.results.length, 1);
const [executionResult] = execution.results;
assert.equal(executionResult.status, "failed");
assert.equal(executionResult.exit_code, 7);
assert.equal(executionResult.timed_out, false);
assert.equal(executionResult.timeout_ms, policy.test_timeout_ms);
assert.equal(execution.diagnostics.capture_mode, "bounded_redacted_failure_tail");
assert.equal(execution.diagnostics.max_chars_per_stream, 12000);
assert.equal(execution.diagnostics.test_timeout_ms, policy.test_timeout_ms);
assert.equal(execution.diagnostics.kill_signal, "SIGTERM");
assert.equal(execution.diagnostics.job_logs_role, "diagnostic_only");
assert.equal(execution.secrets_included, false);

const diagnostic = executionResult.diagnostic;
assert.ok(diagnostic);
assert.match(JSON.stringify(diagnostic.stdout), /safe-prefix/u);
assert.doesNotMatch(JSON.stringify(diagnostic.stderr), /diagnostic-secret-value/u);
assert.match(JSON.stringify(diagnostic.stderr), /redacted/iu);
assert.ok(String(diagnostic.stderr?.tail || "").length <= 12000);
assert.equal(diagnostic.stderr?.truncated, true);

console.log(JSON.stringify({
  contract: "mad4b.e2e-phase-bounded-diagnostics-test.v1",
  ok: true,
  exit_code_preserved: true,
  secret_redacted: true,
  diagnostic_bounded: true,
  secrets_included: false,
}));
