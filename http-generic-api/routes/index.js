import { buildHealthRoutes } from "./healthRoutes.js";
import { buildStatusRoutes } from "./statusRoutes.js";
import { buildActivationRoutes } from "./activationRoutes.js";
import { buildMcpRoutes } from "./mcpRoutes.js";
import { buildGovernanceRoutes } from "./governanceRoutes.js";
import { buildJobRoutes } from "./jobRoutes.js";
import { buildExecuteRoutes } from "./executeRoutes.js";
import { buildGithubRoutes } from "./githubRoutes.js";
import { buildAiResolverRoutes } from "./aiResolverRoutes.js";
import { buildTenantsRoutes } from "./tenantsRoutes.js";
import { buildIdentityRoutes } from "./identityRoutes.js";
import { buildAccessRoutes } from "./accessRoutes.js";
import { buildCustomerRoutes } from "./customerRoutes.js";
import { buildConnectedSystemsRoutes } from "./connectedSystemsRoutes.js";
import { buildPlannerRoutes } from "./plannerRoutes.js";
import { buildBootstrapRoutes } from "./bootstrapRoutes.js";
import { buildLogicRoutes } from "./logicRoutes.js";
import { buildWorkflowOrchestrationRoutes } from "./workflowOrchestrationRoutes.js";
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
import { buildDeploymentInfoRoutes } from "./deploymentInfoRoutes.js";
import { buildDevDbRestoreRoutes } from "./devDbRestoreRoutes.js";

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
  app.use(buildDevDbRestoreRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildConnectorAgentRoutes());
  // Public token-gated credential intake pages must mount before any root-level
  // protected routers that call router.use(requireBackendApiKey).
  // The session creation route inside this router remains admin-protected.
  app.use(buildCredentialIntakeRoutes(deps));
  app.use(buildLegalRoutes(deps));
  app.use(buildRootDiscoveryRoutes());
  app.use(buildConnectRoutes(deps));
  app.use(buildSystemLayerRoutes(deps));
  app.use("/auth", buildAuthRoutes(deps));
  app.use(buildOnboardingRoutes(deps));
  app.use(buildStatusRoutes(deps));
  app.use(buildActivationRoutes(deps));
  app.use(buildHealthRoutes(deps));
  app.use(buildMcpRoutes(deps));
  app.use(buildGovernanceRoutes(deps));
  app.use(buildGithubRoutes(deps));
  app.use(buildJobRoutes(deps));
  app.use(buildAiResolverRoutes(deps));
  app.use(buildTenantsRoutes(deps));
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
  app.use(buildObservabilityRoutes(deps));
  app.use(buildSecurityRoutes(deps));
  app.use(buildDeveloperApiRoutes(deps));
  app.use(buildReleaseRoutes(deps));
  app.use(buildConnectorRoutes(deps));
  app.use(buildBatchRoutes(deps));
  app.use(buildExecuteRoutes(deps));
  app.use(buildTenantCommercialRoutes(deps));
  app.use(buildDispatchRoutes(deps));
  // Install/download routes include a public short-lived token-gated download path.
  // Mount them before the protected /local-connector catch-all routes.
  app.use(buildLocalConnectorInstallRoutes(deps));
  app.use(buildLocalConnectorRoutes(deps));
  app.use(buildMemberGoogleOAuthRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildConnectorProxyRoutes({ ...deps, requireAdminPrincipal }));
  app.use(buildConnectApiRoutes(deps));
  app.use(buildGptSessionRoutes(deps));
  app.use(buildGptToolsRoutes(deps));
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
