// Static fail-closed regression for the optional, inert Staging host candidate.
// This is NOT a credential, grant, independent attestation or live Broker proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const filename=path.join(root,"http-generic-api","docker-compose.staging.backup-broker-preflight.yml");
const overlay=fs.readFileSync(filename,"utf8");
const officialDeploy=fs.readFileSync(path.join(root,"autopilot-portable-staging","Start-AutoPilot.ps1"),"utf8");
assert(!officialDeploy.includes("docker-compose.staging.backup-broker-preflight.yml"),
  "inert candidate overlay must never activate with standard Staging deployment");
const service=overlay.match(/^  backup-db-broker:\n([\s\S]+?)(?=^networks:)/m)?.[1];
const db=overlay.match(/^  runtime-db:\n([\s\S]+?)(?=^  backup-db-broker:)/m)?.[1];
assert(service&&db,"separate Staging candidate and runtime-db networks required");
const checks=[
  ['explicit opt-in profile',/profiles:\s*\["backup-broker-preflight"\]/],
  ['pinned base image',/image:\s*node:22-slim@sha256:[a-f0-9]{64}/],
  ['non-root user',/user:\s*"65534:65534"/],
  ['read-only root filesystem',/read_only:\s*true/],
  ['non-privileged mode',/privileged:\s*false/],
  ['all capabilities dropped',/cap_drop:\s*\[ALL\]/],
  ['privilege escalation disabled',/no-new-privileges:true/],
  ['dedicated internal network only',/networks:\s*\n\s+- backup-broker-internal\s*\n\s+ports:/],
  ['no published ports',/ports:\s*!reset\s*\[\]/],
  ['no mounted host files',/volumes:\s*!reset\s*\[\]/],
  ['fixed unprivileged mode',/MAD4B_BACKUP_BROKER_MODE:\s*host-candidate-only/],
  ['explicitly uncertified',/broker_operationally_certified:\s*false/],
  ['no admin client',/admin_client_configured:\s*false/],
  ['no owner approval',/owner_operation_approved:\s*false/],
  ['no database writes',/database_mutated:\s*false/],
  ['no production mutations',/production_mutation:\s*false/],
];
for(const [label,pattern] of checks)assert(pattern.test(service),label);
assert(/default:\s*\{\}/.test(db),"runtime DB must preserve default app network");
assert(/backup-broker-internal:/.test(db),"runtime DB must attach private broker network");
assert(/^  backup-broker-internal:\s*\n\s+driver:\s*bridge\s*\n\s+internal:\s*true/m.test(overlay),
  "candidate network must be Docker-internal");
for(const bad of [/DB_PASSWORD/i,/MARIADB_ROOT_PASSWORD/i,/docker\.sock/i,/network_mode:\s*host/i,/privileged:\s*true/i,/\.env\.staging/i,/CREATE\s+USER/i,/GRANT\s+SELECT/i]){
  assert(!bad.test(service),"candidate must not expose DB secrets, socket, SQL, or host network");
}
console.log(JSON.stringify({contract:"mad4b.staging-backup-broker-candidate-profile.test.v1",
  passed:true,synthetic_only:true,optional_profile:true,sidecar_certified:false,
  source_only:true,no_database_mutation:true,production_mutation:false}));
