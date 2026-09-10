import { Router } from "express";
import { executeWordPressStagingPluginDeploy } from "../wordpressStagingPluginDeployExecutor.js";

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
} = {}) {
  const router = Router();
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.post(
    "/platform/remote-runtime/wordpress/staging/deploy-plugin",
    ...requireAdmin,
    async (req, res) => {
      try {
        const input = req.body && typeof req.body === "object" ? req.body : {};
        const result = await executeWordPressStagingPluginDeploy({
          ...input,
          dry_run: input.dry_run === undefined ? true : input.dry_run,
        });
        return res.status(result?.ok === false ? 502 : 200).json(result);
      } catch (err) {
        return errorResponse(res, err);
      }
    },
  );

  return router;
}
