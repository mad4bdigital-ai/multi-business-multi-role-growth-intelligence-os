import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const bridge = fs.readFileSync(new URL("./recoveryActionBridge.js", import.meta.url), "utf8");

test("Recovery Action bridge source remains v2 with explicit server-managed confirmation support", () => {
  assert.match(bridge, /mad4b\.recovery-action-bridge\.v2/u);
  assert.match(bridge, /SERVER_APPROVAL_REQUIRED_KEYS = Object\.freeze\(\["approval_id", "expected_sha", "typed_confirmation"\]\)/u);
  assert.match(bridge, /resolveApprovedExecutionApproval/u);
});
