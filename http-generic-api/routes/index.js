import { buildHealthRoutes } from "./healthRoutes.js";
import { buildStatusRoutes } from "./statusRoutes.js";
import { buildActivationRoutes } from "./activationRoutes.js";
import { buildMcpRoutes } from "./mcpRoutes.js";
import { buildGovernanceRoutes } from "./governanceRoutes.js";
import { buildJobRoutes } from "./jobRoutes.js";
import { buildExecuteRoutes } from "./executeRoutes.js";
import { buildGithubRoutes } from "./githubRoutes.js";
import { buildAiResolverRoutes } from "./aiResolverRoutes.js";
import { buildAgentIntelligenceRoutes } from "./agentIntelligenceRoutes.js";
import { buildTenantsRoutes } from "./tenantsRoutes.js";
import { buildIdentityRoutes } from "./identityRoutes.js";
import { buildAccessRoutes } from "./accessRoutes.js";
import { buildCustomerRoutes } from "./customerRoutes.js";
import { buildConnectedSystemsRoutes } from "./connectedSystemsRoutes.js";
import { buildPlannerRoutes } from "./plannerRoutes.js";
import { buildBootstrapRoutes } from "./bootstrapRoutes.js";
import { buildLogicRoutes } from "./logicRoutes.js";
import { buildWorkflowOrchestrationRoutes } from "./workflowOrchestrationRoutes.js";
import { buildN8nWorkflowRuntimeRoutes } from "./n8nWorkflowRuntimeRoutes.js";
import { buildObservabilityRoutes } from "./observabilityRoutes.js";
import { buildSecurityRoutes } from "./securityRoutes.js";
import { buildDeveloperApiRoutes } from "./developerApiRoutes.js";
import { buildReleaseRoutes } from "./releaseRoutes.js";
import { buildConnectorRoutes } from "./connectorRoutes.js";
import { buildBatchRoutes } from "./batchRoutes.js";
import { buildLegalRoutes } from "./legalRoutes.js";
import { buildAuthRoutes } from "./authRoutes.js";
import { buildAdminCliRoutes, buildAdminControlHandler, buildSessionContinuityHandler, requireAdminPrincipal } from "./adminCliRoutes.js";
import { buildAgentRegistryRoutes } from "./agentRegistryRoutes.js";
import { buildOutputSinkRoutes } from "./outputSinkRoutes.js";
import { buildRootDiscoveryRoutes } from "./rootDiscoveryRoutes.js";
import { buildSessionRoutes } from "./sessionRoutes.js";
import { buildAgentSkillRoutes } from "./agentSkillRoutes.js";
import { buildAppIntegrationRoutes } from "./appIntegrationRoutes.js";
import { buildDevAgentRoutes } from "./devAgentRoutes.js";
import { buildSchemaImportRoutes } from "./schemaImportRoutes.js";
import { buildUploadRoutes } from "./uploadRoutes.js";
import { buildTenantCommercialRoutes } from "./tenantCommercialRoutes.js";
import { buildLocalConnectorRoutes } from "./localConnectorRoutes.js";
import { buildLocalConnectorInstallRoutes } from "./localConnectorInstallRoutes.js";
import { buildDispatchRoutes } from "./dispatchRoutes.js";
import { buildOnboardingRoutes } from "./onboardingRoutes.js";
import { buildConnectRoutes } from "./connectRoutes.js";
import { buildSystemLayerRoutes } from "./systemLayerRoutes.js";
import { buildConnectorAgentRoutes } from "./connectorAgentRoutes.js";
import { buildMemberGoogleOAuthRoutes } from "./memberGoogleOAuthRoutes.js";
import { buildConnectorProxyRoutes } from "./connectorProxyRoutes.js";
import { buildConnectApiRoutes } from "./connectApiRoutes.js";
import { buildCredentialRoutes } from "./credentialRoutes.js";
import { buildGptSessionRoutes } from "./gptSessionRoutes.js";
import { buildGptToolsRoutes } from "./gptToolsRoutes.js";
import { buildAdminScopeGrantsRoutes } from "./adminScopeGrantsRoutes.js";
import { buildDeviceToolsRoutes } from "./deviceToolsRoutes.js";
import { buildConnectorTaxonomyRoutes } from "./connectorTaxonomyRoutes.js";
import { buildCredentialIntakeRoutes } from "./credentialIntakeRoutes.js";
import { buildBackupArtifactRoutes } from "./backupArtifactRoutes.js";
import { buildLocalGatewayToolsRoutes } from "./localGatewayToolsRoutes.js";
import { buildLocalConnectorDeviceRouteRoutes } from "./localConnectorDeviceRouteRoutes.js";
import { buildLocalManagerBetaRoutes } from "./localManagerBetaRoutes.js";
import { buildLocalManagerDesktopCommandRoutes } from "./localManagerDesktopCommandRoutes.js";
import { buildDeploymentInfoRoutes } from "./deploymentInfoRoutes.js";
import { buildDevDbRestoreRoutes } from "./devDbRestoreRoutes.js";
import { buildAdminOnboardingRoutes } from "./adminOnboardingRoutes.js";
import { buildPlatformGraphRoutes } from "./platformGraphRoutes.js";
import { buildPlatformPluginRoutes } from "./platformPluginRoutes.js";
import { buildTenantPlatformPluginRoutes } from "./tenantPlatformPluginRoutes.js";
import { buildTenantDocsRoutes } from "./tenantDocsRoutes.js";
import { buildTenantLifecycleRoutes } from "./tenantLifecycleRoutes.js";
import { buildWorkspaceResourceRoutes } from "./workspaceResourceRoutes.js";
import { buildAdminWorkspaceAuthorityRoutes } from "./adminWorkspaceAuthorityRoutes.js";
import { buildTenantEvolutionRoutes } from "./tenantEvolutionRoutes.js";
import { buildTenantInfrastructureRoutes } from "./tenantInfrastructureRoutes.js";
import { buildBrowserRuntimeRoutes } from "./browserRuntimeRoutes.js";
import { buildPlatformSmokeRoutes } from "./platformSmokeRoutes.js";
import { buildPlatformEvolutionRoutes } from "./platformEvolutionRoutes.js";
import { buildPlatformEngineRoutes } from "./platformEngineRoutes.js";
import { buildConnectedExecutionRoutes } from "./connectedExecutionRoutes.js";
import { buildPlatformPrivateCapabilityVaultRoutes } from "./platformPrivateCapabilityVaultRoutes.js";
import { buildSupportTicketRoutes } from "./supportTicketRoutes.js";
import { buildSessionInsightPromotionReviewRoutes } from "./sessionInsightPromotionReviewRoutes.js";
import { buildSessionInsightPromotionDryRunExecutorRoutes } from "./sessionInsightPromotionDryRunExecutorRoutes.js";
import { buildSessionInsightPromotionApplyRequestRoutes } from "./sessionInsightPromotionApplyRequestRoutes.js";
import { buildSessionInsightPromotionTargetAdapterRegistryRoutes } from "./sessionInsightPromotionTargetAdapterRegistryRoutes.js";
import { buildSessionInsightPromotionAdapterContractRoutes } from "./sessionInsightPromotionAdapterContractRoutes.js";
import { buildSessionInsightPromotionPayloadPreviewRoutes } from "./sessionInsightPromotionPayloadPreviewRoutes.js";
import { buildSessionInsightPayloadPreviewReviewRoutes } from "./sessionInsightPayloadPreviewReviewRoutes.js";
import { buildSessionInsightAdapterApplyReadinessGateRoutes } from "./sessionInsightAdapterApplyReadinessGateRoutes.js";
import { buildSessionInsightCapabilityEnvelopePlanRoutes } from "./sessionInsightCapabilityEnvelopePlanRoutes.js";
import { buildSessionInsightCapabilityEnvelopeRequestGateRoutes } from "./sessionInsightCapabilityEnvelopeRequestGateRoutes.js";
import { buildSessionInsightCapabilityEnvelopeRequestGateReviewRoutes } from "./sessionInsightCapabilityEnvelopeRequestGateReviewRoutes.js";
import { buildSessionInsightCapabilityEnvelopeDispatchDryRunRoutes } from "./sessionInsightCapabilityEnvelopeDispatchDryRunRoutes.js";
import { buildSessionInsightCapabilityEnvelopeDispatchDryRunReviewRoutes } from "./sessionInsightCapabilityEnvelopeDispatchDryRunReviewRoutes.js";
import { buildSessionInsightCapabilityEnvelopeActualRequestPreflightRoutes } from "./sessionInsightCapabilityEnvelopeActualRequestPreflightRoutes.js";
import { buildSessionInsightCapabilityEnvelopeActualRequestRoutes } from "./sessionInsightCapabilityEnvelopeActualRequestRoutes.js";
import { buildSessionInsightCapabilityEnvelopeApprovalRoutes } from "./sessionInsightCapabilityEnvelopeApprovalRoutes.js";
import { buildSessionInsightCapabilityEnvelopeDispatchReadbackRoutes } from "./sessionInsightCapabilityEnvelopeDispatchReadbackRoutes.js";
import { buildSessionInsightCapabilityEnvelopeAdapterExecutionGateRoutes } from "./sessionInsightCapabilityEnvelopeAdapterExecutionGateRoutes.js";
import { buildSessionInsightRemainingScopeCompletionRoutes } from "./sessionInsightRemainingScopeCompletionRoutes.js";
import { buildSessionInsightBacklogTargetWriteRoutes } from "./sessionInsightBacklogTargetWriteRoutes.js";
import { buildSessionInsightTargetWriteReadbackRoutes } from "./sessionInsightTargetWriteReadbackRoutes.js";
import { buildRuntimeVerificationRoutes } from "./runtimeVerificationRoutes.js";
import { buildOperationalConsoleRoutes } from "./operationalConsoleRoutes.js";
import { buildActivationGuidanceRoutes } from "./activationGuidanceRoutes.js";
import { buildGrowthIntelligenceRoutes } from "./growthIntelligenceRoutes.js";
import { buildAgentGovernanceRoutes } from "./agentGovernanceRoutes.js";

