import assert from "node:assert/strict";
import {
  PlatformPluginSecurityAlertCode,
  classifyPlatformPluginSecurityAlerts,
  schedulePlatformPluginSecurityAlerts,
} from "./platformPluginSecurityAlerts.js";

const tenantToAdmin = classifyPlatformPluginSecurityAlerts({
  principalClass: "tenant",
  toolKey: "credential_effective_status",
  surfaceExposure: {
    reason: "admin_tool_forbidden",
    tool_surface: "admin_platform_tool",
    exposure_scope: "admin",
  },
  canonicalPolicy: { reason: "tool_canonical_policy_mapping_required" },
  actionBindings: [{ action_key: "github.repo.read", status: "active" }],
});
assert.deepEqual(tenantToAdmin.map((alert) => alert.code), [
  PlatformPluginSecurityAlertCode.TENANT_TO_ADMIN_CAPABILITY_REQUEST,
]);
assert.equal(tenantToAdmin[0].severity, "high");

const parityMismatch = classifyPlatformPluginSecurityAlerts({
  principalClass: "tenant",
  toolKey: "github.repo.read",
  surfaceExposure: { reason: "surface_exposed", tool_surface: "virtual_tool", exposure_scope: "tenant" },
  canonicalPolicy: { reason: "tool_canonical_policy_mapping_required" },
  actionBindings: [{ action_key: "github.repo.read", status: "active" }],
});
assert.deepEqual(parityMismatch.map((alert) => alert.code), [
  PlatformPluginSecurityAlertCode.SELECTOR_PARITY_MISMATCH,
]);

const both = classifyPlatformPluginSecurityAlerts({
  principalClass: "tenant",
  toolKey: "github.repo.read",
  surfaceExposure: { reason: "admin_tool_forbidden", tool_surface: "platform_admin_tool", exposure_scope: "admin" },
  canonicalPolicy: { reason: "tool_canonical_policy_mapping_required" },
  actionBindings: [{ action_key: "github.repo.read", status: "active" }],
});
assert.deepEqual(both.map((alert) => alert.code).sort(), [
  PlatformPluginSecurityAlertCode.SELECTOR_PARITY_MISMATCH,
  PlatformPluginSecurityAlertCode.TENANT_TO_ADMIN_CAPABILITY_REQUEST,
].sort());

const nonParityTool = classifyPlatformPluginSecurityAlerts({
  principalClass: "tenant",
  toolKey: "tool.only.alias",
  surfaceExposure: { reason: "surface_exposed", tool_surface: "virtual_tool", exposure_scope: "tenant" },
  canonicalPolicy: { reason: "tool_canonical_policy_mapping_required" },
  actionBindings: [{ action_key: "github.repo.read", status: "active" }],
});
assert.deepEqual(nonParityTool, []);

const writes = [];
const projection = schedulePlatformPluginSecurityAlerts({
  writer: (event) => writes.push(event),
  principalClass: "tenant",
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  userId: "user-1",
  requestId: "r".repeat(200),
  correlationId: "c".repeat(200),
  pluginKey: "github",
  toolKey: "github.repo.read",
  surfaceExposure: { reason: "admin_tool_forbidden", tool_surface: "admin_platform_tool", exposure_scope: "admin" },
  canonicalPolicy: { reason: "tool_canonical_policy_mapping_required" },
  actionBindings: [{ action_key: "github.repo.read", status: "active" }],
});
assert.equal(projection.scheduled_count, 2);
assert.equal(projection.severity, "high");
assert.equal(projection.secrets_included, false);
assert.equal(writes.length, 2);
for (const event of writes) {
  assert.equal(event.tenant_id, "tenant-1");
  assert.equal(event.request_id, "r".repeat(128));
  assert.equal(event.correlation_id, "c".repeat(128));
  assert.equal(event.actor_type, "user");
  assert.equal(event.outcome, "blocked");
  assert.equal(event.service_mode, "security_containment");
  assert.equal(event.metadata.severity, "high");
  assert.equal(event.metadata.temporary_control, true);
  assert.equal(event.metadata.containment_task, "T008");
  assert.equal(event.metadata.dispatch_blocked, true);
  assert.equal(event.metadata.secrets_included, false);
  assert(!JSON.stringify(event).toLowerCase().includes("token"));
  assert(!JSON.stringify(event).toLowerCase().includes("secret_payload"));
}

assert.doesNotThrow(() => schedulePlatformPluginSecurityAlerts({
  writer: () => { throw new Error("audit unavailable"); },
  principalClass: "tenant",
  tenantId: "tenant-1",
  userId: "user-1",
  pluginKey: "github",
  toolKey: "credential_effective_status",
  surfaceExposure: { reason: "admin_tool_forbidden" },
  canonicalPolicy: { reason: "tool_canonical_policy_mapping_required" },
  actionBindings: [],
}));

const tenantRouteSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./routes/tenantPlatformPluginRoutes.js", import.meta.url), "utf8"));
assert(tenantRouteSource.includes('requestId: req.headers["x-request-id"] || null'));
assert(tenantRouteSource.includes('correlationId: req.headers["x-correlation-id"] || req.headers["x-request-id"] || null'));

console.log("platform plugin security alert tests passed");