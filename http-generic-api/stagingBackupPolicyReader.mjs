// Dedicated SELECT-only Staging backup-policy reader. Never reuses runtime_app
// or Control Plane writer credentials; no DDL, grants, approvals or exports.
const TABLES=Object.freeze(["platform_backup_policies","platform_backup_approvals",
  "platform_backup_runs","platform_copy_locations"]);
const SHA40=/^[0-9a-f]{40}$/i;
function fail(code){const error=new Error(code);error.code=code;throw error;}
function quoteRegex(text){return String(text).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}

export function resolveStagingBackupPolicyReaderConfig(env=process.env){
  if(env.NODE_ENV!=="staging" ||
     env.DEPLOYMENT_ENVIRONMENT!=="staging_local_windows_docker")
    fail("BACKUP_READER_STAGING_IDENTITY_REQUIRED");
  if(String(env.STAGING_BACKUP_POLICY_READER_ENABLED||"").toLowerCase()!=="true")
    fail("BACKUP_POLICY_READER_NOT_CONFIGURED");
  const host=String(env.STAGING_BACKUP_POLICY_READER_HOST||"").toLowerCase();
  const database=String(env.STAGING_BACKUP_POLICY_READER_DATABASE||"");
  const user=String(env.STAGING_BACKUP_POLICY_READER_USER||"");
  const password=String(env.STAGING_BACKUP_POLICY_READER_PASSWORD||"");
  const source=String(env.DEPLOY_COMMIT||"");
  if(host!=="runtime-db" || env.DB_HOST!=="runtime-db" ||
     !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(database) ||
     database!==env.DB_NAME ||
     !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(user) ||
     [env.DB_USER,env.CONTROL_PLANE_WRITE_DB_USER,"root","admin"]
       .some(v=>String(v||"").toLowerCase()===user.toLowerCase()) ||
     !password || /[\r\n]/.test(password) ||
     env.STAGING_BACKUP_POLICY_READER_PORT && env.STAGING_BACKUP_POLICY_READER_PORT!=="3306")
    fail("BACKUP_POLICY_READER_INDEPENDENT_IDENTITY_REQUIRED");
  if(!SHA40.test(source))fail("BACKUP_POLICY_READER_EXACT_SOURCE_REQUIRED");
  return Object.freeze({host,database,user,password,source,port:3306});
}

// Deny even schema-wide SELECT or a role with excess privileges. The exact
// four fixed tables are sufficient for P2 readback; no broad runtime grants.
export function verifyBackupPolicyReaderGrants(rows,database){
  if(!Array.isArray(rows) || rows.length<5)fail("BACKUP_POLICY_READER_GRANTS_UNVERIFIED");
  const accepted=new Set();
  const db=quoteRegex(database);
  const pattern=new RegExp("^GRANT SELECT ON \\x60?"+db+"\\x60?\\.\\x60?([a-z_]+)\\x60? TO .+$","i");
  for(const row of rows){
    const grant=String(Object.values(row??{})[0]??"");
    if(/^GRANT USAGE ON \*\.\* TO .+$/i.test(grant))continue;
    const match=grant.match(pattern);
    if(!match || !TABLES.includes(match[1].toLowerCase()) || /WITH GRANT OPTION/i.test(grant))
      fail("BACKUP_POLICY_READER_EXCESS_PRIVILEGES");
    accepted.add(match[1].toLowerCase());
  }
  if(TABLES.some(table=>!accepted.has(table)))
    fail("BACKUP_POLICY_READER_TABLE_GRANT_MISSING");
  return Object.freeze({verified:true,read_only:true,table_count:accepted.size});
}

export async function openStagingBackupPolicyReader({env=process.env,driver}={}){
  const cfg=resolveStagingBackupPolicyReaderConfig(env);
  if(!driver||typeof driver.createPool!=="function")fail("BACKUP_POLICY_READER_DRIVER_REQUIRED");
  const pool=driver.createPool({host:cfg.host,port:cfg.port,database:cfg.database,
    user:cfg.user,password:cfg.password,connectionLimit:1,waitForConnections:false,
    queueLimit:0,connectTimeout:5000,timezone:"Z"});
  try{
    const [identity]=await pool.query("SELECT DATABASE() AS database_name,CURRENT_USER() AS principal");
    const row=Array.isArray(identity)&&identity.length===1?identity[0]:null;
    if(row?.database_name!==cfg.database ||
      !String(row?.principal||"").toLowerCase().startsWith(cfg.user.toLowerCase()+"@"))
      fail("BACKUP_POLICY_READER_LIVE_IDENTITY_MISMATCH");
    const [grants]=await pool.query("SHOW GRANTS FOR CURRENT_USER()");
    verifyBackupPolicyReaderGrants(grants,cfg.database);
    return pool;
  }catch(error){
    await pool.end();
    if(error?.code?.startsWith("BACKUP_"))throw error;
    fail("BACKUP_POLICY_READER_CONNECTION_OR_GRANTS_UNVERIFIED");
  }
}
