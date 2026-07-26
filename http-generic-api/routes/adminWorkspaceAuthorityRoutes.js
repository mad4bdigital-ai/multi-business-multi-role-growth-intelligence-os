import { Router } from "express";
import { getPool } from "../db.js";

const DETAIL_VIEWS = Object.freeze({
  cms_grants_without_workspace_membership: "v_cms_grants_without_workspace_membership",
  connections_without_workspace_membership: "v_connections_without_workspace_membership",
  active_memberships_missing_workspace_grants: "v_active_memberships_missing_workspace_grants",
  cms_publish_grants_missing_resource_grants: "v_cms_publish_grants_missing_resource_grants",
});

function bool(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

async function readSummary(pool) {
  const [rows] = await pool.query(
    "SELECT check_key, issue_count FROM v_workspace_authority_reconciliation_summary ORDER BY check_key"
  );
  return rows;
}

async function readDetails(pool, limit = 50) {
  const details = {};
  for (const [checkKey, viewName] of Object.entries(DETAIL_VIEWS)) {
    const [rows] = await pool.query(`SELECT * FROM ${viewName} LIMIT ?`, [limit]);
    details[checkKey] = rows;
  }
  return details;
}

async function repairConnectionsWithoutMembership(pool, actor = "admin:auto-heal") {
  const [rows] = await pool.query(
    `SELECT connection_id, tenant_id, user_id
       FROM v_connections_without_workspace_membership
      WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL
      LIMIT 100`
  );
  let repaired = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status)
       VALUES (?, ?, 'admin', 'active')
       ON DUPLICATE KEY UPDATE role='admin', status='active', updated_at=NOW()`,
      [row.user_id, row.tenant_id]
    );
    await pool.query(
      `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
       VALUES (UUID(), ?, ?, 'workspace', ?, 'admin', 'active', 'admin_repair', ?, JSON_OBJECT('repair','connections_without_workspace_membership','connection_id',?))
       ON DUPLICATE KEY UPDATE status='active', permission='admin', source='admin_repair', granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
      [row.tenant_id, row.user_id, row.tenant_id, actor, row.connection_id]
    );
    repaired += 1;
  }
  return { check_key: "connections_without_workspace_membership", inspected: rows.length, repaired };
}

async function repairCmsGrantsWithoutMembership(pool, actor = "admin:auto-heal") {
  const [rows] = await pool.query(
    `SELECT grant_id, tenant_id, user_id, site_id, publish_allowed
       FROM v_cms_grants_without_workspace_membership
      WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL
      LIMIT 100`
  );
  let repaired = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role, status)
       VALUES (?, ?, 'admin', 'active')
       ON DUPLICATE KEY UPDATE role='admin', status='active', updated_at=NOW()`,
      [row.user_id, row.tenant_id]
    );
    await pool.query(
      `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
       VALUES (UUID(), ?, ?, 'workspace', ?, 'admin', 'active', 'admin_repair', ?, JSON_OBJECT('repair','cms_grants_without_workspace_membership','cms_grant_id',?))
       ON DUPLICATE KEY UPDATE status='active', permission='admin', source='admin_repair', granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
      [row.tenant_id, row.user_id, row.tenant_id, actor, row.grant_id]
    );
    if (row.site_id) {
      await pool.query(
        `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
         VALUES (UUID(), ?, ?, 'site', ?, ?, 'active', 'admin_repair', ?, JSON_OBJECT('repair','cms_grants_without_workspace_membership_site_grant','cms_grant_id',?))
         ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), source='admin_repair', granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
        [row.tenant_id, row.user_id, row.site_id, row.publish_allowed === 1 ? "operate" : "edit", actor, row.grant_id]
      );
    }
    repaired += 1;
  }
  return { check_key: "cms_grants_without_workspace_membership", inspected: rows.length, repaired };
}

async function repairMissingWorkspaceGrants(pool, actor = "admin:auto-heal") {
  const [rows] = await pool.query(
    `SELECT tenant_id, user_id, role
       FROM v_active_memberships_missing_workspace_grants
      WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL
      LIMIT 100`
  );
  let repaired = 0;
  for (const row of rows) {
    const permission = row.role === "admin" || row.role === "owner" ? "admin" : ["editor", "operator"].includes(row.role) ? "operate" : "view";
    await pool.query(
      `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
       VALUES (UUID(), ?, ?, 'workspace', ?, ?, 'active', 'admin_repair', ?, JSON_OBJECT('repair','active_memberships_missing_workspace_grants','role',?))
       ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), source='admin_repair', granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
      [row.tenant_id, row.user_id, row.tenant_id, permission, actor, row.role]
    );
    repaired += 1;
  }
  return { check_key: "active_memberships_missing_workspace_grants", inspected: rows.length, repaired };
}

