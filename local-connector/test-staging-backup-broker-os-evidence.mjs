// Security regression for the Windows Staging-only OS evidence collector.
// Static checks run on CI without administrator access or side effects.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const src=fs.readFileSync(path.join(root,"autopilot-portable-staging",
  "Inspect-StagingBackupBrokerOsEvidence.ps1"),"utf8");
for(const required of [
  "BROKER_ELEVATED_READ_ONLY_MEASUREMENT_REQUIRED",
  "BROKER_STAGING_HOST_REQUIRED",
  "BROKER_EXACT_CERTIFIED_STAGING_SOURCE_MISMATCH",
  "Get-CimInstance Win32_Service",
  "Get-CimInstance Win32_Process",
  "BROKER_OS_SERVICE_BINARY_PATH_MISMATCH",
  "BROKER_OS_PROCESS_BINARY_PATH_UNVERIFIED",
  "Get-FileHash -LiteralPath $exe -Algorithm SHA256",
  "BROKER_OS_INSTALLED_BINARY_HASH_MISMATCH",
  "Get-Acl -LiteralPath $installDir",
  "Get-Acl -LiteralPath $exe",
  "AreAccessRulesProtected",
  "GetAccessRules",
  "Get-Item -LiteralPath $path -Force",
  "ReparsePoint",
  "BROKER_OS_DIRECTORY_ACE_COUNT_MISMATCH",
  "BROKER_OS_DIRECTORY_ACE_MISMATCH",
  "BROKER_OS_BINARY_FILE_ACL_UNVERIFIED",
  "sc.exe qsidtype",
  "SERVICE_SID_TYPE:",
  "2032127",
  "1179817",
  "independently_signed=$false",
  "externally_custodied=$false",
  "operational_broker_certified=$false",
  "db_admin_authorized=$false",
  "backup_executed=$false",
  "restore_executed=$false",
  "production_mutation=$false"
])assert(src.includes(required),"missing OS read-only evidence guard: "+required);
for(const forbidden of [
  /\b(?:Set-Acl|Set-ItemProperty|New-Item|Remove-Item|Copy-Item|Move-Item|Start-Service|Stop-Service|New-Service)\b/i,
  /&\s*(?:mariadb|mysql|sqlcmd)\b/i,
  /&\s*sc\.exe\s+(?:create|delete|config|start|stop|sidtype)\b/i,
  /&\s*docker\s+(?:run|exec|compose\s+up|stop|restart|rm)\b/i,
  /(?:CREATE\s+USER|GRANT\s+ALL|DROP\s+USER|ALTER\s+USER)/i,
  /Get-Content[^\n]*(?:private[_-]?key|secret|credential)/i
])assert(!forbidden.test(src),"OS evidence collector must be strictly read-only: "+forbidden);
assert(src.indexOf("BROKER_ELEVATED_READ_ONLY_MEASUREMENT_REQUIRED")<
  src.indexOf("Get-Acl -LiteralPath $installDir"),
  "elevation check must precede protected directory reads");
assert(src.indexOf("BROKER_EXACT_CERTIFIED_STAGING_SOURCE_MISMATCH")<
  src.indexOf("Get-FileHash -LiteralPath $exe -Algorithm SHA256"),
  "exact Staging certification must precede binary measurement");
console.log(JSON.stringify({
  contract:"mad4b.staging.backup-broker.os-evidence.test.v1",
  passed:true,
  static_ci_only:true,
  no_os_mutation:true,
  no_operational_certification:true,
  no_sql_or_dba:true,
  production_mutation:false
}));
