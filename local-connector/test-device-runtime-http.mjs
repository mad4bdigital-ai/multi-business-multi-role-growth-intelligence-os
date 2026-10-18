import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";

async function unusedPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function ready(url, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("connector exited early: " + child.exitCode);
    try {
      const response = await fetch(url + "/health", { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* startup continues */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("loopback Connector did not become ready");
}
test("real loopback Connector enforces device boundaries and preserves file/terminal invariants", { timeout: 25000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-device-http-"));
  const root = path.join(base, "repo");
  const fileState = path.join(base, "file-state");
  const terminalState = path.join(base, "terminal-state");
  fs.mkdirSync(root); fs.mkdirSync(fileState); fs.mkdirSync(terminalState);
  fs.writeFileSync(path.join(root, "sample.txt"), "read-only original\n");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const port = await unusedPort();
  const url = "http://127.0.0.1:" + port;
  const env = {
    ...process.env,
    CONNECTOR_PORT: String(port),
    CONNECTOR_SECRET: "dev-test-device-secret",
    CONNECTOR_LOCAL_API_KEY: "",
    BACKEND_API_KEY: "",
    CONNECTOR_DEVICE_ID: "test-device-1",
    CONNECTOR_ENVIRONMENT: "staging",
    CONNECTOR_POLICY_ENABLED: "false",
    CONNECTOR_FILES_ENABLED: "false",
    CONNECTOR_DEVICE_FILES_ENABLED: "true",
    CONNECTOR_DEVICE_FILE_ROOT: root,
    CONNECTOR_FILE_PATHS: JSON.stringify([root]),
    CONNECTOR_DEVICE_FILE_WRITES_ENABLED: "true",
    CONNECTOR_DEVICE_STATE_DIR: fileState,
    CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN: "local-file-approval",
    CONNECTOR_DEVELOPER_REPO_ROOT: root,
    CONNECTOR_DEVICE_TERMINAL_ENABLED: "true",
    CONNECTOR_DEVICE_TERMINAL_STATE_DIR: terminalState,
    CONNECTOR_DEVICE_TERMINAL_INTERACTIVE_ENABLED: "false",
    CONNECTOR_DEVICE_MCP_ENABLED: "true",
    CONNECTOR_DEVICE_MCP_APPROVAL_ENABLED: "true",
    CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN: "http-local-consent-strong-test-token",
    CONNECTOR_DEVICE_MCP_ENVIRONMENT: "staging",
    CONNECTOR_DEVICE_MCP_ISSUER: "https://dev.mad4b.com",
    CONNECTOR_DEVICE_MCP_RESOURCE: "https://connector.mad4b.com/mcp/device",
    CONNECTOR_DEVICE_MCP_JWKS_JSON: JSON.stringify({ keys: [{ ...jwk, kid: "http-test", alg: "RS256", use: "sig" }] }),
    CONNECTOR_TENANT_ID: "http-test-tenant",
  };
  let child;
  let stderr = "";
  try {
    child = spawn(process.execPath, [path.join(process.cwd(), "local-connector/server.mjs")], {
      env, cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe"], windowsHide: true,
    });
    child.stderr.on("data", value => { stderr = (stderr + value.toString()).slice(-3000); });
    await ready(url, child);
    const post = async (target, body, headers = {}) => {
      const response = await fetch(url + target, { method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
      return { status: response.status, value: await response.json() };
    };
    const auth = { "x-connector-secret": "dev-test-device-secret" };
    assert.equal((await post("/device/files", { action: "list", device_id: "test-device-1" })).status, 401);
    assert.equal((await post("/device/files", { action: "list", device_id: "wrong" }, auth)).status, 403);
    assert.equal((await post("/device/files", { action: "read", device_id: "test-device-1",
      relative_path: "../outside.txt" }, auth)).status, 403);
    const read = await post("/device/files", { action: "read", device_id: "test-device-1",
      relative_path: "sample.txt" }, auth);
    assert.equal(read.status, 200);
    assert.equal(read.value.content, "read-only original\n");
    const patch = { action: "patch", device_id: "test-device-1",
      relative_path: "sample.txt", expected_sha256: read.value.sha256,
      old_text: "original", new_text: "changed" };
    assert.equal((await post("/device/files", patch, auth)).status, 403);
    const changed = await post("/device/files", patch,
      { ...auth, "x-mad4b-device-write-approval": "local-file-approval" });
    assert.equal(changed.status, 200);
    assert.equal(changed.value.ok, true);
    assert.equal(fs.readFileSync(path.join(root, "sample.txt"), "utf8"), "read-only changed\n");
    const rollback = await post("/device/files", { action: "rollback", device_id: "test-device-1",
      transaction_id: changed.value.transaction_id }, { ...auth, "x-mad4b-device-write-approval": "local-file-approval" });
    assert.equal(rollback.status, 200);
    assert.equal(fs.readFileSync(path.join(root, "sample.txt"), "utf8"), "read-only original\n");
    assert.equal((await post("/device/terminal", { action: "start", device_id: "wrong",
      profile: "git_status" }, auth)).status, 403);
    const terminal = await post("/device/terminal", { action: "start",
      device_id: "test-device-1", profile: "git_status" }, auth);
    assert.equal(terminal.status, 200);
    assert.ok(terminal.value.session_id);
    const list = await post("/device/terminal", { action: "list", device_id: "test-device-1" }, auth);
    assert.equal(list.status, 200);
    assert.ok(list.value.sessions.some(v => v.session_id === terminal.value.session_id));
    assert.equal((await post("/device/terminal", { action: "input", device_id: "test-device-1",
      session_id: terminal.value.session_id, input: "whoami\n" }, auth)).status, 409);
    const unauthorized = await fetch(url + "/mcp/device", { method: "POST",
      headers: { Authorization: "Bearer dev-test-device-secret",
        "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0",
        id: 1, method: "tools/list" }) });
    assert.equal(unauthorized.status, 401);
    const jwt = (subject, scope = "device:terminal:read device:terminal:execute") => {
      const now = Math.floor(Date.now() / 1000);
      const encode = object => Buffer.from(JSON.stringify(object)).toString("base64url");
      const tokenHead = encode({ typ: "at+jwt", alg: "RS256", kid: "http-test" });
      const payload = encode({
        iss: env.CONNECTOR_DEVICE_MCP_ISSUER, aud: env.CONNECTOR_DEVICE_MCP_RESOURCE,
        iat: now - 10, exp: now + 180, sub: subject, azp: "http-test-client",
        scope,
        device_id: env.CONNECTOR_DEVICE_ID, tenant_id: env.CONNECTOR_TENANT_ID,
        environment: "staging",
      });
      const signed = tokenHead + "." + payload;
      return signed + "." + sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url");
    };
    const call = async (subject, name, args = {}, scope) => {
      const res = await fetch(url + "/mcp/device", {
        method: "POST", headers: { authorization: "Bearer " + jwt(subject, scope), "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
          params: { name, arguments: args } }), signal: AbortSignal.timeout(3000),
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.result, JSON.stringify(data));
      return JSON.parse(data.result.content[0].text);
    };
    const ownerSession = await call("alice", "terminal_start_readonly", { profile: "git_status" });
    assert.equal(ownerSession.ok, true);
    assert.equal((await call("bob", "sessions_list")).sessions.length, 0);
    assert.equal((await call("bob", "terminal_output", { session_id: ownerSession.session_id })).code,
      "session_not_found");
    assert.equal((await call("bob", "terminal_cancel", { session_id: ownerSession.session_id })).code,
      "session_not_found");
    assert.equal((await call("alice", "sessions_get", { session_id: ownerSession.session_id })).ok, true);
    // Complete HTTP consent boundary: no implicit writes from OAuth alone,
    // approval secret never enters JSON-RPC, and the receipt cannot be replayed.
    const writeArgs = { relative_path: "mcp-new.txt", content: "one-shot write\\n" };
    const writeScope = "device:files:write";
    assert.equal((await call("alice", "files_create_file", writeArgs, writeScope)).code,
      "local_consent_required");
    const approvalRequest = {
      action: "issue", device_id: "test-device-1", tenant_id: "http-test-tenant",
      subject: "alice", client_id: "http-test-client",
      tool: "files_create_file", arguments: writeArgs,
    };
    assert.equal((await post("/device/mcp/approvals", approvalRequest, auth)).status, 403);
    assert.equal((await post("/device/mcp/approvals",
      { ...approvalRequest, device_id: "wrong" },
      { ...auth, "x-mad4b-device-mcp-approval": "http-local-consent-strong-test-token" })).status, 400);
    const permit = await post("/device/mcp/approvals", approvalRequest,
      { ...auth, "x-mad4b-device-mcp-approval": "http-local-consent-strong-test-token" });
    assert.equal(permit.status, 200);
    assert.equal(permit.value.one_shot, true);
    assert.equal((await call("bob", "files_create_file", writeArgs, writeScope)).code,
      "local_consent_required");
    assert.equal((await call("alice", "files_create_file", writeArgs, writeScope)).ok, true);
    assert.equal(fs.readFileSync(path.join(root, "mcp-new.txt"), "utf8"), "one-shot write\\n");
    assert.equal((await call("alice", "files_create_file", writeArgs, writeScope)).code,
      "local_consent_required");
  } catch (error) {
    error.message += "\nConnector stderr: " + stderr.replace(/Bearer\s+\S+/g, "Bearer [REDACTED]");
    throw error;
  } finally {
    if (child && child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(base, { recursive: true, force: true });
  }
});