async function repairCmsPublishMissingResourceGrants(pool, actor = "admin:auto-heal") {
  const [rows] = await pool.query(
    `SELECT cms_grant_id, tenant_id, user_id, site_id, required_permission
       FROM v_cms_publish_grants_missing_resource_grants
      WHERE tenant_id IS NOT NULL AND user_id IS NOT NULL AND site_id IS NOT NULL
      LIMIT 100`
  );
  let repaired = 0;
  for (const row of rows) {
    await pool.query(
      `INSERT INTO workspace_resource_grants (grant_id, tenant_id, grantee_user_id, resource_type, resource_ref, permission, status, source, granted_by, metadata_json)
       VALUES (UUID(), ?, ?, 'site', ?, ?, 'active', 'admin_repair', ?, JSON_OBJECT('repair','cms_publish_grants_missing_resource_grants','cms_grant_id',?))
       ON DUPLICATE KEY UPDATE status='active', permission=VALUES(permission), source='admin_repair', granted_by=VALUES(granted_by), metadata_json=VALUES(metadata_json), updated_at=NOW()`,
      [row.tenant_id, row.user_id, row.site_id, row.required_permission || "edit", actor, row.cms_grant_id]
    );
    repaired += 1;
  }
  return { check_key: "cms_publish_grants_missing_resource_grants", inspected: rows.length, repaired };
}

async function runRepairs(pool, actor) {
  const results = [];
  results.push(await repairConnectionsWithoutMembership(pool, actor));
  results.push(await repairCmsGrantsWithoutMembership(pool, actor));
  results.push(await repairMissingWorkspaceGrants(pool, actor));
  results.push(await repairCmsPublishMissingResourceGrants(pool, actor));
  return results;
}

export function buildAdminWorkspaceAuthorityRoutes({ requireBackendApiKey, requireAdminPrincipal } = {}) {
  const router = Router();
  const requireBackend = typeof requireBackendApiKey === "function" ? requireBackendApiKey : (_req, _res, next) => next();
  const requireAdmin = typeof requireAdminPrincipal === "function" ? requireAdminPrincipal : (_req, _res, next) => next();
  const adminGuard = [requireBackend, requireAdmin];

  router.get("/admin/workspace-authority/reconciliation", ...adminGuard, async (req, res) => {
    try {
      const pool = getPool();
      const summary = await readSummary(pool);
      const includeDetails = bool(req.query.include_details);
      const payload = {
        ok: true,
        summary,
        issue_count: summary.reduce((sum, row) => sum + Number(row.issue_count || 0), 0),
        details: includeDetails ? await readDetails(pool, Math.min(Number(req.query.limit || 50), 200)) : undefined,
        will_mutate: false,
        secrets_included: false,
      };
      return res.json(payload);
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_authority_reconciliation_failed", message: err.message }, secrets_included: false });
    }
  });

  router.post("/admin/workspace-authority/repair", ...adminGuard, async (req, res) => {
    try {
      const pool = getPool();
      const before = await readSummary(pool);
      const dryRun = req.body?.dry_run !== false;
      if (dryRun) {
        return res.json({ ok: true, mode: "dry_run", before, repairs: [], after: before, will_mutate: false, secrets_included: false });
      }
      const actor = String(req.auth?.user_id || req.auth?.admin_id || "admin:auto-heal");
      const repairs = await runRepairs(pool, actor);
      const after = await readSummary(pool);
      return res.json({ ok: true, mode: "repair", before, repairs, after, will_mutate: true, secrets_included: false });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "workspace_authority_repair_failed", message: err.message }, secrets_included: false });
    }
  });

  return router;
}

export const _testingAdminWorkspaceAuthorityRoutes = { DETAIL_VIEWS };
