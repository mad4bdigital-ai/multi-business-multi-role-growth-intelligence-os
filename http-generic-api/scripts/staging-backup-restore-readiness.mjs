#!/usr/bin/env node
// Read-only source-scoped inventory. Deliberately NOT an executor/approval path.
import { getPool } from "../db.js";
import { assessStagingBackupAuthority } from "../stagingBackupRestoreAuthority.js";

const argv=new Map(process.argv.slice(2).map(a=>{const [key,...value]=a.split("=");return [key,value.join("=")]}));
const runtime=String(process.env.DEPLOYMENT_ENVIRONMENT||process.env.APP_ENV||"").toLowerCase();
const expected=String(argv.get("--expected-source-sha")||"");
let result=assessStagingBackupAuthority({environment:runtime,expected_source_sha:expected,policy_count:0});
if (!result.environment_valid) {
  console.log(JSON.stringify({...result,blockers:[...new Set([...result.blockers,"NO_DATABASE_ACCESS_NON_STAGING"])]}));
  process.exitCode=2;
} else {
  let pool;
  try {
    pool=getPool();
    // Restrict to the current MariaDB schema; never query cross-schema policy
    // or attempt account GRANTs. Do not read policy_json or credentials.
    const [rows]=await pool.query(`SELECT
      p.backup_kind,p.status,p.activation_gate_status,p.allowed_executor,
      p.artifact_format,p.encryption_scheme,p.checksum_algorithm,p.approval_required,
      p.restore_test_required,
      s.status AS source_status,d.status AS destination_status,
      (SELECT COUNT(*) FROM platform_backup_approvals a
         WHERE a.policy_id=p.policy_id AND a.approval_type='policy_activation'
           AND a.status='approved' AND (a.expires_at IS NULL OR a.expires_at>NOW())) AS approved_count
      FROM platform_backup_policies p
      LEFT JOIN platform_copy_locations s ON s.location_id=p.source_location_id
      LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
      WHERE p.backup_kind='database' AND p.policy_key='policy:staging-qa-db:approved'
      LIMIT 2`);
    result=assessStagingBackupAuthority({
      environment:runtime,expected_source_sha:expected,policy_count:rows.length,
      policy:rows.length===1?rows[0]:null,
    });
    if (rows.length>1) result.blockers.push("AMBIGUOUS_BACKUP_POLICY");
  } catch (error) {
    // Most initial Staging deployments don't grant runtime_app policy-table
    // SELECT, and have zero active backup policies. This is a blocker, not a
    // reason to use privileged DB credentials or silently upgrade grants.
    result={...result,blockers:[...new Set([...result.blockers,
      error?.code==="ER_TABLEACCESS_DENIED_ERROR"?"POLICY_READ_NOT_AUTHORIZED":"POLICY_CENSUS_UNAVAILABLE"])]};
  } finally {
    if(pool) await pool.end();
  }
  console.log(JSON.stringify(result));
  process.exitCode=2; // Never issue fixture/Production authority from inventory.
}
