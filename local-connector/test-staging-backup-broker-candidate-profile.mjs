// Inert, zero-network Docker candidate. Source-only and never DBA evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const overlay=fs.readFileSync(path.join(root,"http-generic-api","docker-compose.staging.backup-broker-preflight.yml"),"utf8");
const deploy=fs.readFileSync(path.join(root,"autopilot-portable-staging","Start-AutoPilot.ps1"),"utf8");
assert(!deploy.includes("docker-compose.staging.backup-broker-preflight.yml"),"default deploy must exclude the probe");
assert(!/^  runtime-db:/m.test(overlay),"overlay must not modify DB service");
assert(!/^networks:/m.test(overlay),"overlay must not create/attach Docker networks");
const preflight=fs.readFileSync(path.join(root,"autopilot-portable-staging",
  "Inspect-StagingBackupBrokerZeroDbImpact.ps1"),"utf8");
for(const [label,pattern] of [
  ["read-only Docker compose config",/docker compose @argsList config --format json/],
  ["every existing Compose service compared",/foreach\(\$key in \$existing\)/],
  ["live exact source SHA",/STAGING_SOURCE_SHA_MISMATCH/],
  ["fail-closed preflight",/if\(\$blockers.Count -gt 0\)\{exit 2\}/]
])assert(pattern.test(preflight),label);
for(const bad of [/\bdocker\s+(?:run|create|start|stop|rm|network\s+(?:connect|disconnect|create|rm))\b/iu,
 /\bdocker\s+compose\s+(?:up|down|run|start|stop|rm)\b/iu,
 /\bCREATE\s+USER\b/iu,/\bGRANT\s+SELECT\b/iu]){
 assert(!bad.test(preflight),"read-only preflight must not contain mutations");
}
const body=overlay.match(/^  backup-db-broker:\n([\s\S]+)$/m)?.[1];
assert(body,"candidate service missing");
const checks=[
 ["explicit opt-in profile",/profiles:\s*\["backup-broker-preflight"\]/],
 ["pinned base image",/image:\s*node:22-slim@sha256:[a-f0-9]{64}/],
 ["non-root identity",/user:\s*"65534:65534"/],
 ["read-only root filesystem",/read_only:\s*true/],
 ["not privileged",/privileged:\s*false/],
 ["capabilities dropped",/cap_drop:\s*\[ALL\]/],
 ["privilege escalation disabled",/no-new-privileges:true/],
 ["network disabled",/network_mode:\s*"none"/],
 ["no ports",/ports:\s*!reset\s*\[\]/],
 ["no mounted host files",/volumes:\s*!reset\s*\[\]/],
 ["non-root runtime guard",/process\.getuid\(\) === 0/],
 ["explicitly uncertified",/broker_operationally_certified:\s*false/],
 ["no admin client",/admin_client_configured:\s*false/],
 ["no owner approval",/owner_operation_approved:\s*false/],
 ["no DB mutations",/database_mutated:\s*false/],
 ["no production mutations",/production_mutation:\s*false/]
];
for(const [name,pattern] of checks)assert(pattern.test(body),name);
for(const forbidden of [
 /^\s*environment:/m,/^\s*depends_on:/m,/^\s*networks:/m,
 /network_mode:\s*host/i,/docker\.sock/i,/DB_PASSWORD/i,
 /MARIADB_ROOT_PASSWORD/i,/\.env\.staging/i,/CREATE\s+USER/i,/GRANT\s+SELECT/i
])assert(!forbidden.test(body),"unexpected credential, network, DB dependency or SQL");
console.log(JSON.stringify({
 contract:"mad4b.staging-backup-broker-candidate-profile.test.v2",
 passed:true,synthetic_only:true,network_disconnected:true,
 db_service_untouched:true,real_db_mutation:false,production_mutation:false
}));
