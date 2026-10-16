// Purpose-specific Staging backup reader DB adapter, to be used ONLY inside a
// separately authorized, isolated Local Connector managed-DB broker process.
// No route, CLI executor, root credential resolution, or automatic binding.
import {randomBytes} from "node:crypto";
import {openStagingBackupPolicyReader} from "./stagingBackupPolicyReader.mjs";
import {
  STAGING_BACKUP_READER_TABLES,planStagingBackupReaderGrant,
  verifySignedReaderGrantApproval,runGovernedStagingBackupReaderCensus,
} from "./stagingBackupReaderGrantLifecycle.mjs";

const expectedTables=[...STAGING_BACKUP_READER_TABLES].sort();
const accountName="backup_policy_reader";
const accountHost="172.18.%";
const dbName="growth_runtime";
const dbHost="runtime-db";
const network="http-generic-api_default";
const subnet="172.18.0.0/16";
const readerKey="policy:staging-qa-db:approved";
const capabilityKey="staging.backup.reader.provision-census-revoke";
const exactSha=/^[0-9a-f]{40}$/i;
function fail(code){const e=new Error(code);e.code=code;throw e;}
function resultRows(value){
  if(!Array.isArray(value)||value.length<1)fail("MANAGED_READER_ADMIN_SQL_RESPONSE_INVALID");
  const [rowset]=value;
  if(!Array.isArray(rowset))fail("MANAGED_READER_ADMIN_SQL_RESPONSE_INVALID");
  return rowset;
}
function assertBound(binding,expectedSourceSha,deviceId){
  if(!binding||binding.source_sha!==expectedSourceSha||
    !exactSha.test(String(expectedSourceSha||""))||
    binding.device_id!==deviceId||
    binding.db_host!==dbHost||binding.db_schema!==dbName||
    binding.network!==network||binding.subnet!==subnet||
    binding.reader_user!==accountName||binding.account_host_pattern!==accountHost||
    binding.run_id?.length<8||binding.cleanup_required!==true||
    binding.no_schema_wide_privileges!==true||binding.no_grant_option!==true||
    JSON.stringify(binding.privileges)!=='["SELECT"]'||
    !Array.isArray(binding.tables)||
    JSON.stringify([...binding.tables].sort())!==JSON.stringify(expectedTables))
    fail("MANAGED_READER_EXACT_BINDING_REQUIRED");
}
function validateAdminSession({session,sourceSha,deviceId}){
  if(typeof session?.query!=="function"||session?.authority?.capability_key!==capabilityKey||
    session.authority?.environment!=="staging_local_windows_docker"||
    session.authority?.source_sha!==sourceSha||
    session.authority?.device_id!==deviceId||
    session.authority?.db_host!==dbHost||
    session.authority?.db_schema!==dbName||
    session.authority?.network!==network||
    session.authority?.no_production_mutation!==true||
    session.authority?.independent_owner_signature_verified!==true||
    session.authority?.redacts_query_parameters!==true||
    session.authority?.single_use_ephemeral_session!==true)
    fail("MANAGED_READER_BROKER_AUTHORITY_UNVERIFIED");
}
async function assertAdminIdentity(query){
  const rows=resultRows(await query("SELECT DATABASE() AS database_name,CURRENT_USER() AS identity"));
  if(rows.length!==1)fail("MANAGED_READER_DATABASE_IDENTITY_MISMATCH");
  const [singleIdentity]=rows;
  if(singleIdentity?.database_name!==dbName)fail("MANAGED_READER_DATABASE_IDENTITY_MISMATCH");
  const user=String(singleIdentity.identity||"").split("@")[0].toLowerCase();
  if(!user||["root","admin","runtime_app","control_plane_writer",accountName].includes(user))
    fail("MANAGED_READER_ADMIN_PRINCIPAL_NOT_INDEPENDENT");
}
function count(rows){
  if(rows.length!==1)fail("MANAGED_READER_SQL_COUNT_UNVERIFIED");
  const [singleCount]=rows;
  const numericCount=Number(singleCount?.total);
  if(!Number.isSafeInteger(numericCount)||numericCount<0)
    fail("MANAGED_READER_SQL_COUNT_UNVERIFIED");
  return numericCount;
}

