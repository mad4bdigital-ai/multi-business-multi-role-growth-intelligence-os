import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {STAGING_ROLE_GRANT_POLICIES} from "./databasePrivilegeContracts.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const runner=fs.readFileSync(path.join(root,"autopilot-portable-staging","Repair-StagingCanonicalSemanticData.ps1"),"utf8");
assert.deepEqual(STAGING_ROLE_GRANT_POLICIES.runtime.required_operations_by_table.workspace_registry,["SELECT"]);
assert.match(runner,/repository_bound_local_staging_canonical_repair/u);
assert.match(runner,/artifact_key.*platform_admin_workspace/u);
assert.match(runner,/RUNTIME_DB_ROOT_PASSWORD/u);
assert.match(runner,/runtime-db mariadb --protocol=socket -uroot/u);
assert.match(runner,/--user=\$runtimeUser/u);
assert.match(runner,/caller_sql_forbidden/u);
assert.match(runner,/production_access_forbidden/u);
assert.doesNotMatch(runner,/\b(?:GRANT|CREATE\s+USER|ALTER\s+USER)\b/iu);
assert.doesNotMatch(runner,/Cloudflare|ssh|scp|curl|Invoke-WebRequest/iu);
console.log("Bounded local Staging canonical semantic repair runner contract passed");
