import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  developerSessionCapabilities, createDeveloperSessionManager,
} from "./connector-developer-sessions.mjs";
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-developer-session-"));
  fs.writeFileSync(path.join(root, "check.mjs"), "console.log('safe')");
  return { root, env: { CONNECTOR_DEVELOPER_SESSIONS_ENABLED: "true",
    CONNECTOR_DEVELOPER_REPO_ROOT: root, CONNECTOR_FILE_PATHS: root } };
}
function fakeSpawn(cmd, args, options) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.emit("close", null); return true; };
  process.nextTick(() => {
    child.stdout.emit("data", "result ok\n");
    child.emit("close", 0);
  });
  return child;
}
test("disabled unless repo is exactly configured and allowlisted", () => {
  assert.equal(developerSessionCapabilities({}).enabled, false);
  const { root, env } = fixture();
  assert.equal(developerSessionCapabilities({ ...env, CONNECTOR_FILE_PATHS: path.dirname(root) }).enabled, false);
  assert.equal(developerSessionCapabilities(env).enabled, true);
  assert.equal(developerSessionCapabilities(env).execute_tests_enabled, false);
});
test("Read-only git session returns a resumable bounded cursor without caller shell", async () => {
  const { env } = fixture();
  const manager = createDeveloperSessionManager({ env, spawnImpl: fakeSpawn });
  assert.equal(manager.dispatch({ action: "start", task: "rm_rf" }).code, "developer_task_not_allowlisted");
  const result = manager.dispatch({ action: "start", task: "git_status" });
  assert.equal(result.status, "running");
  assert.equal(result.output, "");
  await new Promise((done) => setImmediate(done));
  const page = manager.dispatch({ action: "status", session_id: result.session_id, cursor: 0 });
  assert.equal(page.status, "completed");
  assert.equal(page.output, "result ok\n");
  assert.equal(manager.dispatch({ action: "status", session_id: result.session_id, cursor: page.next_cursor }).output, "");
  assert.equal(manager.dispatch({ action: "status", session_id: result.session_id, cursor: -1 }).code, "invalid_cursor");
});
test("Repo code execution needs separate flag and exact Git HEAD", () => {
  const { env } = fixture();
  const sha = "a".repeat(40);
  const off = createDeveloperSessionManager({ env, spawnImpl: fakeSpawn });
  assert.equal(off.dispatch({ action: "start", task: "node_test", test_file: "check.mjs" }).code,
    "repo_code_execution_not_approved");
  const manager = createDeveloperSessionManager({
    env: { ...env, CONNECTOR_DEVELOPER_TESTS_ENABLED: "true" },
    spawnImpl: fakeSpawn,
    spawnSyncImpl: () => ({ status: 0, stdout: sha + "\n" }),
  });
  assert.equal(manager.dispatch({ action: "start", task: "node_test",
    test_file: "check.mjs" }).code, "exact_head_sha_required");
  assert.equal(manager.dispatch({ action: "start", task: "node_test",
    test_file: "check.mjs", expected_head_sha: "b".repeat(40) }).code, "repo_head_changed_or_unavailable");
  const ok = manager.dispatch({ action: "start", task: "node_test",
    test_file: "check.mjs", expected_head_sha: sha });
  assert.equal(ok.ok, true);
});
test("Rejects traversal, absolute paths, and symlinks outside bound repo", () => {
  const { root, env } = fixture();
  const manager = createDeveloperSessionManager({
    env: { ...env, CONNECTOR_DEVELOPER_TESTS_ENABLED: "true" },
    spawnImpl: fakeSpawn,
    spawnSyncImpl: () => ({ status: 0, stdout: "a".repeat(40) }),
  });
  for (const file of ["../secret.mjs", "/tmp/secrets.mjs", "C:/windows/script.mjs", "folder/../../evil.js"]) {
    assert.equal(manager.dispatch({ action: "start", task: "node_test",
      test_file: file, expected_head_sha: "a".repeat(40) }).code, "test_file_not_allowed");
  }
  const outside = path.join(os.tmpdir(), "mad4b-developer-outside-" + Date.now() + ".mjs");
  fs.writeFileSync(outside, "console.log('outside')");
  try {
    fs.symlinkSync(outside, path.join(root, "link.mjs"));
    assert.equal(manager.dispatch({ action: "start", task: "node_test",
      test_file: "link.mjs", expected_head_sha: "a".repeat(40) }).code, "test_file_not_allowed");
  } finally {
    fs.rmSync(outside, { force: true });
  }
});
test("Cancellation is explicit and session does not accept arbitrary command args", () => {
  const { env } = fixture();
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  const manager = createDeveloperSessionManager({ env, spawnImpl: () => child });
  const run = manager.dispatch({ action: "start", task: "git_status", command: "powershell.exe", args: ["-enc", "secret"] });
  assert.equal(run.ok, true);
  const stop = manager.dispatch({ action: "cancel", session_id: run.session_id });
  assert.equal(stop.status, "cancelled");
  assert.equal(manager.dispatch({ action: "status", session_id: run.session_id }).status, "cancelled");
});
