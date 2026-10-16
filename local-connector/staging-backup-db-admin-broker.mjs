// Local-only, purpose-scoped Staging MariaDB admin broker core.
// Never loaded by the web app, registered as an HTTP/shell/MCP route, or wired
// to a database principal implicitly. An independently installed OS-isolated
// process must own the pinned key, measured identity, atomic ledger, audit,
// and a dedicated admin client factory. This module provides no credentials.
import {
  planStagingBackupReaderGrant,verifySignedReaderGrantApproval,
  STAGING_BACKUP_READER_TABLES,
} from "../http-generic-api/stagingBackupReaderGrantLifecycle.mjs";

const CAPABILITY="staging.backup.reader.provision-census-revoke";
const SCHEMA="growth_runtime";
const USER="backup_policy_reader";
const ADMIN_USER="backup_grant_service";
const PRINCIPAL="'backup_policy_reader'@'172.18.%'";
const TABLES=Object.freeze([...STAGING_BACKUP_READER_TABLES].sort());
const IDENTITY_SQL="SELECT DATABASE() AS database_name,CURRENT_USER() AS identity";
const TABLE_SQL="SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME IN (?,?,?,?)";
const USER_SQL="SELECT COUNT(*) AS total FROM mysql.user WHERE User=?";
const CREATE_SQL="CREATE USER "+PRINCIPAL+" IDENTIFIED BY ?";
const SHOW_SQL="SHOW GRANTS FOR "+PRINCIPAL;
const DROP_SQL="DROP USER IF EXISTS "+PRINCIPAL;
const GRANT_SQL=new Map(TABLES.map(name=>[
  "GRANT SELECT ON `growth_runtime`.`"+name+"` TO "+PRINCIPAL,name,
]));
const ERR=(code)=>Object.assign(new Error(code),{code});
function requireBrokerDependencies(o){
  if(typeof o?.measureIdentity!=="function"||
    typeof o?.adminClientFactory!=="function"||
    typeof o?.reservation?.consumeOnce!=="function"||
    typeof o?.audit?.append!=="function"||
    !o?.pinnedOwnerPublicKey||!(/^[0-9a-f]{40}$/i).test(String(o?.sourceSha||""))||
    typeof o?.clock!=="function"||
    o?.isolatedStagingProcessAttested!==true)
    throw ERR("INDEPENDENT_DB_BROKER_TRUST_ROOT_REQUIRED");
}
function assertExactPlan(actual,expected){
  if(actual?.contract!==expected.contract||
    actual?.plan_sha256!==expected.plan_sha256||
    JSON.stringify(actual?.binding)!==JSON.stringify(expected.binding)||
    actual?.mode!=="plan_only"||
    actual?.production_mutation!==false)
    throw ERR("INDEPENDENT_DB_BROKER_EXACT_PLAN_REQUIRED");
}
function countArgs(sql,params=[],state){
  if(!Array.isArray(params))throw ERR("INDEPENDENT_DB_BROKER_SQL_DENIED");
  const noArgs=params.length===0;
  if(sql===IDENTITY_SQL&&noArgs)return "identity";
  if(sql===TABLE_SQL&&params.length===5&&params[0]===SCHEMA&&
    TABLES.every((name,i)=>params[i+1]===name))return "table_inventory";
  if(sql===USER_SQL&&params.length===1&&params[0]===USER)return "reader_presence";
  if(sql===CREATE_SQL&&params.length===1&&typeof params[0]==="string"&&
    params[0].length>=48&&!state.created){
    state.created=true;
    return "create_fixed_reader";
  }
  if(GRANT_SQL.has(sql)&&noArgs&&state.created){
    const name=GRANT_SQL.get(sql);
    if(state.grants.has(name))throw ERR("INDEPENDENT_DB_BROKER_SQL_REPLAY_DENIED");
    state.grants.add(name);
    return "grant_fixed_table_select";
  }
  if(sql===SHOW_SQL&&noArgs&&state.created)return "verify_fixed_grants";
  if(sql===DROP_SQL&&noArgs&&state.created){
    if(state.dropped)throw ERR("INDEPENDENT_DB_BROKER_SQL_REPLAY_DENIED");
    return "drop_fixed_reader";
  }
  throw ERR("INDEPENDENT_DB_BROKER_SQL_DENIED");
}
function validateAdminIdentity(result){
  if(!Array.isArray(result)||!Array.isArray(result[0])||
    result[0].length!==1||
    result[0][0]?.database_name!==SCHEMA||
    String(result[0][0]?.identity||"").split("@")[0]!==ADMIN_USER)
    throw ERR("INDEPENDENT_DB_BROKER_ADMIN_IDENTITY_DENIED");
}
export function createIndependentStagingBackupDbAdminBroker(options={}){
  requireBrokerDependencies(options);
  const {measureIdentity,adminClientFactory,reservation,audit,
    pinnedOwnerPublicKey,sourceSha,clock}=options;
  let occupied=false;
  return Object.freeze({
    capability_key:CAPABILITY,mode:"independent_local_staging_only",
    credentials_included:false,production_mutation:false,
    async openOneShotSession({capability_key,plan,approval}={}){
      if(occupied)throw ERR("INDEPENDENT_DB_BROKER_SESSION_BUSY");
      occupied=true;
      let client=null;
      try{
        if(capability_key!==CAPABILITY)
          throw ERR("INDEPENDENT_DB_BROKER_CAPABILITY_DENIED");
        // This identity must be measured by an OS-isolated service, NOT input
        // copied from the web app or a caller-supplied JSON attestation.
        const measured=await measureIdentity();
        const expected=planStagingBackupReaderGrant({
          measured,expectedSha:sourceSha,runId:plan?.binding?.run_id,
        });
        assertExactPlan(plan,expected);
        const nowMs=clock();
        verifySignedReaderGrantApproval({
          plan:expected,approval,trustedOwnerPublicKey:pinnedOwnerPublicKey,
          nowMs,
        });
        const expires=approval.expires_at_ms;
        await audit.append({event:"broker_open_attempt",
          run_id:expected.binding.run_id,audit_ref:expected.plan_sha256});
        if(await reservation.consumeOnce(
          expected.binding.run_id,expected.plan_sha256)!==true)
          throw ERR("INDEPENDENT_DB_BROKER_OPERATION_REPLAY");
        // Credentials must be resolved in the separately trusted local host
        // process; no default client, root, app pool or environment fallback.
        client=await adminClientFactory();
        if(typeof client?.query!=="function"||typeof client?.close!=="function")
          throw ERR("INDEPENDENT_DB_BROKER_CLIENT_INVALID");
        // The independently provisioned client must attest its ACTUAL endpoint;
        // SQL DATABASE()/CURRENT_USER() alone cannot distinguish a Staging DB
        // from an identically named Production schema or principal.
        const target=client.boundTarget;
        if(target?.host!=="runtime-db"||target?.port!==3306||
          target?.schema!==SCHEMA||
          target?.network!=="http-generic-api_default"||
          target?.environment!=="staging_local_windows_docker"||
          target?.device_id!==measured.device_id||
          target?.source_sha!==sourceSha||
          target?.independently_attested!==true||
          target?.no_production_mutation!==true)
          throw ERR("INDEPENDENT_DB_BROKER_ENDPOINT_ATTESTATION_REQUIRED");
        validateAdminIdentity(await client.query(IDENTITY_SQL));
        const ownedClient=client;
        let closed=false;
        const sqlState={created:false,dropped:false,grants:new Set()};
        const session=Object.freeze({
          authority:Object.freeze({
            capability_key:CAPABILITY,
            environment:"staging_local_windows_docker",
            source_sha:sourceSha,device_id:measured.device_id,
            db_host:"runtime-db",db_schema:SCHEMA,
            network:"http-generic-api_default",
            run_id:expected.binding.run_id,plan_sha256:expected.plan_sha256,
            issued_at_ms:nowMs,expires_at_ms:expires,
            no_production_mutation:true,
            independent_owner_signature_verified:true,
            redacts_query_parameters:true,
            single_use_ephemeral_session:true,
          }),
          async query(sql,params=[]){
            if(closed)throw ERR("INDEPENDENT_DB_BROKER_SESSION_CLOSED");
            const now=clock();
            // Even an expired session may DROP its exact temporary reader.
            if(now>=expires&&sql!==DROP_SQL)
              throw ERR("INDEPENDENT_DB_BROKER_SESSION_EXPIRED");
            const operation=countArgs(sql,params,sqlState);
            // Never audit raw SQL, bound credentials or arbitrary identifiers.
            await audit.append({event:"broker_sql_operation",
              run_id:expected.binding.run_id,
              audit_ref:expected.plan_sha256,operation});
            const result=await ownedClient.query(sql,params);
            if(operation==="drop_fixed_reader")sqlState.dropped=true;
            return result;
          },
          async close(){
            if(closed)throw ERR("INDEPENDENT_DB_BROKER_SESSION_ALREADY_CLOSED");
            closed=true;
            let cleanupVerified=false,clientClosed=false;
            try{
              // The broker independently cleans up even when the upstream
              // executor aborts before invoking its expected revoke routine.
              if(sqlState.created&&!sqlState.dropped){
                await ownedClient.query(DROP_SQL);
                sqlState.dropped=true;
              }
              const [rows]=await ownedClient.query(USER_SQL,[USER]);
              cleanupVerified=Array.isArray(rows)&&rows.length===1&&
                Number(rows[0]?.total)===0;
            }catch{cleanupVerified=false;}
            try{await ownedClient.close();clientClosed=true;}
            catch{clientClosed=false;}
            finally{occupied=false;}
            if(!cleanupVerified||!clientClosed){
              try{await audit.append({event:"broker_session_closed",
                run_id:expected.binding.run_id,
                audit_ref:expected.plan_sha256,
                status:"blocked",reader_absent:false});}
              catch{/* The failed cleanup already blocks all certification. */}
              throw ERR("INDEPENDENT_DB_BROKER_CLEANUP_UNVERIFIED");
            }
            await audit.append({event:"broker_session_closed",
              run_id:expected.binding.run_id,
              audit_ref:expected.plan_sha256,reader_absent:true});
          },
        });
        // Admin connection ownership has moved into the session.
        client=null;
        return session;
      }catch(e){
        if(client){
          try{await client.close();}catch{
            occupied=false;
            throw ERR("INDEPENDENT_DB_BROKER_CLIENT_CLEANUP_UNVERIFIED");
          }
        }
        occupied=false;
        throw e;
      }
    },
  });
}
