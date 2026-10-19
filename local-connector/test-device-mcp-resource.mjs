import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createDeviceMcpResource } from "./device-mcp-resource.mjs";
import { createDeviceMcpApprovalBroker } from "./device-mcp-approval-broker.mjs";
import { createDeviceTerminalManager } from "./device-terminal-engine.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

const now = 1781762400000;
function fixture(terminalOverride, { consent = false } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const env = {
    CONNECTOR_DEVICE_MCP_ENABLED: "true",
    CONNECTOR_DEVICE_MCP_ENVIRONMENT: "staging",
    CONNECTOR_DEVICE_MCP_ISSUER: "https://dev.mad4b.com",
    CONNECTOR_DEVICE_MCP_RESOURCE: "https://connector.mad4b.com/mcp/device",
    CONNECTOR_DEVICE_MCP_JWKS_JSON: JSON.stringify({ keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }] }),
    CONNECTOR_DEVICE_ID: "device-real-1",
    CONNECTOR_TENANT_ID: "tenant-1",
    ...(consent ? {
      CONNECTOR_DEVICE_MCP_APPROVAL_ENABLED: "true",
      CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN: "test-local-consent-secret-strong-123",
    } : {}),
  };
  const claims = {
    iss: "https://dev.mad4b.com", aud: "https://connector.mad4b.com/mcp/device",
    exp: Math.floor(now / 1000) + 180, iat: Math.floor(now / 1000) - 10,
    sub: "alice", azp: "mcp-ai-client", scope: "device:status:read device:files:read device:terminal:read device:terminal:execute",
    device_id: "device-real-1", tenant_id: "tenant-1", environment: "staging",
  };
  function bearer(extra = {}, signingKey = privateKey) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ typ: "at+jwt", alg: "RS256", kid: "test-key" });
    const payload = encode({ ...claims, ...extra });
    const content = header + "." + payload;
    return "Bearer " + content + "." + sign("RSA-SHA256", Buffer.from(content), signingKey).toString("base64url");
  }
  const called = [];
  const files = { capabilities: { enabled: true, read_enabled: true, write_enabled: true, root: "/private/admin/project" }, dispatch: x => { called.push(x); return { ok: true, entries: [], echo: x.action }; } };
  const terminal = terminalOverride || { capabilities: { enabled: true }, dispatch: x => { called.push(x); return { ok: true, echo: x.action }; } };
  const approvals = consent ? createDeviceMcpApprovalBroker({ env, now: () => now }) : null;
  const gateway = createDeviceMcpResource({ env, files, terminal, approvals, now: () => now });
  const request = (authorization, method, params = {}, id = 1) =>
    gateway.handle({ authorization, body: { jsonrpc: "2.0", id, method, params } });
  return { env, claims, bearer, gateway, request, called, approvals };
}
test("fails closed without explicit issuer, tenant, keys, or feature flag", () => {
  assert.equal(createDeviceMcpResource().capabilities.enabled, false);
  const f = fixture();
  assert.equal(f.gateway.capabilities.enabled, true);
  assert.equal(createDeviceMcpResource({ env: { ...f.env, CONNECTOR_TENANT_ID: "" } }).capabilities.enabled, false);
  assert.equal(createDeviceMcpResource({ env: { ...f.env, CONNECTOR_DEVICE_MCP_ISSUER: "https://evil.example" } }).capabilities.enabled, false);
  assert.equal(createDeviceMcpResource({ env: { ...f.env, CONNECTOR_DEVICE_MCP_ENABLED: "false" } }).capabilities.enabled, false);
  assert.equal(f.gateway.metadata().authorization_servers[0], "https://dev.mad4b.com");
});
test("valid signed OAuth bearer can discover only granted device-scoped tools", () => {
  const f = fixture();
  const initialized = f.request(f.bearer(), "initialize");
  assert.equal(initialized.http_status, 200);
  assert.equal(initialized.body.result.serverInfo.name, "mad4b-device-gateway");
  const limited = f.bearer({ scope: "device:files:read" });
  const list = f.request(limited, "tools/list").body.result.tools.map(x => x.name);
  assert.ok(list.includes("files_read"));
  assert.ok(!list.includes("terminal_start_readonly"));
  assert.ok(!list.includes("process_list"));
  const read = f.request(limited, "tools/call", { name: "files_read",
    arguments: { relative_path: "src/index.js" } });
  assert.equal(read.body.result.isError, false);
  assert.equal(f.called[0].action, "read");
  assert.equal(f.request(limited, "tools/call", { name: "terminal_start_readonly",
    arguments: { profile: "git_status" } }).body.error.code, -32601);
  assert.equal(f.request(limited, "tools/call", { name: "files_write",
    arguments: {} }).body.error.code, -32601);
});
test("rejects wrong audience, issuer, tenant, environment, device, expiry and signatures", () => {
  const f = fixture();
  const invalid = [
    f.bearer({ aud: "https://auth.mad4b.com" }),
    f.bearer({ iss: "https://auth.mad4b.com" }),
    f.bearer({ tenant_id: "tenant-b" }),
    f.bearer({ environment: "production" }),
    f.bearer({ device_id: "other-device" }),
    f.bearer({ exp: Math.floor(now / 1000) - 50 }),
    f.bearer({ iat: Math.floor(now / 1000) - 7200, exp: Math.floor(now / 1000) + 10 }),
    "Bearer CONNECTOR_ADMIN_RECOVERY_SECRET",
    f.bearer().replace(/.$/, "x"),
  ];
  for (const authorization of invalid) {
    const result = f.request(authorization, "tools/list");
    assert.equal(result.http_status, 401);
    assert.match(result.headers["WWW-Authenticate"], /resource_metadata/);
  }
});
test("rejects noncanonical base64url signatures even when decoded signature bytes are identical", () => {
  const f = fixture();
  const token = f.bearer();
  const parts = token.split(".");
  const signature = parts[2];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(signature.at(-1));
  assert.ok(last >= 0 && (last & 15) === 0, "RSA-2048 signature has one residual base64url byte");
  const ambiguous = signature.slice(0, -1) + alphabet[last + 1];
  assert.deepEqual(Buffer.from(ambiguous, "base64url"), Buffer.from(signature, "base64url"));
  assert.equal(f.request(parts[0] + "." + parts[1] + "." + ambiguous, "tools/list").http_status, 401);
});

