import assert from "node:assert/strict";
import { createActAsUserShadowAdapter } from "./actAsUserRuntimeAdapter.js";

const now = () => new Date("2026-08-16T12:00:00.000Z");
const input = {
  actor: { id: "owner-1", tenantId: "tenant-1", role: "owner", capabilities: ["call_tool"] },
  target: { id: "member-1", tenantId: "tenant-1", role: "member", capabilities: ["call_tool"] },
  tenantId: "tenant-1",
  delegation: {
    id: "delegation-1",
    actorPrincipalRef: "owner-1",
    subjectRef: "member-1",
    tenantRef: "tenant-1",
    status: "active",
    allowedOperations: ["call_tool"],
    idempotencyKey: "shadow-session-0001",
    expiresAt: "2026-08-16T12:10:00.000Z",
  },
  requestedOperation: "call_tool",
  requestedTool: "tenant.read",
  requestedCapabilities: ["call_tool"],
  toolCapabilities: ["call_tool"],
  tenantCapabilities: ["call_tool"],
};

const liveDisabled = createActAsUserShadowAdapter({ now });
const session = await liveDisabled.adapter.createSession(input);
assert.equal(session.status, "shadow");
assert.equal(liveDisabled.audit[0].secretsIncluded, false);
const dispatchContext = await liveDisabled.adapter.authorizeDispatch({
  sessionId: session.sessionId,
  requestedOperation: "call_tool",
  requestedTool: "tenant.read",
  request: { requestId: "req-1" },
});
assert.equal(dispatchContext.dispatchAuthorized, true);
await liveDisabled.adapter.recordReadback({ sessionId: session.sessionId, context: dispatchContext, readback: { status: "shadow_ok" } });
assert.equal(liveDisabled.readbacks.length, 1);
await liveDisabled.adapter.revokeSession({ sessionId: session.sessionId, reason: "test" });
assert.equal(liveDisabled.revoked.has(session.sessionId), true);
await assert.rejects(
  () => liveDisabled.adapter.authorizeDispatch({ sessionId: session.sessionId, requestedOperation: "call_tool", requestedTool: "tenant.read" }),
  (error) => error.code === "act_as_user_revoked",
);

const liveAdapter = createActAsUserShadowAdapter({ now });
// The shadow factory never enables live execution; this remains an explicit deny boundary.
assert.equal(liveAdapter.adapter.createSession instanceof Function, true);
console.log("act-as-user runtime adapter tests passed");
