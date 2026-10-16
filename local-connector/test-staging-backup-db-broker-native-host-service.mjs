import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const source=fs.readFileSync(path.join(root,"local-connector",
  "staging-backup-db-broker-host-service.cs"),"utf8");
const build=fs.readFileSync(path.join(root,"autopilot-portable-staging",
  "Build-StagingBackupBrokerHostService.ps1"),"utf8");
const installer=fs.readFileSync(path.join(root,"autopilot-portable-staging",
  "Install-StagingBackupBrokerHostService.ps1"),"utf8");
for(const [label,regex] of [
 ["native SCM base",/class StagingBackupBrokerHost\s*:\s*ServiceBase/],
 ["correct named service",/Mad4B-Staging-Backup-Db-Broker/],
 ["native SCM only",/ServiceBase\.Run\(new StagingBackupBrokerHost\(\)\)/],
 ["no interactive service startup",/Environment\.UserInteractive/],
 ["non-privileged selftest",/operational_broker\\":false/],
 ["no authorized DBA",/db_admin_authorized\\":false/],
 ["source pin on install",/BROKER_REPOSITORY_HEAD_MISMATCH/],
 ["main pin on install",/BROKER_GITHUB_MAIN_MISMATCH/],
 ["deployed SHA pin",/BROKER_STAGING_DEPLOYMENT_NOT_CERTIFIED/],
 ["container source pin",/BROKER_STAGING_CONTAINER_MANIFEST_MISMATCH/],
 ["approved binary digest",/BROKER_COMPILED_BINARY_SHA256_MISMATCH/],
 ["virtual OS account",/NT SERVICE\\/],
 ["administrative OS check",/BROKER_WINDOWS_ADMINISTRATOR_REQUIRED/],
 ["explicit scope",/STAGING_INERT_SERVICE_ONLY_NO_DBA/],
 ["service start is disabled by default",/start= demand/],
 ["restricted ACL",/\/inheritance:r/],
 ["service stop on partial failure",/Stop-Service -Name \$serviceName/],
 ["no production",/production_mutation=\$false/]
]){
 const text=label==="native SCM base"||label==="correct named service"||
  label==="native SCM only"||label==="no interactive service startup"||
  label==="non-privileged selftest"||label==="no authorized DBA" ? source : installer;
 assert(regex.test(text),label);
}
assert(build.includes("/reference:"),"native ServiceProcess reference expected");
assert(build.includes("--self-test"),"compiled native host must self-test");
assert(!installer.includes("& $BinaryPath"),"elevated installer must not run a caller-supplied binary");
assert(installer.includes("installer_executed_binary=$false"),
  "read-only installer must disclose that it did not execute the binary");
const scmCreate=installer.split(/\r?\n/).find(line=>line.includes("& sc.exe create "));
assert(scmCreate,"dedicated virtual-account SCM registration expected");
assert(!scmCreate.includes("password="),
  "SCM virtual-account password must be null; PowerShell 5.1 drops empty native arguments");
assert(installer.includes("$scExit=$LASTEXITCODE"),
  "native sc.exe exit code must be captured before reporting failed registration");
assert(installer.includes("win32_code=$nativeCode"),
  "surface the sanitized Windows registration error code");
assert(installer.includes("ResumeInterruptedRegistration"),
  "leftover directory recovery must require a separate explicit switch");
for(const required of [
  "BROKER_INTERRUPTED_DIRECTORY_CONTENT_UNVERIFIED",
  "BROKER_INTERRUPTED_BINARY_HASH_MISMATCH",
  "BROKER_INTERRUPTED_DIRECTORY_ACL_UNVERIFIED",
  "BROKER_INSTALL_DIRECTORY_ALREADY_EXISTS_USE_EXPLICIT_RECOVERY"
])assert(installer.includes(required),"fail-closed partial-install guard missing: "+required);
for(const [label,regex] of [
 ["network",/\b(?:HttpListener|Socket|TcpClient|UdpClient|WebClient|HttpClient)\b/],
 ["SQL",/\b(?:SqlConnection|MySqlConnection|OleDbConnection|OdbcConnection)\b/],
 ["shell",/\bProcess\.Start\s*\(/],
 ["crypto key",/\b(?:PrivateKey|PFX|PemReader)\b/],
 ["file write",/\b(?:File|FileStream|Directory|StreamWriter)\.(?:Write|Create|Open)\w*\(/]
])assert(!regex.test(source),"native host may not acquire "+label);
for(const forbidden of [/\bsc\.exe\b/i,/\bStart-Service\b/i,/\bNew-Service\b/i,/\breg\.exe\b/i])
 assert(!forbidden.test(build),"build helper must not install services");
assert(installer.indexOf("BROKER_WINDOWS_ADMINISTRATOR_REQUIRED") <
 installer.indexOf("New-Item -ItemType Directory"),"administrator check before OS writes");
assert(installer.indexOf("BROKER_EXPLICIT_NO_DBA_SCOPE_REQUIRED") <
 installer.indexOf("New-Item -ItemType Directory"),"owner operation scope before writes");
assert(installer.indexOf("BROKER_STAGING_CONTAINER_MANIFEST_MISMATCH") <
 installer.indexOf("New-Item -ItemType Directory"),"exact runtime before writes");
console.log(JSON.stringify({
 contract:"mad4b.staging.backup-broker.native-host-service.test.v1",
 passed:true,source_static_only:true,service_binary_required:true,
 elevation_gate_before_write:true,scope_gate_before_write:true,
 no_http_or_sql_surface:true,production_mutation:false
}));