// The injected administrative session is issued by a separately trusted
// purpose-specific broker. Passing a plain runtime_app pool is denied by its
// authoritative broker attestation AND its observed MariaDB CURRENT_USER().
// This factory never opens an admin connection or reads secrets from env.
export async function createManagedStagingBackupReaderAdapters({
  adminSession,readerDriver,expectedSourceSha,deviceId,
}={}){
  validateAdminSession({session:adminSession,sourceSha:expectedSourceSha,deviceId});
  if(typeof readerDriver?.createPool!=="function")fail("MANAGED_READER_CLIENT_DRIVER_REQUIRED");
  if(typeof deviceId!=="string"||deviceId.length<3||
    !exactSha.test(String(expectedSourceSha||"")))
    fail("MANAGED_READER_SOURCE_DEVICE_REQUIRED");

  await assertAdminIdentity(adminSession.query.bind(adminSession));
  const leases=new Map();
  let pendingLease=null;
  const query=(sql,params=[])=>adminSession.query(sql,params);
  const principalId="'backup_policy_reader'@'172.18.%'";
  const readerEnv=(password)=>({
    NODE_ENV:"staging",DEPLOYMENT_ENVIRONMENT:"staging_local_windows_docker",
    DEPLOY_COMMIT:expectedSourceSha,DB_HOST:dbHost,DB_NAME:dbName,
    DB_USER:"runtime_app",CONTROL_PLANE_WRITE_DB_USER:"control_plane_writer",
    STAGING_BACKUP_POLICY_READER_ENABLED:"true",
    STAGING_BACKUP_POLICY_READER_HOST:dbHost,
    STAGING_BACKUP_POLICY_READER_DATABASE:dbName,
    STAGING_BACKUP_POLICY_READER_USER:accountName,
    STAGING_BACKUP_POLICY_READER_PASSWORD:password,
  });
  const admin=Object.freeze({
    async inspect(binding){
      assertBound(binding,expectedSourceSha,deviceId);
      await assertAdminIdentity(query);
      const [tables,users]=await Promise.all([
        query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?,?)",
          [dbName,...expectedTables]),
        query("SELECT COUNT(*) AS total FROM mysql.user WHERE User=?",[accountName]),
      ]);
      const found=resultRows(tables).map(row=>String(row.name)).sort();
      return Object.freeze({database:dbName,tables:found,reader_absent:
        count(resultRows(users))===0});
    },
    async provisionTemporaryReader(binding){
      assertBound(binding,expectedSourceSha,deviceId);
      if(pendingLease)fail("MANAGED_READER_LEASE_ALREADY_ACTIVE");
      const secret=randomBytes(48).toString("base64url");
      const id=randomBytes(16).toString("hex");
      // Set before CREATE USER: partial DDL must always trigger revocation.
      leases.set(id,secret);
      pendingLease=id;
      await query("CREATE USER "+principalId+" IDENTIFIED BY ?",[secret]);
      for(const table of expectedTables){
        // All identifiers are immutable in this module: caller cannot inject SQL.
        await query("GRANT SELECT ON `growth_runtime`.`"+table+"` TO "+principalId);
      }
      return Object.freeze({opaque_lease:id});
    },
    async readReaderGrants(binding){
      assertBound(binding,expectedSourceSha,deviceId);
      return resultRows(await query("SHOW GRANTS FOR "+principalId));
    },
    async revokeTemporaryReader(binding){
      assertBound(binding,expectedSourceSha,deviceId);
      try{
        // Only the exact account can be revoked. This also handles partial
        // CREATE USER / GRANT failure; no other MariaDB identity is touched.
        await query("DROP USER IF EXISTS "+principalId);
      }finally{
        if(pendingLease)leases.delete(pendingLease);
        pendingLease=null;
      }
    },
    async readerAbsent(binding){
      assertBound(binding,expectedSourceSha,deviceId);
      const users=resultRows(await query(
        "SELECT COUNT(*) AS total FROM mysql.user WHERE User=?",[accountName]));
      return count(users)===0;
    },
  });
  const reader=Object.freeze({
    async census({lease,source_sha,expected_policy_key}={}){
      if(source_sha!==expectedSourceSha||expected_policy_key!==readerKey||
        !lease?.opaque_lease||lease.opaque_lease!==pendingLease||
        !leases.has(lease.opaque_lease))
        fail("MANAGED_READER_OPAQUE_LEASE_INVALID");
      const password=leases.get(lease.opaque_lease);
      let pool;
      try{
        pool=await openStagingBackupPolicyReader({
          env:readerEnv(password),driver:readerDriver,
        });
        const rows=resultRows(await pool.query(
          "SELECT policy_key,backup_kind FROM platform_backup_policies WHERE policy_key=? AND backup_kind='database' LIMIT 2",
          [readerKey]));
        if(rows.length>1)fail("MANAGED_READER_AMBIGUOUS_POLICY");
        return Object.freeze({policy_inventory_verified:true,
          existing_policy_count:rows.length});
      }finally{if(pool)await pool.end();}
    },
  });
  return Object.freeze({admin,reader,broker_capability:capabilityKey,
    source_sha:expectedSourceSha,device_id:deviceId,
    broker_bound:true,production_mutation:false});
}

