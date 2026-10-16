#!/usr/bin/env node
// Read-only Staging inventory; never falls back to runtime_app to read the
// privileged backup registry. No policy creation, approval or export.
import {assessStagingBackupAuthority} from "../stagingBackupRestoreAuthority.js";
import {openStagingBackupPolicyReader,resolveStagingBackupPolicyReaderConfig} from "../stagingBackupPolicyReader.mjs";

const argv=new Map(process.argv.slice(2).map(a=>{
  const [key,...value]=a.split("=");return [key,value.join("=")];
}));
const runtime=String(process.env.DEPLOYMENT_ENVIRONMENT||"").toLowerCase();
const expected=String(argv.get("--expected-source-sha")||"");
let result=assessStagingBackupAuthority({
  environment:runtime,expected_source_sha:expected,
  policy_inventory_verified:false,
});
const blockers=new Set();
if(!result.environment_valid){
  blockers.add("NO_DATABASE_ACCESS_NON_STAGING");
}else if(process.env.DEPLOY_COMMIT!==expected){
  blockers.add("STAGING_BACKUP_SOURCE_IDENTITY_MISMATCH");
}else{
  let pool;
  try{
    // The measured Local Connector must inject a separately provisioned
    // four-table SELECT-only identity; never store these credentials in Git
    // or expose them to the long-lived app runtime.
    resolveStagingBackupPolicyReaderConfig(process.env);
    const mysql=(await import("mysql2/promise")).default;
    pool=await openStagingBackupPolicyReader({env:process.env,driver:mysql});
    const [rows]=await pool.query(`SELECT
      p.policy_key,p.backup_kind,p.status,p.activation_gate_status,p.allowed_executor,
      p.artifact_format,p.encryption_scheme,p.checksum_algorithm,p.approval_required,
      p.restore_test_required,s.status AS source_status,d.status AS destination_status,
      (SELECT COUNT(*) FROM platform_backup_approvals a
        WHERE a.policy_id=p.policy_id AND a.approval_type='policy_activation'
          AND a.status='approved' AND (a.expires_at IS NULL OR a.expires_at>NOW())) AS approved_count
      FROM platform_backup_policies p
      LEFT JOIN platform_copy_locations s ON s.location_id=p.source_location_id
      LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
      WHERE p.backup_kind='database' AND p.policy_key='policy:staging-qa-db:approved'
      LIMIT 2`);
    const candidate=rows.length===1
      ?rows.find(row=>row.policy_key==="policy:staging-qa-db:approved" && row.backup_kind==="database")
      :null;
    result=assessStagingBackupAuthority({
      environment:runtime,expected_source_sha:expected,
      policy_inventory_verified:true,policy_count:rows.length,policy:candidate,
    });
    if(rows.length>1)blockers.add("AMBIGUOUS_BACKUP_POLICY");
  }catch(error){
    // No error message, SQL text, principal, password or connection URI
    // is surfaced in the output. Only an allowlisted diagnostic code.
    const code=String(error?.code||"");
    const known=new Set([
      "BACKUP_POLICY_READER_NOT_CONFIGURED",
      "BACKUP_READER_STAGING_IDENTITY_REQUIRED",
      "BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED",
      "BACKUP_POLICY_READER_EXACT_SOURCE_REQUIRED",
      "BACKUP_POLICY_READER_LIVE_IDENTITY_MISMATCH",
      "BACKUP_POLICY_READER_EXCESS_PRIVILEGES",
      "BACKUP_POLICY_READER_TABLE_GRANT_MISSING",
      "BACKUP_POLICY_READER_GRANTS_UNVERIFIED",
      "BACKUP_POLICY_READER_CONNECTION_OR_GRANTS_UNVERIFIED",
    ]);
    blockers.add(known.has(code)?code:
      code==="ER_TABLEACCESS_DENIED_ERROR"?"POLICY_READ_NOT_AUTHORIZED":"POLICY_CENSUS_UNAVAILABLE");
  }finally{
    if(pool)await pool.end();
  }
}
result={...result,blockers:[...new Set([...result.blockers,...blockers])],
  policy_reader_mode:"dedicated_local_staging_select_only",
  backup_executed:false,qa_fixture_write_authorized:false,
  production_promotion_authorized:false,production_mutation:false,secrets_included:false};
console.log(JSON.stringify(result));
process.exitCode=2; // Read-only inventory never opens fixture or backup execution.
