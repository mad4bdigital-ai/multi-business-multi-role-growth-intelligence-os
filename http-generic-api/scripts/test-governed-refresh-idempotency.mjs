import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { idempotencyDecision } from "./maintenance-tools/governed-refresh-idempotency.mjs";

const sha = "a".repeat(40), otherSha = "b".repeat(40);
const ref = "feat/device-runtime-mcp-parity-20261019";
const title = (recipe = "auto", head = sha, branch = ref) =>
  `Governed Generated Artifact Refresh · ${recipe} · ${branch} · ${head}`;
const sample = (id, status, conclusion, opts = {}) => ({
  id, status, conclusion, event: "workflow_dispatch", display_title: title(), html_url: `https://github.com/example/runs/${id}`, ...opts,
});
const check = (runs, overrides = {}) => idempotencyDecision({
  prNumber: 8610, expectedHeadSha: sha, recipe: "auto", targetRef: ref, runs, ...overrides
});

test("same PR, SHA and recipe: dedupe queued/running/successful writer runs", () => {
  for (const status of ["queued", "pending", "waiting", "requested", "in_progress"]) {
    const res = check([sample(100, status, null)]);
    assert.equal(res.decision, "already_requested");
    assert.equal(res.matched_run_id, 100);
  }
  assert.equal(check([sample(11, "completed", "success")]).decision, "already_requested");
  assert.equal(check([sample(11, "completed", "success")]).key, `pr:8610:sha:${sha}:recipe:auto`);
});
test("failed/cancelled/skipped jobs are eligible to retry", () => {
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    assert.equal(check([sample(33, "completed", conclusion)]).decision, "dispatch");
  }
  assert.equal(check([]).decision, "dispatch");
});
test("different SHA, branch, recipe or event cannot suppress a requested writer", () => {
  assert.equal(check([sample(3, "in_progress", null, {display_title: title("auto", otherSha)})]).decision, "dispatch");
  assert.equal(check([sample(4, "in_progress", null, {display_title: title("frontend_openapi_refresh")})]).decision, "dispatch");
  assert.equal(check([sample(5, "in_progress", null, {display_title: title("auto", sha, "feat/another")})]).decision, "dispatch");
  assert.equal(check([sample(6, "in_progress", null, {event:"pull_request"})]).decision, "dispatch");
});
test("chooses oldest accepted run and does not expose credentials", () => {
  const result = check([sample(15, "completed", "success"), sample(4, "in_progress", null)]);
  assert.equal(result.matched_run_id, 4);
  assert.equal(result.secrets_included, false);
  assert.equal(result.dispatch_requested, false);
});
test("malformed identity, recipe or run inventory fail closed", () => {
  assert.throws(() => check([], {prNumber:0}), /invalid_exact/);
  assert.throws(() => check([], {expectedHeadSha:"not-a-sha"}), /invalid_exact/);
  assert.throws(() => check([], {recipe:"production_promote"}), /invalid_exact/);
  assert.throws(() => check([], {targetRef:"main"}), /invalid_exact/);
  assert.throws(() => check("not-an-array"), /invalid_exact/);
});
test("dispatch paths use shared non-cancelling lock and canonical replay helper", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const base = path.join(root, ".github/workflows");
  const files = ["governed-generated-artifact-refresh-dispatch-v2.yml",
    "governed-generated-artifact-refresh-request-dispatcher.yml"];
  for (const file of files) {
    const text = fs.readFileSync(path.join(base, file), "utf8");
    assert.match(text, /group: governed-generated-artifact-dispatch-\$\{\{ github\.repository \}\}/);
    assert.match(text, /cancel-in-progress: false/);
    assert.match(text, /governed-refresh-idempotency\.mjs/);
    assert.match(text, /already_requested/);
  }
  const writer = fs.readFileSync(path.join(base, "governed-generated-artifact-refresh.yml"), "utf8");
  assert.match(writer, /cancel-in-progress: false/);
});