test("terminal ownership comes only from validated OAuth claims", () => {
  const f = fixture();
  const alice = f.request(f.bearer(), "tools/call", { name: "terminal_start_readonly",
    arguments: { profile: "git_status" } });
  assert.equal(alice.body.result.isError, false);
  const call = f.called[0];
  assert.equal(call.action, "start");
  assert.equal(call.owner_principal, 'oauth:["tenant-1","alice","mcp-ai-client"]');
  assert.equal(f.request(f.bearer(), "tools/call", { name: "terminal_start_readonly",
    arguments: { profile: "powershell" } }).body.error.code, -32602);
  assert.equal(f.request(f.bearer(), "tools/call", { name: "terminal_start_readonly",
    arguments: { profile: "git_log", approval_token: "no" } }).body.error.code, -32602);
});
test("rejects oversized, malformed JSON-RPC and unknown methods without executing tools", () => {
  const f = fixture();
  const bearer = f.bearer();
  assert.equal(f.gateway.handle({ authorization: bearer, body: { x: "a".repeat(70000) } }).http_status, 413);
  const bogus = f.gateway.handle({ authorization: bearer, body: { jsonrpc: "2.0", method: 3, id: 1 } });
  assert.equal(bogus.http_status, 400);
  assert.equal(f.request(bearer, "not-supported").body.error.code, -32601);
  assert.equal(f.called.length, 0);
});


test("device status scope cannot reveal local filesystem paths or privileged write capabilities", () => {
  const f = fixture();
  const readOnly = f.bearer({ scope: "device:status:read" });
  const exposed = f.request(readOnly, "tools/call", { name: "devices_capabilities", arguments: {} });
  const result = JSON.parse(exposed.body.result.content[0].text);
  assert.equal(result.ok, true);
  assert.equal(result.files.read_enabled, true);
  assert.equal(result.files.write_enabled, false);
  assert.equal(result.terminal.interactive_enabled, false);
  assert.equal(JSON.stringify(result).includes("/private/admin/project"), false);
  assert.equal(JSON.stringify(result).includes("root"), false);
});

