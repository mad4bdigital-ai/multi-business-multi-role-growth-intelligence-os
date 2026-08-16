import assert from "node:assert/strict";
import {
  assertActAsUserExecutionContext,
  resolveActAsUserExecutionContext,
} from "./actAsUserExecutionPolicy.js";

const now = new Date("2026-08-16T12:00:00.000Z");
const base = {
  actor: { id: "owner-1", tenantId: "tenant-1", role: "owner", capabilities: ["call_tool", "execute", "workspace.read"] },
  target: { id: "member-1", tenantId: "tenant-1", role: "member", capabilities: ["call_tool", "workspace.read"] },
  tenantId: "tenant-1",
  delegation: {
    id: "delegation-1",
    actorPrincipalRef: "owner-1",
    subjectRef: "member-1",
    tenantRef: "tenant-1",
    status: "active",
    allowedOperations: ["call_tool"],
    idempotencyKey: "act-as-user-0001",
    validFrom: "2026-08-16T11:59:00.000Z",
    expiresAt: "2026-08-16T12:10:00.000Z",
  },
  requestedOperation: "call_tool",
  requestedTool: "tenant.read",
  requestedCapabilities: ["call_tool"],
  toolCapabilities: ["call_tool"],
  tenantCapabilities: ["call_tool", "workspace.read"],
  now,
};

const context = resolveActAsUserExecutionContext(base);
assert.equal(context.actorId, "owner-1");
assert.equal(context.targetId, "member-1");
assert.deepEqual(context.effectiveCapabilities, ["call_tool"]);
assert.doesNotThrow(() => assertActAsUserExecutionContext(context, { now }));
assert.throws(() => resolveActAsUserExecutionContext({ ...base, target: { ...base.target, role: "owner" } }), (error) => error.code === "act_as_user_role_escalation_denied");
assert.throws(() => resolveActAsUserExecutionContext({ ...base, target: { ...base.target, tenantId: "tenant-2" } }), (error) => error.code === "act_as_user_cross_tenant_denied");
assert.throws(() => resolveActAsUserExecutionContext({ ...base, requestedOperation: "execute", requestedCapabilities: ["execute"], toolCapabilities: ["execute"] }), (error) => error.code === "act_as_user_capability_intersection_denied");
assert.throws(() => resolveActAsUserExecutionContext({ ...base, delegation: { ...base.delegation, idempotencyKey: "" } }), (error) => error.code === "act_as_user_idempotency_required");
assert.throws(() => resolveActAsUserExecutionContext({ ...base, delegation: { ...base.delegation, revoked: true } }), (error) => error.code === "act_as_user_revoked");
assert.throws(() => resolveActAsUserExecutionContext({ ...base, delegation: { ...base.delegation, expiresAt: "2026-08-16T12:20:00.000Z" } }), (error) => error.code === "act_as_user_ttl_exceeded");
assert.throws(() => resolveActAsUserExecutionContext({ ...base, delegation: { ...base.delegation, allowedOperations: ["call_tool", "*"] } }), (error) => error.code === "act_as_user_wildcard_scope_denied");
assert.throws(() => assertActAsUserExecutionContext(context, { now: new Date("2026-08-16T12:11:00.000Z") }), (error) => error.code === "act_as_user_expired");
console.log("act-as-user execution policy tests passed");