function sqlEndpointRegistryRoutesEnabled(env = process.env) {
  return String(env.ENABLE_SQL_ENDPOINT_REGISTRY_ROUTES || "").trim().toLowerCase() === "true";
}

function registerOptionalSqlEndpointRegistryRoutes(app, deps) {
  if (!sqlEndpointRegistryRoutesEnabled()) return;
  import("./sqlEndpointRegistryRoutes.js")
    .then(({ buildSqlEndpointRegistryRoutes }) => {
      if (typeof buildSqlEndpointRegistryRoutes !== "function") {
        throw new Error("buildSqlEndpointRegistryRoutes export is missing.");
      }
      app.use(buildSqlEndpointRegistryRoutes({ ...deps, requireAdminPrincipal }));
      console.info("[routes] SQL endpoint registry routes enabled.");
    })
    .catch((error) => {
      console.error("[routes] SQL endpoint registry routes disabled after failed dynamic import.", {
        code: error?.code,
        message: error?.message,
      });
    });
}

export function registerRoutes(app, deps) {
  app.use(buildDeploymentInfoRoutes());
  app.use(buildBackupArtifactRoutes(deps));
  app.use(buildDevDbRestoreRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildAdminOnboardingRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildConnectorAgentRoutes());
  // Local Manager beta and installer download include public UI/token-gated paths.
  // Mount before root-level protected routers that can return missing_backend_api_key.
  app.use(buildLocalManagerBetaRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildLocalManagerDesktopCommandRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildLocalConnectorInstallRoutes(deps));
  // Public token-gated credential intake pages must mount before any root-level
  // protected routers that call router.use(requireBackendApiKey).
  // The session creation route inside this router remains admin-protected.
  app.use(buildCredentialIntakeRoutes(deps));
  // Gmail OAuth callback is public but signed-state protected. Mount before
  // root-level protected routers that can return missing_backend_api_key.
  app.use(buildMemberGoogleOAuthRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildLegalRoutes(deps));
  app.use(buildRootDiscoveryRoutes());
  app.use(buildConnectRoutes(deps));
  // Tenant Connect API must mount before root-level admin/protected routers
  // so user JWT callers can create secure intake sessions and list app catalog.
  app.use(buildConnectApiRoutes(deps));
  app.use(buildSystemLayerRoutes(deps));
  app.use("/auth", buildAuthRoutes(deps));
  app.use(buildOnboardingRoutes(deps));
  app.use(buildStatusRoutes(deps));
  app.use(buildActivationRoutes(deps));
  app.use(buildActivationGuidanceRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildRuntimeVerificationRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildOperationalConsoleRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildHealthRoutes(deps));
  app.use(buildMcpRoutes(deps));
  app.use(buildGovernanceRoutes(deps));
  // Tenant-safe routes must mount before root-level admin/protected routers
  // that call router.use(requireBackendApiKey), otherwise user JWT requests
  // such as /me/connections/... are intercepted before reaching tenant guards.
  app.use(buildTenantPlatformPluginRoutes());
  app.use(buildTenantDocsRoutes());
  app.use(buildTenantLifecycleRoutes());
  app.use(buildWorkspaceResourceRoutes());
  app.use(buildSupportTicketRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildAdminWorkspaceAuthorityRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildTenantEvolutionRoutes());
  app.use(buildTenantInfrastructureRoutes(deps));
  app.use(buildGptSessionRoutes(deps));
  app.use(buildGptToolsRoutes(deps));
  app.use(buildPlatformGraphRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildPlatformSmokeRoutes());
  app.use(buildPlatformEvolutionRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildPlatformEngineRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildAgentGovernanceRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildPlatformPrivateCapabilityVaultRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildConnectedExecutionRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPromotionReviewRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPromotionDryRunExecutorRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPromotionApplyRequestRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPromotionTargetAdapterRegistryRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPromotionAdapterContractRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPromotionPayloadPreviewRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightPayloadPreviewReviewRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightAdapterApplyReadinessGateRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopePlanRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeRequestGateRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeRequestGateReviewRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeDispatchDryRunRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeDispatchDryRunReviewRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeActualRequestPreflightRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeActualRequestRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeApprovalRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeDispatchReadbackRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightCapabilityEnvelopeAdapterExecutionGateRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightRemainingScopeCompletionRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightBacklogTargetWriteRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildSessionInsightTargetWriteReadbackRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildPlatformPluginRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildBrowserRuntimeRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildGithubRoutes(deps));
  app.use(buildJobRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildAgentIntelligenceRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildAiResolverRoutes(deps));
  app.use(buildTenantsRoutes(deps));
  app.use(buildGrowthIntelligenceRoutes(deps));
  app.use(buildIdentityRoutes(deps));
  app.use(buildAccessRoutes(deps));
  app.use(buildCustomerRoutes(deps));
  app.use(buildConnectedSystemsRoutes(deps));
  app.use(buildPlannerRoutes(deps));
  app.use(buildAgentRegistryRoutes(deps));
  app.use(buildAgentSkillRoutes(deps));
  app.use(buildAppIntegrationRoutes(deps));
  app.use(buildCredentialRoutes(deps));
  app.use(buildDevAgentRoutes(deps));
  app.use(buildSchemaImportRoutes(deps));
  app.use(buildUploadRoutes(deps));
  app.use(buildOutputSinkRoutes(deps));
  app.use(buildSessionRoutes(deps));
  app.use(buildBootstrapRoutes(deps));
  app.use(buildLogicRoutes(deps));
  app.use(buildWorkflowOrchestrationRoutes(deps));
  app.use(buildN8nWorkflowRuntimeRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildObservabilityRoutes(deps));
  app.use(buildSecurityRoutes(deps));
  app.use(buildDeveloperApiRoutes(deps));
  app.use(buildReleaseRoutes(deps));
  app.use(buildConnectorRoutes(deps));
  app.use(buildBatchRoutes(deps));
  app.use(buildExecuteRoutes(deps));
  app.use(buildTenantCommercialRoutes(deps));
  app.use(buildDispatchRoutes(deps));
  app.use(buildLocalConnectorRoutes(deps));
  app.use(buildConnectorProxyRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildAdminScopeGrantsRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildDeviceToolsRoutes(deps));
  app.use(buildLocalGatewayToolsRoutes(deps));
  app.use(buildLocalConnectorDeviceRouteRoutes(deps));
  app.use(buildConnectorTaxonomyRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildBackupArtifactRoutes(deps));
  registerOptionalSqlEndpointRegistryRoutes(app, deps);
  app.post("/admin/control", deps.requireBackendApiKey, requireAdminPrincipal, buildAdminControlHandler());
  app.post("/admin/session-continuity/link-user", deps.requireBackendApiKey, requireAdminPrincipal, buildSessionContinuityHandler());
  app.use("/admin/cli", buildAdminCliRoutes(deps));
}
