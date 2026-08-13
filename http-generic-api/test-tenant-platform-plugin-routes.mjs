import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _testingTenantPlatformPluginRoutes } from "./routes/tenantPlatformPluginRoutes.js";
import { createCredentialIntakeSessionRecord } from "./routes/credentialIntakeRoutes.js";
import { buildTenantPlatformPluginEligibility } from "./tenantPlatformPluginEligibility.js";

{
  assert.equal(_testingTenantPlatformPluginRoutes.boundedInt("20", 10, 1, 100), 20);
  assert.equal(_testingTenantPlatformPluginRoutes.boundedInt("999", 10, 1, 100), 100);
  assert.equal(_testingTenantPlatformPluginRoutes.bool("true"), true);
  assert.equal(_testingTenantPlatformPluginRoutes.bool("0"), false);
}

{
  const contract = _testingTenantPlatformPluginRoutes.parseTenantPlatformPluginResolveContract({
    plugin_key: "github",
    toolKey: "github.repo.read",
    workspace_id: "workspace-1",
  });
  assert.equal(contract.pluginKey, "github");
  assert.equal(contract.workspaceId, "workspace-1");
  assert.equal(contract.selector.toolKey, "github.repo.read");
  assert.equal(contract.compatibilityTelemetry.legacy_selector_alias_used, true);
  assert.deepEqual(contract.compatibilityTelemetry.legacy_fields, ["toolKey"]);
  assert.equal(contract.compatibilityTelemetry.contract_version, "one-selector-workspace-v2");
}

{
  const contract = _testingTenantPlatformPluginRoutes.parseTenantPlatformPluginResolveContract({
    plugin_key: "github",
    action_key: "github.repo.read",
    workspaceId: "workspace-legacy",
  });
  assert.equal(contract.workspaceId, "workspace-legacy");
  assert.deepEqual(contract.compatibilityTelemetry.legacy_fields, ["workspaceId"]);
}

{
  assert.throws(
    () => _testingTenantPlatformPluginRoutes.parseTenantPlatformPluginResolveContract({
      plugin_key: "github",
      action_key: "github.repo.read",
      tool_key: "github.repo.read",
      workspace_id: "workspace-1",
    }),
    (err) => err?.code === "AMBIGUOUS_CAPABILITY_SELECTOR" && err?.status === 400,
  );
  assert.throws(
    () => _testingTenantPlatformPluginRoutes.parseTenantPlatformPluginResolveContract({
      plugin_key: "github",
      tenant_id: "tenant-override",
      action_key: "github.repo.read",
      workspace_id: "workspace-1",
    }),
    (err) => err?.code === "UNKNOWN_SECURITY_CONTRACT_FIELD" && err?.details?.fields?.includes("tenant_id"),
  );
  assert.throws(
    () => _testingTenantPlatformPluginRoutes.parseTenantPlatformPluginResolveContract({
      plugin_key: "github",
      action_key: "github.repo.read",
    }),
    (err) => err?.code === "TENANT_WORKSPACE_CONTEXT_REQUIRED"
      && err?.status === 400
      && err?.details?.required_field === "workspace_id",
  );
}