// Staging-only composition boundary. The injected broker MUST be an independently
// installed, measured and security-reviewed local service, not an app route,
// a caller-crafted session object, a shell alias or Desktop Commander.
function assertOneShotBrokerTicket(session,plan,nowMs){
  const authority=session?.authority;
  if(typeof session?.close!=="function"||
    authority?.run_id!==plan.binding.run_id||
    authority?.plan_sha256!==plan.plan_sha256||
    authority?.source_sha!==plan.binding.source_sha||
    authority?.device_id!==plan.binding.device_id||
    authority?.capability_key!==capabilityKey||
    authority?.single_use_ephemeral_session!==true||
    !Number.isSafeInteger(authority?.issued_at_ms)||
    !Number.isSafeInteger(authority?.expires_at_ms)||
    authority.issued_at_ms>nowMs||
    authority.expires_at_ms<=nowMs||
    authority.expires_at_ms-authority.issued_at_ms>600_000)
    fail("MANAGED_READER_BROKER_OPERATION_TICKET_UNVERIFIED");
}

// No default broker, credential, signer or execution route is registered here.
// A signed source-head review is not an owner-signed one-shot DB operation.
// Session close failure always invalidates a previously successful census.
export async function runWithIndependentStagingBackupBroker({
  broker,measuredIdentity,expectedSha,runId,approval,
  trustedOwnerPublicKey,readerDriver,ledger,audit,
}={}){
  if(typeof broker?.openOneShotSession!=="function"||
    typeof measuredIdentity!=="function"||
    typeof ledger?.consumeOnce!=="function"||
    typeof audit?.append!=="function"||
    typeof readerDriver?.createPool!=="function")
    fail("INDEPENDENT_STAGING_BACKUP_BROKER_REQUIRED");
  const measured=await measuredIdentity();
  const plan=planStagingBackupReaderGrant({
    measured,expectedSha,runId,
  });
  // Check the cryptographic owner authorization before opening any privileged
  // session. The independent broker must perform its OWN verification too.
  verifySignedReaderGrantApproval({plan,approval,trustedOwnerPublicKey});
  let session=null,completion=null,result=null;
  // Defer ONLY the final positive audit event until the broker session is
  // confirmed closed. The initial attempt remains durably append-only.
  const gatedAudit=Object.freeze({async append(event){
    if(event?.event==="reader_grant_completed"){
      completion=Object.freeze({...event});
      return true;
    }
    return audit.append(event);
  }});
  try{
    session=await broker.openOneShotSession(Object.freeze({
      capability_key:capabilityKey,plan,approval,
    }));
    assertOneShotBrokerTicket(session,plan,Date.now());
    const adapters=await createManagedStagingBackupReaderAdapters({
      adminSession:session,readerDriver,
      expectedSourceSha:expectedSha,deviceId:measured.device_id,
    });
    result=await runGovernedStagingBackupReaderCensus({
      measuredIdentity:async()=>measured,expectedSha,runId,approval,
      trustedOwnerPublicKey,admin:adapters.admin,reader:adapters.reader,
      ledger,audit:gatedAudit,
    });
  }finally{
    if(session){
      try{
        if(typeof session.close!=="function")
          fail("MANAGED_READER_BROKER_SESSION_CLOSE_UNVERIFIED");
        await session.close();
      }catch{
        try{
          if(completion)await audit.append({...completion,status:"blocked",
            broker_session_closed:false});
          else await audit.append({event:"reader_broker_session_close_failed",
            run_id:runId,audit_ref:plan.plan_sha256,status:"blocked"});
        }catch{ /* Close failure already invalidates the run. */ }
        fail("MANAGED_READER_BROKER_SESSION_CLOSE_UNVERIFIED");
      }
    }
  }
  if(!completion||!result)fail("READER_GRANT_AUDIT_UNVERIFIED");
  try{await audit.append({...completion,broker_session_closed:true});}
  catch{fail("READER_GRANT_AUDIT_UNVERIFIED");}
  return result;
}
