import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  classifyRuntimeIntegrity,
  inspectRuntimeIntegrity,
} from "./runtimeIntegrity.js";
import { evaluateHostingerSshDeployTargetPolicy } from "./hostingerSshDeployExecutor.js";

const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

{
  const integrity = classifyRuntimeIntegrity({
    expectedCommitSha: shaA,
    checkoutCommitSha: shaA,
    checkoutDetected: true,
    statusReadbackAvailable: true,
    dirtyTrackedFileCount: 0,
  });
  assert.equal(integrity.state, "verified");
  assert.equal(integrity.verified, true);
  assert.equal(integrity.tracked_checkout_clean, true);
  assert.equal(integrity.local_application_code_mutation_detected, false);
  assert.deepEqual(integrity.reason_codes, []);
}

{
  const integrity = classifyRuntimeIntegrity({
    expectedCommitSha: shaA,
    checkoutCommitSha: shaA,
    checkoutDetected: true,
    statusReadbackAvailable: true,
    dirtyTrackedFileCount: 2,
  });
  assert.equal(integrity.state, "degraded");
  assert.equal(integrity.verified, false);
  assert.equal(integrity.local_application_code_mutation_detected, true);
  assert.equal(integrity.dirty_tracked_file_count, 2);
  assert.deepEqual(integrity.reason_codes, ["unapproved_dirty_runtime"]);
}

{
  const integrity = classifyRuntimeIntegrity({
    expectedCommitSha: shaA,
    checkoutCommitSha: shaB,
    checkoutDetected: true,
    statusReadbackAvailable: true,
    dirtyTrackedFileCount: 0,
  });
  assert.equal(integrity.state, "degraded");
  assert.equal(integrity.commit_matches, false);
  assert(integrity.reason_codes.includes("runtime_commit_mismatch"));
}

{
  const integrity = classifyRuntimeIntegrity({
    expectedCommitSha: shaA,
    checkoutCommitSha: "",
    checkoutDetected: false,
    statusReadbackAvailable: false,
    dirtyTrackedFileCount: 0,
  });
  assert.equal(integrity.state, "degraded");
  assert(integrity.reason_codes.includes("runtime_checkout_integrity_unavailable"));
  assert(integrity.reason_codes.includes("runtime_checkout_not_detected"));
  assert(integrity.reason_codes.includes("runtime_checkout_commit_unavailable"));
}

{
  const calls = [];
  const execFileImpl = (command, args, options, callback) => {
    calls.push({ command, args, options });
    if (args[0] === "rev-parse") callback(null, `${shaA}\n`, "");
    else callback(null, " M http-generic-api/index.js\nM  http-generic-api/routes/deploymentInfoRoutes.js\n", "");
  };
  const integrity = await inspectRuntimeIntegrity({
    repoRoot: "/tmp/runtime-integrity-test",
    expectedCommitSha: shaA,
    checkoutCommitSha: "",
    execFileImpl,
    env: {},
  });
  assert.equal(integrity.state, "degraded");
  assert.equal(integrity.dirty_tracked_file_count, 2);
  assert.deepEqual(calls[0].args, ["rev-parse", "--verify", "HEAD"]);
  assert.deepEqual(calls[1].args, ["status", "--porcelain=v1", "--untracked-files=no", "--no-renames"]);
  for (const call of calls) {
    assert.equal(call.command, "git");
    assert.equal(call.options.shell, false);
    assert.equal(call.options.env.GIT_OPTIONAL_LOCKS, "0");
    assert.equal(call.options.timeout, 5000);
    assert.equal(call.options.maxBuffer, 64 * 1024);
  }
}

{
  const integrity = await inspectRuntimeIntegrity({
    repoRoot: "/tmp/runtime-integrity-test",
    expectedCommitSha: shaA,
    checkoutCommitSha: shaA,
    execFileImpl(command, args, options, callback) {
      assert.equal(command, "git");
      assert.deepEqual(args, ["status", "--porcelain=v1", "--untracked-files=no", "--no-renames"]);
      callback(new Error("git unavailable"), "", "bounded diagnostic failure");
    },
    env: {},
  });
  assert.equal(integrity.state, "degraded");
  assert.equal(integrity.readback_available, false);
  assert(integrity.reason_codes.includes("runtime_checkout_integrity_unavailable"));
}

{
  const policy = evaluateHostingerSshDeployTargetPolicy({
    metadata: {
      deployment_allowed: false,
      ssh_normal_updates_allowed: false,
      ssh_break_glass_only: true,
      deployment_strategy: "github_production_auto_deploy",
    },
  });
  assert.equal(policy.allowed, false, "routine SSH application-code mutation must remain denied by production target policy");
  assert(policy.reasons.includes("deployment_not_allowed"));
  assert(policy.reasons.includes("ssh_normal_updates_not_allowed"));
  assert.equal(policy.ssh_break_glass_only, true);
}

const authorityMigration = readFileSync("migrations/20260810_environment_branch_authority_v1.sql", "utf8");
assert(authorityMigration.includes("'$.deployment_allowed', FALSE"));
assert(authorityMigration.includes("'$.ssh_normal_updates_allowed', FALSE"));
assert(authorityMigration.includes("'$.ssh_break_glass_only', TRUE"));
assert(authorityMigration.includes("normal path is protected Production -> Hostinger"));

console.log("Spec018 runtime integrity and routine-mutation denial tests passed");
