#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  assertCmsAuthorityApplyAllowed,
  buildCmsAuthorityReconciliationPlan,
  CMS_AUTHORITY_RECONCILIATION_CONFIRMATION,
} from "../cmsAuthorityReconciliation.js";

function parseArgs(argv) {
  const args = { apply: false, confirm: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    if (arg === "--dry-run") args.apply = false;
    if (arg === "--confirm") {
      args.confirm = argv[index + 1] || null;
      index += 1;
    }
  }
  return args;
}

async function loadRows(pool) {
  const [claims] = await pool.query(
    `SELECT claim_id, tenant_id, user_id, connection_id, app_key, site_url, wp_json_base,
            normalized_domain, cms_roles_json, matched_brand_key, matched_target_key,
            verification_status, requested_scope, approved_by, approved_at, created_at, updated_at
       FROM cms_account_claims
      WHERE verification_status = 'approved'
        AND approved_at IS NOT NULL
        AND normalized_domain IS NOT NULL
      ORDER BY updated_at ASC`
  );
  const [sites] = await pool.query(
    `SELECT site_id, app_key, normalized_domain, site_url, wp_json_base,
            canonical_target_key, platform_status
       FROM cms_sites`
  );
  const [grants] = await pool.query(
    `SELECT grant_id, site_id, tenant_id, user_id, workspace_id, connection_id,
            claim_id, scope, status, publish_allowed
       FROM cms_site_access_grants`
  );
  const [brandBindings] = await pool.query(
    `SELECT binding_id, site_id, target_key, relationship_type, status
       FROM brand_site_bindings`
  );
  return { claims, sites, grants, brandBindings };
}

async function applyOperation(conn, operation) {
  if (operation.op === "create_cms_site") {
    const site = operation.site;
    await conn.query(
      `INSERT INTO cms_sites (
         site_id, app_key, normalized_domain, site_url, wp_json_base,
         canonical_target_key, platform_status, first_claimed_at, last_verified_at,
         created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, 'active', NOW(), NOW(), NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         site_url = VALUES(site_url),
         wp_json_base = VALUES(wp_json_base),
         canonical_target_key = COALESCE(VALUES(canonical_target_key), canonical_target_key),
         platform_status = 'active',
         last_verified_at = NOW(),
         updated_at = NOW()`,
      [
        site.site_id,
        site.app_key,
        site.normalized_domain,
        site.site_url,
        site.wp_json_base,
        site.canonical_target_key,
      ]
    );
    return;
  }

  if (operation.op === "create_cms_site_access_grant") {
    const grant = operation.grant;
    await conn.query(
      `INSERT INTO cms_site_access_grants (
         grant_id, site_id, tenant_id, user_id, workspace_id, connection_id, claim_id,
         scope, capabilities_json, draft_allowed, publish_allowed, destructive_allowed,
         status, approved_by, approved_at, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM cms_site_access_grants WHERE claim_id = ? LIMIT 1
        )`,
      [
        grant.grant_id,
        grant.site_id,
        grant.tenant_id,
        grant.user_id,
        grant.connection_id,
        grant.claim_id,
        grant.scope,
        grant.capabilities_json,
        grant.draft_allowed,
        grant.publish_allowed,
        grant.approved_by,
        grant.approved_at,
        grant.claim_id,
      ]
    );
    return;
  }

  if (operation.op === "create_brand_site_binding") {
    const binding = operation.binding;
    await conn.query(
      `INSERT INTO brand_site_bindings (
         binding_id, site_id, target_key, brand_name, relationship_type,
         status, created_by, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         brand_name = COALESCE(VALUES(brand_name), brand_name),
         relationship_type = VALUES(relationship_type),
         status = 'active',
         updated_at = NOW()`,
      [
        binding.binding_id,
        binding.site_id,
        binding.target_key,
        binding.brand_name,
        binding.relationship_type,
        binding.created_by,
      ]
    );
    return;
  }

  const err = new Error(`Unsupported CMS reconciliation operation: ${operation.op}`);
  err.code = "UNSUPPORTED_CMS_RECONCILIATION_OPERATION";
  throw err;
}

async function applyPlan(pool, plan) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let applied = 0;
    for (const operation of plan.operations) {
      if (operation.op === "manual_review") continue;
      await applyOperation(conn, operation);
      applied += 1;
    }
    await conn.commit();
    return { applied_operations: applied };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertCmsAuthorityApplyAllowed(args);
  const pool = getPool();
  const rows = await loadRows(pool);
  const plan = buildCmsAuthorityReconciliationPlan(rows);
  const response = {
    ok: plan.ok,
    mode: gate.mode,
    required_confirmation: gate.allowed ? undefined : CMS_AUTHORITY_RECONCILIATION_CONFIRMATION,
    summary: plan.summary,
    operations: plan.operations,
    secrets_included: false,
  };

  if (gate.allowed) {
    const applyResult = await applyPlan(pool, plan);
    response.apply = applyResult;
  }

  await pool.end();
  console.log(JSON.stringify(response, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    code: err.code || "CMS_AUTHORITY_RECONCILIATION_FAILED",
    message: err.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
