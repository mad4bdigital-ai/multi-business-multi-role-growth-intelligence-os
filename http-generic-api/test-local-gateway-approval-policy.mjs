import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildLocalGatewayApprovalBinding,
  localGatewayConsentRequired,
  localGatewayConsentStatus,
  validateLocalGatewayApprovalBinding,
} from "./localGatewayApprovalPolicy.js";

assert.equal(localGatewayConsentRequired({ risk_class: "low", consent_required: 0, requires_approval: 0, is_consequential: 0 }), false);
for (const tool of [
  { risk_class: "high" },
  { risk_class: "admin_recovery" },
  { risk_class: "medium", is_consequential: 1 },
  { risk_class: "medium", requires_approval: 1 },
  { risk_class: "medium", consent_required: 1 },
]) {
  assert.equal(localGatewayConsentRequired(tool), true, `consent must fail closed for ${JSON.stringify(tool)}`);
}
assert.equal(localGatewayConsentStatus({ risk_class: "high" }, {}), "missing");
assert.equal(localGatewayConsentStatus({ risk_class: "high" }, { consent_accepted: true }), "accepted");
assert.equal(localGatewayConsentStatus({ risk_class: "low" }, {}), "not_required");

const base = {
  toolKey: "local.connector.files",
  tenantId: "tenant-1",
  userId: "user-1",
  deviceId: "device-1",
  args: {
    device_id: "device-1",
    action: "read",
    path: "D:\\workspace\\README.md",
    consent_accepted: true,
  },
};
const first = buildLocalGatewayApprovalBinding(base);
const reordered = buildLocalGatewayApprovalBinding({
  ...base,
  args: {
    path: "D:\\workspace\\README.md",
    action: "read",
    device_id: "device-1",
    approval_hold_id: "hold-added-on-second-call",
    consent_accepted: true,
  },
});
assert.deepEqual(reordered, first, "volatile approval fields and object key order must not change the binding");
assert.equal(first.secrets_included, false);
assert.equal(JSON.stringify(first).includes("README.md"), false, "raw request arguments must not appear in the approval binding");
assert.equal(validateLocalGatewayApprovalBinding(first, reordered).ok, true);

const differentTool = buildLocalGatewayApprovalBinding({ ...base, toolKey: "local.connector.shell" });
assert.equal(validateLocalGatewayApprovalBinding(first, differentTool).code, "approval_hold_binding_mismatch");
const differentDevice = buildLocalGatewayApprovalBinding({ ...base, deviceId: "device-2" });
assert.equal(validateLocalGatewayApprovalBinding(first, differentDevice).code, "approval_hold_binding_mismatch");
const differentAction = buildLocalGatewayApprovalBinding({ ...base, args: { ...base.args, action: "write", content: "changed" } });
assert.equal(validateLocalGatewayApprovalBinding(first, differentAction).code, "approval_hold_request_digest_mismatch");
assert.equal(validateLocalGatewayApprovalBinding(null, first).code, "approval_hold_binding_missing");

const routeSource = readFileSync("routes/localGatewayToolsRoutes.js", "utf8");
for (const token of [
  "buildLocalGatewayApprovalBinding",
  "validateLocalGatewayApprovalBinding",
  "localGatewayConsentStatus",
  "approval_binding",
  "approvalDecision?.code",
]) {
  assert(routeSource.includes(token), `local gateway route must enforce ${token}`);
}

console.log("local gateway bounded approval policy tests passed");
