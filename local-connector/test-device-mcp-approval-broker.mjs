import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createDeviceMcpApprovalBroker } from "./device-mcp-approval-broker.mjs";
import { createDeviceMcpResource } from "./device-mcp-resource.mjs";

const LOCAL_APPROVAL = "a".repeat(32);
const env = {
  CONNECTOR_DEVICE_MCP_ENABLED: "true",
  CONNECTOR_DEVICE_MCP_APPROVAL_ENABLED: "true",
  CONNECTOR_DEVICE_MCP_APPROVAL_TOKEN: LOCAL_APPROVAL,
  CONNECTOR_DEVICE_MCP_ENVIRONMENT: "staging",
  CONNECTOR_DEVICE_MCP_ISSUER: "https://dev.mad4b.com",
  CONNECTOR_DEVICE_MCP_RESOURCE: "https://connector.mad4b.com/mcp/device",
  CONNECTOR_DEVICE_ID: "device-1",
  CONNECTOR_TENANT_ID: "tenant-1",
  CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN: "private-file-approval",
  CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN: "private-terminal-approval",
};
function issueData(tool, args = {}) {
  return { action: "issue", device_id: "device-1", tenant_id: "tenant-1",
    subject: "alice", client_id: "chatgpt", tool, arguments: args };
}
test("broker denies disabled, missing separate approval, invalid identity and arbitrary tools", () => {
  const off = createDeviceMcpApprovalBroker({ env: { ...env,
    CONNECTOR_DEVICE_MCP_APPROVAL_ENABLED: "false" } });
  assert.equal(off.capabilities.enabled, false);
  const prod = createDeviceMcpApprovalBroker({ env: {
    ...env, CONNECTOR_DEVICE_MCP_ENVIRONMENT: "production" } });
  assert.equal(prod.capabilities.enabled, false);
  assert.equal(off.issue(issueData("files_patch"), LOCAL_APPROVAL).ok, false);
  const broker = createDeviceMcpApprovalBroker({ env });
  assert.equal(broker.issue(issueData("files_patch"), "").code, "local_consent_required");
  assert.equal(broker.issue(issueData("files_patch"), "wrong").code, "local_consent_required");
  assert.equal(broker.issue(issueData("arbitrary_shell"), LOCAL_APPROVAL).ok, false);
  assert.equal(broker.issue({ ...issueData("files_patch"), device_id: "other" }, LOCAL_APPROVAL).ok, false);
  assert.equal(broker.issue({ ...issueData("files_patch"), tenant_id: "other" }, LOCAL_APPROVAL).ok, false);
  assert.equal(broker.issue({ ...issueData("files_patch"), subject: "x\n" }, LOCAL_APPROVAL).ok, false);
  assert.equal(broker.issue({ ...issueData("files_patch"), approval_token: "leak" }, LOCAL_APPROVAL).ok, false);
});
test("exact local consent is atomic, one-shot, principal-bound, argument-bound and short-lived", () => {
  let clock = 100000;
  const broker = createDeviceMcpApprovalBroker({ env, now: () => clock });
  const args = { relative_path: "docs/readme.md", content: "hello" };
  const receipt = broker.issue(issueData("files_create_file", args), LOCAL_APPROVAL);
  assert.equal(receipt.ok, true);
  assert.equal(JSON.stringify(receipt).includes(LOCAL_APPROVAL), false);
  assert.equal(broker.consume('oauth:["tenant-1","bob","chatgpt"]', "files_create_file", args), false);
  assert.equal(broker.consume('oauth:["tenant-1","alice","chatgpt"]', "files_create_file",
    { relative_path: "docs/other.md", content: "hello" }), false);
  const principal = 'oauth:["tenant-1","alice","chatgpt"]';
  assert.equal(broker.consume(principal, "files_create_file", { content: "hello", relative_path: "docs/readme.md" }), true);
  assert.equal(broker.consume(principal, "files_create_file", args), false);
  assert.equal(broker.issue(issueData("terminal_input", { session_id: "s", input: "help\n" }), LOCAL_APPROVAL).ok, true);
  clock += 90001;
  assert.equal(broker.consume(principal, "terminal_input", { session_id: "s", input: "help\n" }), false);
});
test("signed OAuth read and approved write stay separate; no secrets enter MCP tool arguments", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const fullEnv = { ...env, CONNECTOR_DEVICE_MCP_JWKS_JSON:
    JSON.stringify({ keys: [{ ...jwk, kid: "test", alg: "RS256", use: "sig" }] }) };
  const now = Date.now();
  const broker = createDeviceMcpApprovalBroker({ env: fullEnv, now: () => now });
  const calls = [];
  const audits = [];
  const files = { capabilities: { enabled: true, write_enabled: true },
    dispatch: payload => { calls.push(payload); return { ok: true, action: payload.action }; } };
  const terminal = { capabilities: { enabled: true, interactive_enabled: true, pty: true },
    dispatch: payload => { calls.push(payload); return { ok: true, action: payload.action }; } };
  const gateway = createDeviceMcpResource({ env: fullEnv, files, terminal, approvals: broker,
    now: () => now, onAudit: event => audits.push(event) });
  function signed(subject = "alice", scope = "device:files:write device:terminal:interactive") {
    const encode = x => Buffer.from(JSON.stringify(x)).toString("base64url");
    const h = encode({ alg: "RS256", kid: "test", typ: "at+jwt" });
    const p = encode({ iss: env.CONNECTOR_DEVICE_MCP_ISSUER, aud: env.CONNECTOR_DEVICE_MCP_RESOURCE,
      sub: subject, azp: "chatgpt", device_id: env.CONNECTOR_DEVICE_ID,
      tenant_id: env.CONNECTOR_TENANT_ID, environment: "staging", scope,
      iat: Math.floor(now / 1000) - 5, exp: Math.floor(now / 1000) + 180 });
    return "Bearer " + h + "." + p + "." +
      sign("RSA-SHA256", Buffer.from(h + "." + p), privateKey).toString("base64url");
  }
  const request = (token, name, args) => gateway.handle({ authorization: token,
    body: { jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args } } });
  const args = { relative_path: "src/example.txt", content: "example" };
  assert.equal(request(signed("alice", "device:files:read"), "files_create_file", args).body.error.code, -32601);
  const denied = request(signed(), "files_create_file", args);
  assert.equal(JSON.parse(denied.body.result.content[0].text).code, "local_consent_required");
  assert.equal(calls.length, 0);
  assert.equal(broker.issue(issueData("files_create_file", args), LOCAL_APPROVAL).ok, true);
  assert.equal(JSON.parse(request(signed("bob"), "files_create_file", args).body.result.content[0].text).code,
    "local_consent_required");
  const result = request(signed(), "files_create_file", args);
  assert.equal(result.body.result.isError, false);
  assert.equal(calls.at(-1).approval_token, env.CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN);
  assert.equal(JSON.stringify(result).includes(env.CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN), false);
  assert.equal(JSON.parse(request(signed(), "files_create_file", args).body.result.content[0].text).code,
    "local_consent_required");
  const input = { session_id: "owned-id", input: "echo hi\n" };
  assert.equal(broker.issue(issueData("terminal_input", input), LOCAL_APPROVAL).ok, true);
  assert.equal(request(signed(), "terminal_input", input).body.result.isError, false);
  assert.equal(calls.at(-1).owner_principal, 'oauth:["tenant-1","alice","chatgpt"]');
  assert.equal(calls.at(-1).approval_token, env.CONNECTOR_DEVICE_TERMINAL_APPROVAL_TOKEN);
  assert.equal(request(signed(), "terminal_input", { ...input, approval_token: "leak" }).body.error.code, -32602);

  const resizeArgs = { session_id: "owned-id", cols: 90, rows: 30 };
  assert.equal(JSON.parse(request(signed(), "terminal_resize", resizeArgs).body.result.content[0].text).code,
    "local_consent_required");
  assert.equal(broker.issue(issueData("terminal_resize", resizeArgs), LOCAL_APPROVAL).ok, true);
  assert.equal(JSON.parse(request(signed("bob"), "terminal_resize", resizeArgs).body.result.content[0].text).code,
    "local_consent_required");
  assert.equal(request(signed(), "terminal_resize", { ...resizeArgs, rows: 81 }).body.error.code, -32602);
  assert.equal(request(signed(), "terminal_resize", resizeArgs).body.result.isError, false);
  assert.equal(calls.at(-1).action, "resize");
  assert.equal(JSON.parse(request(signed(), "terminal_resize", resizeArgs).body.result.content[0].text).code,
    "local_consent_required");

  const sessionArgs = { session_id: "owned-id" };
  for (const tool of ["terminal_cancel", "process_terminate_owned", "sessions_close"]) {
    const executeGrant = signed("alice", "device:terminal:execute");
    assert.equal(JSON.parse(request(executeGrant, tool, sessionArgs).body.result.content[0].text).code,
      "local_consent_required", tool + " must fail closed without local consent");
    assert.equal(broker.issue(issueData(tool, sessionArgs), LOCAL_APPROVAL).ok, true);
    assert.equal(JSON.parse(request(signed("bob", "device:terminal:execute"), tool, sessionArgs).body.result.content[0].text).code,
      "local_consent_required", "a different OAuth subject cannot use " + tool + " consent");
    assert.equal(request(executeGrant, tool, sessionArgs).body.result.isError, false);
    assert.equal(calls.at(-1).owner_principal, 'oauth:["tenant-1","alice","chatgpt"]');
    assert.equal(JSON.parse(request(executeGrant, tool, sessionArgs).body.result.content[0].text).code,
      "local_consent_required", tool + " consent must be one-shot");
  }
  assert.ok(audits.some(x => x.outcome === "scope_denied"));
  assert.ok(audits.some(x => x.outcome === "success" && x.tool === "files_create_file"));
  assert.ok(audits.some(x => x.outcome === "rejected_or_failed" && x.tool === "terminal_cancel"));
  assert.ok(audits.every(x => /^[a-f0-9]{64}$/.test(x.principal_hash)));
  assert.equal(JSON.stringify(audits).includes(LOCAL_APPROVAL), false);
  assert.equal(JSON.stringify(audits).includes(env.CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN), false);
  assert.equal(JSON.stringify(audits).includes("alice"), false);

  // Ending an owned read-only session must not require enabling an interactive REPL.
  const readOnlyTerminal = { ...terminal, capabilities: { ...terminal.capabilities, interactive_enabled: false } };
  const readOnlyGateway = createDeviceMcpResource({ env: fullEnv, files,
    terminal: readOnlyTerminal, approvals: broker, now: () => now });
  const terminalGrant = signed("alice", "device:terminal:execute device:terminal:interactive");
  const listed = readOnlyGateway.handle({ authorization: terminalGrant,
    body: { jsonrpc: "2.0", id: 2, method: "tools/list" } }).body.result.tools.map(x => x.name);
  for (const tool of ["terminal_cancel", "process_terminate_owned", "sessions_close"])
    assert.ok(listed.includes(tool), tool + " must be discoverable without interactive terminal");
  assert.ok(!listed.includes("terminal_start_interactive"));
  assert.ok(!listed.includes("terminal_input"));
  const sessionOnly = { session_id: "read-only-owned" };
  const cancelOnce = () => readOnlyGateway.handle({ authorization: terminalGrant,
    body: { jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "terminal_cancel", arguments: sessionOnly } } });
  assert.equal(JSON.parse(cancelOnce().body.result.content[0].text).code, "local_consent_required");
  assert.equal(broker.issue(issueData("terminal_cancel", sessionOnly), LOCAL_APPROVAL).ok, true);
  assert.equal(cancelOnce().body.result.isError, false);
  assert.equal(JSON.parse(cancelOnce().body.result.content[0].text).code, "local_consent_required");
});
