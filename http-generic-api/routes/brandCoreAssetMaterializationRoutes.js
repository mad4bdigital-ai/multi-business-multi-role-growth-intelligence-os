import { Router } from "express";
import { getPool } from "../db.js";
import { createUserJwtMiddleware } from "../userJwtAuth.js";
import { materializeWorkspaceBrandCoreAsset } from "../workspaceBrandCoreAssetMaterialization.js";

const requireCanonicalUserJwt = createUserJwtMiddleware();

export function buildBrandCoreAssetMaterializationRoutes() {
  const router = Router();

  // RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_core_asset_materialize
  router.post(
    "/me/workspaces/:tenant_id/assets/materialize-brand-core",
    requireCanonicalUserJwt,
    async (req, res) => {
      const connection = await getPool().getConnection();
      let transactionStarted = false;
      try {
        await connection.beginTransaction(); // MUTATION_TRANSACTION: workspace_brand_core_asset_materialize
        transactionStarted = true;
        const result = await materializeWorkspaceBrandCoreAsset(connection, {
          tenantId: req.params.tenant_id,
          actorUserId: req.auth.user_id,
          brandRef: req.body?.brand_ref,
          sourceRef: req.body?.source_ref,
        });
        if (!result?.asset?.asset_id || !result?.asset?.provenance_sha256) {
          throw Object.assign(new Error("Brand Core materialization did not produce an exact persisted asset readback."), {
            status: 409,
            code: "brand_core_asset_materialize_readback_missing",
          });
        } // MUTATION_READBACK: workspace_brand_core_asset_materialize
        await connection.commit();
        transactionStarted = false;
        return res.status(201).json({
          ok: true,
          tenant_id: req.params.tenant_id,
          ...result,
          readback: "same_cycle",
          secrets_included: false,
        });
      } catch (error) {
        if (transactionStarted) await connection.rollback();
        return res.status(error?.status || 500).json({
          ok: false,
          error: {
            code: error?.code || "brand_core_asset_materialize_failed",
            message: error?.message || "Brand Core asset materialization failed.",
            ...(error?.details ? { details: error.details } : {}),
          },
          secrets_included: false,
        });
      } finally {
        connection.release();
      }
    }
  );

  return router;
}
