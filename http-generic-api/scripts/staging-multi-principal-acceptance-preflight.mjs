#!/usr/bin/env node
// Staging ONLY. The CLI reads aggregate counts and deliberately exits blocked.
import { getPool } from "../db.js";
import { assessStagingMultiPrincipalReadiness } from "../stagingMultiPrincipalAcceptanceGate.js";

const env=String(process.env.DEPLOYMENT_ENVIRONMENT||process.env.NODE_ENV||"").toLowerCase();
if(!env.includes("staging") || env.includes("production")) {
  console.log(JSON.stringify(assessStagingMultiPrincipalReadiness({environment:env})));
  process.exitCode=2;
} else {
  const pool=getPool();
  const get=async sql=>{
    const [rows]=await pool.query(sql);
    const value=Number(rows?.[0]?.n);
    if(!Number.isSafeInteger(value)||value<0) throw new Error("invalid_aggregate_census");
    return value;
  };
  try{
    const counts={
      users:await get("SELECT COUNT(*) AS n FROM users WHERE status='active'"),
      tenants:await get("SELECT COUNT(*) AS n FROM tenants WHERE status='active'"),
      memberships:await get("SELECT COUNT(*) AS n FROM memberships WHERE status='active'"),
      cross_tenant_users:await get(`SELECT COUNT(*) AS n FROM (
          SELECT m.user_id FROM memberships m
          JOIN users u ON u.user_id=m.user_id
          JOIN tenants t ON t.tenant_id=m.tenant_id
          WHERE m.status='active' AND u.status='active' AND t.status='active'
          GROUP BY m.user_id HAVING COUNT(DISTINCT m.tenant_id)>1
        ) eligible_users`),
      inactive_users:await get("SELECT COUNT(*) AS n FROM users WHERE status<>'active'"),
      inactive_memberships:await get("SELECT COUNT(*) AS n FROM memberships WHERE status<>'active'"),
      revoked_grants:await get("SELECT COUNT(*) AS n FROM remote_mcp_oauth_grants WHERE status='revoked'"),
    };
    const [groups]=await pool.query(`SELECT
        SUM(CASE WHEN LOWER(m.role) IN ('owner','admin') THEN 1 ELSE 0 END) AS owners,
        SUM(CASE WHEN LOWER(m.role)='member' THEN 1 ELSE 0 END) AS members,
        COUNT(DISTINCT m.user_id) AS distinct_users
        FROM memberships m
        JOIN users u ON u.user_id=m.user_id
        JOIN tenants t ON t.tenant_id=m.tenant_id
        WHERE m.status='active' AND u.status='active' AND t.status='active'
        GROUP BY m.tenant_id
        ORDER BY COUNT(DISTINCT m.user_id) DESC`);
    // No primary keys, user IDs, emails, tenant IDs, brand names or credentials
    // are ever read into the evidence object.
    const report=assessStagingMultiPrincipalReadiness({
      environment:env,counts,
      tenant_role_groups:groups.map(g=>({
        owners:Number(g.owners),
        members:Number(g.members),
        distinct_users:Number(g.distinct_users),
      })),
    });
    console.log(JSON.stringify(report));
    process.exitCode=report.production_promotion_eligible?0:2;
  }catch(error){
    console.log(JSON.stringify({
      contract:"mad4b.staging.oa-mc-four-principal-preflight.v1",
      outcome:"blocked",status:"fail_closed",
      blocker:"STAGING_SQL_AGGREGATE_READ_FAILED",
      error_class:String(error?.code||"read_error").slice(0,80),
      production_promotion_eligible:false,
      database_mutation:false,production_mutation:false,secrets_included:false,
    }));
    process.exitCode=2;
  }finally{await pool.end()}
}
