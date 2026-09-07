import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_LAYER_TOOLS } from "./routes/systemLayerRoutes.js";

const bridge = SYSTEM_LAYER_TOOLS.find((tool) => tool.name === "recovery_kernel_execute_approved_step");

test("private Recovery Action system tool advertises explicit v2 typed-confirmation fields", () => {
  assert.ok(bridge);
  assert.equal(bridge.requires_admin, true);
  assert.equal(bridge.inputSchema.additionalProperties, false);
  assert.deepEqual(bridge.inputSchema.required, [
    "plan_id",
    "plan_hash",
    "step_id",
    "approval_id",
    "expected_sha",
    "typed_confirmation",
    "idempotency_key",
  ]);
  assert.equal(Object.hasOwn(bridge.inputSchema.properties, "approval_token"), false);
  assert.ok(bridge.inputSchema.properties.approval_id);
  assert.ok(bridge.inputSchema.properties.expected_sha);
  assert.ok(bridge.inputSchema.properties.typed_confirmation);
});