test("principal names with separators cannot alias another OAuth subject or client", () => {
  const f = fixture();
  const first = f.request(f.bearer({ sub: "alice:agent", azp: "client" }),
    "tools/call", { name: "terminal_start_readonly", arguments: { profile: "git_status" } });
  const second = f.request(f.bearer({ sub: "alice", azp: "agent:client" }),
    "tools/call", { name: "terminal_start_readonly", arguments: { profile: "git_status" } });
  assert.equal(first.body.result.isError, false);
  assert.equal(second.body.result.isError, false);
  assert.notEqual(f.called[0].owner_principal, f.called[1].owner_principal);
  assert.equal(f.called[0].owner_principal, 'oauth:["tenant-1","alice:agent","client"]');
  assert.equal(f.called[1].owner_principal, 'oauth:["tenant-1","alice","agent:client"]');
});

test("signed OAuth principals are isolated using the actual terminal manager", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-mcp-owner-"));
  const root = path.join(base, "repo"), state = path.join(base, "state");
  fs.mkdirSync(root); fs.mkdirSync(state);
  const env = {
    CONNECTOR_DEVICE_TERMINAL_ENABLED: "true", CONNECTOR_DEVELOPER_REPO_ROOT: root,
    CONNECTOR_FILE_PATHS: JSON.stringify([root]), CONNECTOR_DEVICE_TERMINAL_STATE_DIR: state,
    CONNECTOR_DEVICE_ID: "device-real-1",
  };
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.pid = 12345; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { destroyed: false, writableEnded: false, write() {} };
    child.kill = () => { child.emit("close", null); return true; };
    return child;
  };
  try {
    const engine = createDeviceTerminalManager({ env, spawnImpl: fakeSpawn });
    const withoutConsent = fixture(engine);
    const scopes = "device:terminal:read device:terminal:execute";
    assert.equal(withoutConsent.request(withoutConsent.bearer({ scope: scopes }),
      "tools/call", { name: "terminal_cancel", arguments: { session_id: "unknown" } })
      .body.error.code, -32601, "teardown must not be exposed without the local approval broker");
    const f = fixture(engine, { consent: true });
    const alice = f.bearer({ sub: "alice", scope: scopes });
    const bob = f.bearer({ sub: "bob", scope: scopes });
    const call = (token, name, args = {}) =>
      f.request(token, "tools/call", { name, arguments: args });
    const outcome = (token, name, args = {}) =>
      JSON.parse(call(token, name, args).body.result.content[0].text);
    const issue = (subject, tool, args) => f.approvals.issue({
      action: "issue", device_id: "device-real-1", tenant_id: "tenant-1",
      subject, client_id: "mcp-ai-client", tool, arguments: args,
    }, "test-local-consent-secret-strong-123");
    const start = outcome(alice, "terminal_start_readonly", { profile: "git_status" });
    assert.equal(start.ok, true);
    assert.deepEqual(outcome(bob, "sessions_list").sessions, []);
    const session = { session_id: start.session_id };
    for (const name of ["sessions_get", "terminal_output"]) {
      assert.equal(outcome(bob, name, session).code, "session_not_found", name);
    }
    for (const name of ["terminal_cancel", "process_terminate_owned", "sessions_close"]) {
      assert.equal(outcome(bob, name, session).code, "local_consent_required", name);
      assert.equal(issue("bob", name, session).ok, true);
      assert.equal(outcome(bob, name, session).code, "session_not_found", name);
      assert.equal(outcome(bob, name, session).code, "local_consent_required", name + " replay");
    }
    assert.equal(outcome(alice, "sessions_get", session).ok, true);
    assert.equal(outcome(alice, "terminal_cancel", session).code, "local_consent_required");
    assert.equal(issue("alice", "terminal_cancel", session).ok, true);
    assert.equal(outcome(alice, "terminal_cancel", session).ok, true);
    assert.equal(outcome(alice, "terminal_cancel", session).code, "local_consent_required");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
