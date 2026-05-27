import { Router } from "express";
import { loadPlatformPluginCatalog } from "../platformPluginCatalog.js";
import { resolvePlatformPluginExecution } from "../platformPluginResolver.js";
import { upsertPlatformPluginPolicy } from "../platformPluginPolicy.js";
import { upsertPlatformPluginActionGrant } from "../platformPluginActionGrant.js";
import { upsertPlatformPluginActionTemplate } from "../platformPluginActionTemplate.js";
import { installPlatformPluginForTenant } from "../platformPluginInstall.js";
import {
  activatePrivatePlatformPluginContribution,
  createPlatformPluginContribution,
  getPlatformPluginContribution,
  listPlatformPluginContributions,
  resolvePrivatePlatformPluginContribution,
} from "../platformPluginContribution.js";
import { dispatchPrivatePlatformPluginRestAction } from "../platformPluginPrivateRestDispatch.js";
import { dispatchPlatformPluginRestAction } from "../platformPluginRestDispatch.js";
import { resolveActionManifestDiagnostic } from "../actionManifestDiagnostic.js";
import { resolveExecutionReadinessDryRun } from "../executionReadinessDryRun.js";
import {
  listRemoteRuntimeTargets,
  probeRemoteRuntimeTarget,
  upsertRemoteRuntimeTarget,
  validateRemoteRuntimeTarget,
  planRemoteRuntimeDispatchDryRun,
} from "../remoteRuntime.js";
import {
  certifyPlatformPluginContribution,
  promotePlatformPluginContribution,
} from "../platformPluginPromotion.js";

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function errorResponse(res, err, fallbackCode) {
  return res.status(err.status || 500).json({
    ok: false,
    error: { code: err.code || fallbackCode, message: err.message, details: err.details || null },
    secrets_included: false,
  });
}

