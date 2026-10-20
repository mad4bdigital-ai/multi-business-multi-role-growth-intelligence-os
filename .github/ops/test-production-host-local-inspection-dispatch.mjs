import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateInspectionRequest, buildInspectionDispatch, executeInspectionDispatch,
  REPOSITORY, TOKEN_PREFIX, OWNER_ID,
} from "./production-host-local-inspection-dispatch.mjs";

const MAIN = "2b5a56e26fdf98645bfeb2a1a97b32a293071cb3";
const PROD = "e0c07f6fba431650b87d7a6f3dde76a364be6223";
const input = () => ({
  eventName: "issue_comment", eventSha: MAIN, eventRef: "refs/heads/main",
  main: { commit: { sha: MAIN }, protected: true },
  production: { commit: { sha: PROD }, protected: true },
  event: {
    action: "created", repository: { full_name: REPOSITORY }, issue: { number: 6625 },
    comment: { id: 123, user: { id: OWNER_ID }, author_association: "OWNER", body: TOKEN_PREFIX + PROD },
  },
});

test("owner and protected refs allow one fixed inspection dispatch only", () => {
  const state = validateInspectionRequest(input());
  assert.equal(state.ok, true);
  assert.equal(state.read_only, true);
  assert.equal(state.provider_mutation, false);
  const body = buildInspectionDispatch(PROD);
  assert.deepEqual(body, {
    ref: "main",
    inputs: {
      expected_sha: PROD,
      strategy: "disabled",
      apply_execution: "false",
      bootstrap_mode: "full_role_inspection",
      bootstrap_target_key: "production-runtime",
      bootstrap_target_source: "host_local_role_env",
    },
  });
  for (const key of [
    "recovery_envelope", "bootstrap_migration_confirmation", "bootstrap_grants_confirmation",
    "bootstrap_execution_ticket_id", "bootstrap_control_store_confirmation",
    "bootstrap_rebuild_confirmation",
  ]) {
    assert.ok(!(key in body.inputs), key + " cannot be supplied");
  }
});

test("invalid identity, refs, or untrusted body fail closed", () => {
  const cases = [
    ["wrong actor", x => { x.event.comment.user.id = 1; }],
    ["non-owner", x => { x.event.comment.author_association = "COLLABORATOR"; }],
    ["wrong issue", x => { x.event.issue.number = 8500; }],
    ["PR comment", x => { x.event.issue.pull_request = { url: "x" }; }],
    ["wrong repo", x => { x.event.repository.full_name = "some/other"; }],
    ["bad token", x => { x.event.comment.body += "\napply=true"; }],
    ["wrong Production SHA", x => { x.event.comment.body = TOKEN_PREFIX + MAIN; }],
    ["main drift", x => { x.eventSha = PROD; }],
    ["wrong ref", x => { x.eventRef = "refs/heads/Production"; }],
    ["unprotected main", x => { x.main.protected = false; }],
    ["unprotected Production", x => { x.production.protected = false; }],
    ["Production drift", x => { x.production.commit.sha = MAIN; }],
    ["wrong event", x => { x.event.action = "edited"; }],
  ];
  for (const [name, mutate] of cases) {
    const v = input();
    mutate(v);
    assert.equal(validateInspectionRequest(v).ok, false, name);
  }
  assert.throws(() => buildInspectionDispatch("invalid_sha"));
});

test("single 204 POST after exact two-cycle branch protection readback", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body || null });
    if (url.endsWith("/branches/main")) return { status: 200, json: async () => input().main };
    if (url.endsWith("/branches/Production")) return { status: 200, json: async () => input().production };
    if (url.endsWith("/dispatches")) return { status: 204 };
    throw new Error("Unexpected endpoint");
  };
  const result = await executeInspectionDispatch({ ...input(), token: "test-only", fetchImpl });
  assert.equal(result.outcome, "dispatched");
  assert.equal(calls.filter(x => x.method === "GET").length, 4);
  assert.equal(calls.filter(x => x.method === "POST").length, 1);
  assert.deepEqual(JSON.parse(calls.find(x => x.method === "POST").body), buildInspectionDispatch(PROD));
});

test("second-cycle Production drift blocks without POST", async () => {
  const calls = [];
  let productionReads = 0;
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    if (url.endsWith("/branches/main")) return { status: 200, json: async () => input().main };
    if (url.endsWith("/branches/Production")) {
      const production = input().production;
      productionReads += 1;
      if (productionReads > 1) production.commit.sha = MAIN;
      return { status: 200, json: async () => production };
    }
    throw new Error("Dispatch must not be called");
  };
  await assert.rejects(executeInspectionDispatch({ ...input(), token: "test-only", fetchImpl }), /inspection_dispatch_ref_drift/);
  assert.ok(!calls.includes("POST"));
});

test("403 branch metadata never enables a POST", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    if (url.endsWith("/branches/main")) return { status: 403 };
    return { status: 200, json: async () => input().production };
  };
  await assert.rejects(executeInspectionDispatch({ ...input(), token: "test-only", fetchImpl }), /branch_readback_failed/);
  assert.ok(!calls.includes("POST"));
});

test("non-204 dispatch has one attempt and cannot claim execution", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(init.method);
    if (url.endsWith("/branches/main")) return { status: 200, json: async () => input().main };
    if (url.endsWith("/branches/Production")) return { status: 200, json: async () => input().production };
    if (url.endsWith("/dispatches")) return { status: 403 };
    throw new Error("Unexpected endpoint");
  };
  await assert.rejects(executeInspectionDispatch({ ...input(), token: "test-only", fetchImpl }), /inspection_dispatch_not_accepted/);
  assert.equal(calls.filter(x => x === "POST").length, 1);
});
