import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createDeviceTerminalManager } from "./device-terminal-engine.mjs";

function fixture(interactive = false) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-terminal-"));
  const root = path.join(base, "repo"), state = path.join(base, "private-state");
  fs.mkdirSync(root); fs.mkdirSync(state, { mode: 0o700 });
  const env = {
    CONNECTOR_DEVICE_TERMINAL_ENABLED: "true",
    CONNECTOR_DEVELOPER_REPO_ROOT: root,
    CONNECTOR_FILE_PATHS: JSON.stringify([root]),
    CONNECTOR_DEVICE_TERMINAL_STATE_DIR: state,
    CONNECTOR_DEVICE_ID: "device-a",
    CONNECTOR_DEVICE_TERMINAL_INTERACTIVE_ENABLED: interactive ? "true" : "false",
    CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN: interactive ? "private-local-approval" : "",
  };
  return { base, root, state, env, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}
function fakeSpawn({ autoExit = false, code = 0 } = {}) {
  const children = [];
  function create(command, args, options) {
    const c = new EventEmitter();
    c.pid = 13371 + children.length;
    c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.stdin = { destroyed: false, writableEnded: false, writes: [], write(v) { this.writes.push(v); } };
    c.kill = () => { c.emit("close", null); return true; };
    c.command = command; c.args = args; c.options = options;
    children.push(c);
    if (autoExit) process.nextTick(() => c.emit("close", code));
    return c;
  }
  return { create, children };
}
test("terminal never enables without exact device, repo and private directory", () => {
  assert.equal(createDeviceTerminalManager().capabilities.enabled, false);
  const f = fixture();
  try {
    assert.equal(createDeviceTerminalManager({ env: f.env }).capabilities.enabled, true);
    assert.equal(createDeviceTerminalManager({ env: { ...f.env, CONNECTOR_DEVICE_ID: "" } }).capabilities.enabled, false);
    assert.equal(createDeviceTerminalManager({ env: { ...f.env, CONNECTOR_FILE_PATHS: f.base } }).capabilities.enabled, false);
    assert.equal(createDeviceTerminalManager({ env: { ...f.env, CONNECTOR_DEVICE_TERMINAL_STATE_DIR: f.root } }).capabilities.enabled, false);
  } finally { f.done(); }
});
test("read-only task streams bounded output and resumes after transient disconnect", () => {
  const f = fixture(), spawned = fakeSpawn();
  try {
    const m = createDeviceTerminalManager({ env: f.env, spawnImpl: spawned.create });
    const run = m.dispatch({ action: "start", profile: "git_status", input: "arbitrary command" });
    assert.equal(run.ok, true);
    assert.equal(spawned.children[0].stdin.writes.length, 0);
    spawned.children[0].stdout.emit("data", "hello\n");
    spawned.children[0].stderr.emit("data", "Authorization: Bearer token-value\n");
    const read = m.dispatch({ action: "output", session_id: run.session_id, cursor: 0 });
    assert.match(read.output, /hello/);
    assert.ok(!read.output.includes("token-value"));
    assert.equal(m.dispatch({ action: "resume", session_id: run.session_id, cursor: read.next_cursor }).output, "");
    assert.equal(m.dispatch({ action: "process_list" }).sessions[0].session_id, run.session_id);
    const stopped = m.dispatch({ action: "process_terminate", session_id: run.session_id });
    assert.equal(stopped.status, "cancelled");
    assert.equal(m.dispatch({ action: "input", session_id: run.session_id, input: "oops" }).code, "session_closed");
    assert.equal(m.dispatch({ action: "close", session_id: run.session_id }).closed, true);
    assert.equal(fs.existsSync(path.join(f.state, run.session_id + ".json")), false);
    assert.equal(fs.existsSync(path.join(f.state, run.session_id + ".log")), false);
    const fresh = createDeviceTerminalManager({ env: f.env, spawnImpl: spawned.create });
    assert.deepEqual(fresh.dispatch({ action: "list" }).sessions, []);
  } finally { f.done(); }
});
test("interactive command and every follow-up input require independent local approval", () => {
  const f = fixture(true), spawned = fakeSpawn();
  try {
    const m = createDeviceTerminalManager({ env: f.env, spawnImpl: spawned.create });
    assert.equal(m.dispatch({ action: "start", profile: "node_repl" }).code, "approval_required");
    const run = m.dispatch({ action: "start", profile: "node_repl", approval_token: "private-local-approval" });
    assert.equal(run.ok, true);
    assert.equal(spawned.children[0].options.shell, false);
    assert.equal(spawned.children[0].options.env.CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN, undefined);
    assert.equal(m.dispatch({ action: "input", session_id: run.session_id, input: "1+1\n" }).code, "approval_required");
    assert.equal(m.dispatch({ action: "input", session_id: run.session_id, input: "a".repeat(3000),
      approval_token: "private-local-approval" }).code, "input_too_large");
    assert.equal(m.dispatch({ action: "input", session_id: run.session_id, input: "1+1\n",
      approval_token: "private-local-approval" }).ok, true);
    assert.deepEqual(spawned.children[0].stdin.writes, ["1+1\n"]);
  } finally { f.done(); }
});
test("terminal transcript survives manager restart but process is marked interrupted, not falsely resumed", () => {
  const f = fixture(), spawned = fakeSpawn();
  try {
    const a = createDeviceTerminalManager({ env: f.env, spawnImpl: spawned.create });
    const run = a.dispatch({ action: "start", profile: "git_status" });
    spawned.children[0].stdout.emit("data", "persisted text\n");
    const b = createDeviceTerminalManager({ env: f.env, spawnImpl: spawned.create });
    const resumed = b.dispatch({ action: "resume", session_id: run.session_id });
    assert.equal(resumed.status, "interrupted");
    assert.match(resumed.output, /persisted text/);
    assert.equal(b.dispatch({ action: "input", session_id: run.session_id, input: "ignored" }).code, "session_closed");
  } finally { f.done(); }
});
test("no process can be killed by arbitrary PID or unowned session ID", () => {
  const f = fixture(), spawned = fakeSpawn();
  try {
    const m = createDeviceTerminalManager({ env: f.env, spawnImpl: spawned.create });
    const run = m.dispatch({ action: "start", profile: "git_status" });
    assert.equal(m.dispatch({ action: "process_terminate", session_id: "not-owned", pid: 4 }).code, "session_not_found");
    assert.equal(m.dispatch({ action: "input", session_id: run.session_id, input: "sudo" }).code, "session_closed");
    assert.equal(m.dispatch({ action: "output", session_id: run.session_id, cursor: -1 }).code, "invalid_cursor");
  } finally { f.done(); }
});