{
  const calls = [];
  const pool = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM `app_integrations`")) {
        return [[{
          app_key: "github",
          display_name: "GitHub",
          auth_type: "api_key",
          category: "development",
          status: "active",
        }]];
      }
      if (sql.includes("UPDATE credential_intake_sessions") && sql.includes("superseded_by_new_session")) {
        return [{ affectedRows: 2 }];
      }
      if (sql.includes("INSERT INTO credential_intake_sessions")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  const result = await createCredentialIntakeSessionRecord({
    pool,
    userId: "user-1",
    tenantId: "tenant-1",
    appKey: "github",
    authType: "api_key",
    metadata: { source: "tenant_safe_credential_intake", purpose: "connect repository" },
    expiresInMinutes: 30,
    createdBy: "user-1",
  });
  assert.equal(result.ok, true);
  assert.equal(result.app_key, "github");
  assert.equal(result.auth_type, "api_key");
  assert.equal(result.secrets_included, false);
  assert.match(result.intake_url, /^\/credential-intake\//);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO credential_intake_sessions"));
  assert(insert, "credential intake session must be persisted");
  assert.equal(insert.params[2], "user-1");
  assert.equal(insert.params[3], "tenant-1");
  assert.equal(insert.params[4], "github");
  assert.equal(insert.params[11], "app:github");
  assert.equal(insert.params[12], "connect repository");
  assert.match(insert.params[14], /^[a-f0-9]{64}$/);
  assert.equal(insert.params[15], null);
  assert.equal(JSON.parse(insert.params[18]).source, "tenant_safe_credential_intake");
  assert.equal(result.binding_context.connection_target_ref, "app:github");
  assert.equal(result.binding_context.purpose, "connect repository");
  assert.equal(result.page_preflight.ok, true);
  assert.equal(result.page_preflight.rendered, true);
  assert.equal(result.page_preflight.superseded_pending_sessions, 2);
  assert.equal(result.page_preflight.automatic_retry_after_render_failure, false);
}

{
  const pool = {
    async query(sql) {
      if (sql.includes("FROM `app_integrations`")) {
        return [[{ app_key: "disabled_app", auth_type: "api_key", status: "disabled" }]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
  await assert.rejects(
    () => createCredentialIntakeSessionRecord({
      pool,
      userId: "user-1",
      tenantId: "tenant-1",
      appKey: "disabled_app",
      authType: "api_key",
    }),
    (err) => err?.code === "app_not_active" && err?.status === 409,
  );
}

{
  const ready = buildTenantPlatformPluginEligibility({
    plugin: { status: "active" },
    allowed: true,
    approval: { approval_required: false },
    execution: { will_execute: true },
    security_decision: { gates: [{ key: "binding_state", required: true, state: "pass", reason: "binding_active" }] },
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.dispatch_ready, true);
  assert.equal(ready.blocker_count, 0);
  assert.equal(ready.secrets_included, false);

  const missingBinding = buildTenantPlatformPluginEligibility({
    plugin: { status: "active" },
    allowed: false,
    execution: { will_execute: false },
    security_decision: { gates: [{ key: "binding_state", required: true, state: "deny", reason: "action_binding_not_found" }] },
  });
  assert.equal(missingBinding.status, "blocked");
  assert.equal(missingBinding.blockers[0].blocker_code, "missing_action_binding");
  assert.equal(missingBinding.blockers[0].repair_class, "platform_admin_required");
  assert.equal(missingBinding.blockers[0].safe_action, "register_runtime_binding");

  const missingCertification = buildTenantPlatformPluginEligibility({
    plugin: { status: "active" },
    allowed: false,
    execution: { will_execute: false },
    security_decision: { gates: [{ key: "smoke_certification", required: true, state: "deny", reason: "smoke_certification_required" }] },
  });
  assert.equal(missingCertification.status, "blocked");
  assert.equal(missingCertification.blockers[0].blocker_code, "missing_smoke_certification");
  assert.equal(missingCertification.blockers[0].repair_class, "platform_admin_required");
  assert.equal(missingCertification.blockers[0].safe_action, "certify_platform_plugin_operation");

  const credentialRequired = buildTenantPlatformPluginEligibility({
    plugin: { status: "active" },
    allowed: false,
    execution: { will_execute: false },
    security_decision: { gates: [{ key: "credential", required: true, state: "deny", reason: "credential_required" }] },
  });
  assert.equal(credentialRequired.blockers[0].repair_class, "user_action_required");
  assert.equal(credentialRequired.blockers[0].safe_action, "credential_intake_or_oauth");

  const ambiguity = buildTenantPlatformPluginEligibility({
    plugin: { status: "active" },
    allowed: false,
    execution: { will_execute: false },
    security_decision: { gates: [{ key: "credential", required: true, state: "deny", reason: "connection_selection_ambiguous" }] },
  });
  assert.equal(ambiguity.blockers[0].repair_class, "tenant_admin_action_available");
  assert.equal(ambiguity.blockers[0].safe_action, "resolve_connection_binding_ambiguity");

  const approval = buildTenantPlatformPluginEligibility({
    plugin: { status: "active" },
    allowed: true,
    approval: { approval_required: true },
    execution: { will_execute: false },
    security_decision: { gates: [{ key: "approval", required: true, state: "deny", reason: "action_grant_required" }] },
  });
  assert.equal(approval.status, "approval_required");
  assert.equal(approval.blockers[0].repair_class, "platform_admin_required");

  const unavailable = buildTenantPlatformPluginEligibility({
    plugin: { status: "disabled" },
    execution: { will_execute: false },
    security_decision: { gates: [] },
  });
  assert.equal(unavailable.status, "unavailable");

  const deprecated = buildTenantPlatformPluginEligibility({
    plugin: { status: "deprecated" },
    execution: { will_execute: false },
    security_decision: { gates: [] },
  });
  assert.equal(deprecated.status, "deprecated");
}

{
  const routes = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "routes/tenantPlatformPluginRoutes.js"), "utf8");
  assert(routes.includes("/tenant/platform/plugins/catalog"), "tenant catalog route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/install"), "tenant install route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/resolve"), "tenant resolve route must be mounted");
  assert(routes.includes("/tenant/platform/plugins/credential-intake-sessions"), "tenant-safe credential intake route must be mounted");
  assert(routes.includes("tenant_connection_admin_required"), "tenant intake must require owner/admin role");
  assert(routes.includes("tenant_intake_field_not_allowed"), "tenant intake must reject non-allowlisted fields");
  assert(routes.includes("tenant_integration_policies"), "tenant intake must require active tenant plugin policy");
  assert(routes.includes("createCredentialIntakeSessionRecord"), "tenant intake must use shared governed session helper");
  assert(routes.includes("admin_tool_invoked: false"), "tenant intake must not claim raw admin tool dispatch");
  assert(routes.includes("requireTenantUserJwt"), "tenant routes must require user JWT");
  assert(routes.includes("TENANT_WORKSPACE_CONTEXT_REQUIRED"), "tenant resolver must require explicit workspace context");
  assert(routes.includes("workspaceId: contract.workspaceId"), "tenant resolver must pass the validated workspace contract");
  assert(routes.includes("tenantId: req.auth.tenant_id"), "tenant install/resolve must derive tenant_id from auth");
  assert(routes.includes("userId: req.auth.user_id"), "tenant install/resolve must derive user_id from auth");
  assert(routes.includes("security_decision_trace_admin: _adminTrace"), "tenant resolve must strip admin decision trace projection");
  assert(routes.includes("buildTenantPlatformPluginEligibility(result)"), "tenant resolve must derive normalized eligibility from the canonical resolver result");
  assert(routes.includes("eligibility,"), "tenant resolve response must expose normalized eligibility");
  assert(!routes.includes("tenantId: input.tenant_id"), "tenant install must not trust body tenant_id");
  assert(!routes.includes("userId: input.user_id"), "tenant install must not trust body user_id");
}

{
  const index = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "routes/index.js"), "utf8");
  assert(index.includes("buildTenantPlatformPluginRoutes"), "tenant Platform Plugin routes must be imported and mounted");
  const tenantMount = index.indexOf("app.use(buildTenantPlatformPluginRoutes())");
  const adminMount = index.indexOf("app.use(buildPlatformPluginRoutes");
  assert(tenantMount !== -1, "tenant Platform Plugin routes must be mounted");
  assert(adminMount !== -1, "admin Platform Plugin routes must be mounted");
  assert(tenantMount < adminMount, "tenant routes should mount before admin platform plugin routes");
}

console.log("tenant platform plugin route tests passed");