export function buildPlatformPluginRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/platform/plugins/catalog", ...requireAdmin, async (req, res) => {
    try {
      const result = await loadPlatformPluginCatalog({
        tenantId: req.query.tenant_id || null,
        userId: req.query.user_id || null,
        includeInactive: bool(req.query.include_inactive),
        includeBindings: req.query.include_bindings === undefined ? true : bool(req.query.include_bindings),
        limit: boundedInt(req.query.limit, 100, 1, 250),
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_catalog_failed"); }
  });

  router.post("/platform/plugins/resolve", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolvePlatformPluginExecution({
        pluginKey: input.plugin_key || input.pluginKey,
        actionKey: input.action_key || input.actionKey || null,
        toolKey: input.tool_key || input.toolKey || null,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        agentId: input.agent_id || input.agentId || null,
        requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_resolve_failed"); }
  });

  router.post("/platform/action-manifest/resolve", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolveActionManifestDiagnostic(input);
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "action_manifest_resolve_failed"); }
  });

  router.post("/platform/execution-readiness/dry-run", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolveExecutionReadinessDryRun(input);
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "execution_readiness_dry_run_failed"); }
  });

  router.post("/platform/remote-runtime/targets/upsert", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await upsertRemoteRuntimeTarget({
        targetId: input.target_id || input.targetId || null,
        tenantId: input.tenant_id || input.tenantId,
        userId: input.user_id || input.userId || null,
        targetKind: input.target_kind || input.targetKind,
        providerFamily: input.provider_family || input.providerFamily || null,
        connectorFamily: input.connector_family || input.connectorFamily || null,
        systemId: input.system_id || input.systemId || null,
        connectionId: input.connection_id || input.connectionId || null,
        localPathId: input.local_path_id || input.localPathId || null,
        hostLabel: input.host_label || input.hostLabel || null,
        rootPath: input.root_path || input.rootPath || null,
        pathAllowlist: input.path_allowlist || input.pathAllowlist || null,
        commandAllowlist: input.command_allowlist || input.commandAllowlist || null,
        metadata: input.metadata || {},
        status: input.status || null,
        validationStatus: input.validation_status || input.validationStatus || null,
        updatedBy: input.updated_by || input.updatedBy || input.user_id || input.userId || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "remote_runtime_target_upsert_failed"); }
  });

  router.post("/platform/remote-runtime/targets/validate", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await validateRemoteRuntimeTarget({
        targetId: input.target_id || input.targetId,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        updatedBy: input.updated_by || input.updatedBy || input.user_id || input.userId || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "remote_runtime_target_validate_failed"); }
  });

  router.post("/platform/remote-runtime/dispatch-dry-run", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await planRemoteRuntimeDispatchDryRun({
        targetId: input.target_id || input.targetId,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        commandKey: input.command_key || input.commandKey || "status",
        inputs: input.inputs || {},
        approvalId: input.approval_id || input.approvalId || null,
        approvalReason: input.approval_reason || input.approvalReason || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "remote_runtime_dispatch_dry_run_failed"); }
  });

  router.post("/platform/remote-runtime/targets/catalog", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await listRemoteRuntimeTargets({
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        targetKind: input.target_kind || input.targetKind || null,
        providerFamily: input.provider_family || input.providerFamily || null,
        status: input.status || null,
        includeCommands: input.include_commands === undefined ? input.includeCommands !== false : input.include_commands !== false,
        limit: input.limit || 100,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "remote_runtime_catalog_failed"); }
  });

  router.post("/platform/remote-runtime/probe", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await probeRemoteRuntimeTarget({
        targetId: input.target_id || input.targetId,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        commandKey: input.command_key || input.commandKey || "status",
        dryRun: input.dry_run === undefined ? input.dryRun !== false : input.dry_run !== false,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "remote_runtime_probe_failed"); }
  });

  router.post("/platform/plugins/install-policy", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await upsertPlatformPluginPolicy({
        tenantId: input.tenant_id || input.tenantId,
        pluginKey: input.plugin_key || input.pluginKey,
        sourceMode: input.source_mode || input.sourceMode || input.mode || "managed",
        fallbackAllowed: input.fallback_allowed ?? input.fallbackAllowed ?? false,
        requiredForDeviceInstall: input.required_for_device_install ?? input.requiredForDeviceInstall ?? false,
        notes: input.notes || "",
        userId: input.user_id || input.userId || null,
        source: "platform_plugin_policy_upsert",
        rawPayload: input,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_policy_upsert_failed"); }
  });

  router.post("/platform/plugins/action-templates", ...requireAdmin, async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const input = body.tool_args && typeof body.tool_args === "object"
        ? body.tool_args
        : (body.arguments && typeof body.arguments === "object" ? body.arguments : body);
      const result = await upsertPlatformPluginActionTemplate({
        contributionId: input.contribution_id || input.contributionId || null,
        pluginKey: input.plugin_key || input.pluginKey || null,
        actionKey: input.action_key || input.actionKey,
        method: input.method || input.http_method || input.httpMethod,
        path: input.path || input.http_path || input.httpPath,
        headers: input.headers || {},
        bodyTemplate: input.body_template || input.bodyTemplate || null,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        updatedBy: input.updated_by || input.updatedBy || input.user_id || input.userId || null,
        rawPayload: input,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_action_template_upsert_failed"); }
  });

  router.post("/platform/plugins/dispatch-rest", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await dispatchPlatformPluginRestAction({
        pluginKey: input.plugin_key || input.pluginKey,
        actionKey: input.action_key || input.actionKey,
        tenantId: input.tenant_id || input.tenantId,
        userId: input.user_id || input.userId,
        agentId: input.agent_id || input.agentId || null,
        requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || "tenant_connection",
        input: input.input || {},
        dryRun: input.dry_run === true || input.dryRun === true,
        timeoutMs: input.timeout_ms || input.timeoutMs || 10000,
        enforceExecutionReadiness: input.enforce_execution_readiness === undefined
          ? input.enforceExecutionReadiness !== false
          : input.enforce_execution_readiness !== false,
        brandKey: input.brand_key || input.brandKey || input.target_key || input.targetKey || null,
        businessTypeKey: input.business_type_key || input.businessTypeKey || null,
        businessActivityTypeKey: input.business_activity_type_key || input.businessActivityTypeKey || input.activity_key || input.activityKey || null,
        workflowKey: input.workflow_key || input.workflowKey || null,
        logicKey: input.logic_key || input.logicKey || null,
        logicPackKey: input.logic_pack_key || input.logicPackKey || null,
        skillKey: input.skill_key || input.skillKey || null,
        actorRole: input.actor_role || input.actorRole || null,
        governanceLevel: input.governance_level || input.governanceLevel || null,
        graphDepth: input.graph_depth || input.graphDepth || 1,
        graphLimit: input.graph_limit || input.graphLimit || 120,
        detailLimit: input.detail_limit || input.detailLimit || 10,
        edgeDetailLimit: input.edge_detail_limit || input.edgeDetailLimit || 10,
        providerSmoke: input.provider_smoke === true || input.providerSmoke === true,
        providerSmokeExpectedOrigin: input.provider_smoke_expected_origin || input.providerSmokeExpectedOrigin || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_rest_dispatch_failed"); }
  });

  router.post("/platform/plugins/action-grants", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await upsertPlatformPluginActionGrant({
        connectionId: input.connection_id || input.connectionId,
        pluginKey: input.plugin_key || input.pluginKey,
        actionKey: input.action_key || input.actionKey,
        agentId: input.agent_id || input.agentId || null,
        workspaceId: input.workspace_id || input.workspaceId || null,
        grantMode: input.grant_mode || input.grantMode || "explicit",
        grantedBy: input.granted_by || input.grantedBy || input.user_id || input.userId || null,
        expiresAt: input.expires_at || input.expiresAt || null,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        rawPayload: input,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_action_grant_upsert_failed"); }
  });

  router.post("/platform/plugins/install", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await installPlatformPluginForTenant({
        tenantId: input.tenant_id || input.tenantId,
        userId: input.user_id || input.userId || null,
        pluginKey: input.plugin_key || input.pluginKey,
        sourceMode: input.source_mode || input.sourceMode || "dedicated",
        fallbackAllowed: input.fallback_allowed ?? input.fallbackAllowed ?? false,
        requiredForDeviceInstall: input.required_for_device_install ?? input.requiredForDeviceInstall ?? false,
        notes: input.notes || "",
        connection: input.connection || null,
        rawPayload: input,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_install_failed"); }
  });

  router.post("/platform/plugins/contributions", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await createPlatformPluginContribution({
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        ownerScope: input.owner_scope || input.ownerScope || "tenant",
        target: input.target || null,
        pluginKey: input.plugin_key || input.pluginKey,
        displayName: input.display_name || input.displayName,
        pluginType: input.plugin_type || input.pluginType || "rest_api",
        basePluginKey: input.base_plugin_key || input.basePluginKey || null,
        manifest: input.manifest || {},
        protocolBindings: input.protocol_bindings || input.protocolBindings || [],
        actionBindings: input.action_bindings || input.actionBindings || [],
        credentialPolicy: input.credential_policy || input.credentialPolicy || {},
        notes: input.notes || "",
        submit: input.submit === true,
        rawPayload: input,
      });
      return res.status(result.ok ? 201 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_create_failed"); }
  });

  router.post("/platform/plugins/contributions/certify", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await certifyPlatformPluginContribution({
        contributionId: input.contribution_id || input.contributionId,
        adminUserId: input.admin_user_id || input.adminUserId || input.user_id || input.userId || null,
        notes: input.notes || "",
      });
      return res.status(result.ok ? 200 : 422).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_certify_failed"); }
  });

  router.post("/platform/plugins/contributions/promote", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await promotePlatformPluginContribution({
        contributionId: input.contribution_id || input.contributionId,
        adminUserId: input.admin_user_id || input.adminUserId || input.user_id || input.userId || null,
        status: input.status || "beta",
        notes: input.notes || "",
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_promote_failed"); }
  });

  router.post("/platform/plugins/contributions/activate-private", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await activatePrivatePlatformPluginContribution({
        contributionId: input.contribution_id || input.contributionId,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        notes: input.notes || "",
      });
      return res.status(result.ok ? 200 : 409).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_private_activate_failed"); }
  });

  router.post("/platform/plugins/contributions/resolve-private", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await resolvePrivatePlatformPluginContribution({
        contributionId: input.contribution_id || input.contributionId || null,
        pluginKey: input.plugin_key || input.pluginKey || null,
        actionKey: input.action_key || input.actionKey || null,
        tenantId: input.tenant_id || input.tenantId || null,
        userId: input.user_id || input.userId || null,
        requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || null,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_private_resolve_failed"); }
  });

  router.post("/platform/plugins/contributions/dispatch-rest", ...requireAdmin, async (req, res) => {
    try {
      const input = req.body && typeof req.body === "object" ? req.body : {};
      const result = await dispatchPrivatePlatformPluginRestAction({
        contributionId: input.contribution_id || input.contributionId,
        actionKey: input.action_key || input.actionKey,
        tenantId: input.tenant_id || input.tenantId,
        userId: input.user_id || input.userId,
        requestedCredentialScope: input.requested_credential_scope || input.requestedCredentialScope || "tenant_connection",
        input: input.input || {},
        dryRun: input.dry_run === true || input.dryRun === true,
        timeoutMs: input.timeout_ms || input.timeoutMs || 10000,
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_private_rest_dispatch_failed"); }
  });

  router.get("/platform/plugins/contributions", ...requireAdmin, async (req, res) => {
    try {
      const result = await listPlatformPluginContributions({
        tenantId: req.query.tenant_id || null,
        userId: req.query.user_id || null,
        status: req.query.status || null,
        limit: boundedInt(req.query.limit, 50, 1, 200),
      });
      return res.status(200).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_list_failed"); }
  });

  router.get("/platform/plugins/contributions/:contribution_id", ...requireAdmin, async (req, res) => {
    try {
      const result = await getPlatformPluginContribution({ contributionId: req.params.contribution_id });
      return res.status(result.ok ? 200 : 404).json(result);
    } catch (err) { return errorResponse(res, err, "platform_plugin_contribution_get_failed"); }
  });

  return router;
}
