import { Router } from "express";
import { executeWordPressStagingPluginDeploy } from "../wordpressStagingPluginDeployExecutor.js";

function bool(value) {
  return value === true || ["true", "1", "yes"].includes(String(value ?? "").trim().toLowerCase());
}

function errorResponse(res, err) {
  return res.status(err?.status || 500).json({
    ok: false,
    error: {
      code: err?.code || "wordpress_staging_plugin_deploy_failed",
      message: err?.message || "WordPress Staging plugin deployment failed.",
      details: err?.details || null,
    },
    secrets_included: false,
  });
}

export function buildWordPressStagingPluginDeployRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  env = process.env,
} = {}) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post(
    "/platform/remote-runtime/wordpress/staging/deploy-plugin",
    ...requireAdmin,
    async (req, res) => {
      try {
        const input = req.body && typeof req.body === "object" ? req.body : {};
        const dryRun = input.dry_run === undefined ? true : bool(input.dry_run);
        if (!dryRun && !bool(env.REMOTE_RUNTIME_WORDPRESS_STAGING_DEPLOY_ENABLED)) {
          return res.status(409).json({
            ok: false,
            error: {
              code: "wordpress_staging_plugin_deploy_apply_disabled",
              message: "WordPress Staging deploy apply is disabled until the dedicated runtime feature gate is enabled.",
              details: {
                required_feature_gate: "REMOTE_RUNTIME_WORDPRESS_STAGING_DEPLOY_ENABLED",
                dry_run_available: true,
                production_authority_used: false,
                breakglass_used: false,
                secrets_included: false,
              },
            },
            secrets_included: false,
          });
        }
        const result = await executeWordPressStagingPluginDeploy({
          ...input,
          dry_run: dryRun,
        });
        return res.status(result?.ok === false ? 502 : 200).json(result);
      } catch (err) {
        return errorResponse(res, err);
      }
    },
  );

  return router;
}
