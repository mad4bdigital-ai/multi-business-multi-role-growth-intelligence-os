import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {PLATFORM_ADMIN_WORKSPACE_AUTHORITY} from "./src/domain/authorityScope/platformAdminWorkspaceAuthority.generated.js";

const apiRoot=path.dirname(fileURLToPath(import.meta.url));
const descriptor=JSON.parse(fs.readFileSync(path.join(apiRoot,"config","platform-admin-workspace-authority.json"),"utf8"));
const lifecycle=JSON.parse(fs.readFileSync(path.join(apiRoot,"config","runtime-data-lifecycle-contract.json"),"utf8"));
const registry=JSON.parse(fs.readFileSync(path.join(apiRoot,"config","canonical-semantic-artifacts.json"),"utf8"));

assert.deepEqual(PLATFORM_ADMIN_WORKSPACE_AUTHORITY,descriptor);
const generated=spawnSync(process.execPath,["scripts/build-platform-admin-workspace-authority.mjs","--check"],{cwd:apiRoot,encoding:"utf8"});
assert.equal(generated.status,0,generated.stderr||generated.stdout);

const row=lifecycle.datasets.workspace_registry.canonical_rows[0];
assert.equal(row.authority_descriptor,"config/platform-admin-workspace-authority.json");
assert.equal(row.selector_tokens[0],descriptor.identity.workspace_id);
assert.equal(row.resolver_cardinality.tenant_id,descriptor.identity.tenant_id);
assert.equal(row.mutation_selector.update_where_equals.workspace_key,descriptor.identity.seed_workspace_key);
assert.equal(row.mutation_selector.update_where_equals.display_name,descriptor.identity.display_name);
assert.equal(row.mutation_selector.update_where_equals.workspace_type,descriptor.identity.workspace_type);
assert.equal(row.mutation_selector.update_where_equals.bootstrap_status,descriptor.identity.bootstrap_status);
assert.equal(row.resolver_cardinality.workspace_key,descriptor.resolver.candidate_workspace_key);
assert.equal(row.resolver_cardinality.authority_scope_key,descriptor.resolver.authority_scope_key);
assert.equal(row.resolver_cardinality.platform_admin_workspace,descriptor.resolver.platform_admin_workspace);

const artifact=registry.artifacts.find((item)=>item.artifact_key==="platform_admin_workspace");
assert.equal(artifact.authority_descriptor,"config/platform-admin-workspace-authority.json");
const seed=fs.readFileSync(path.join(apiRoot,descriptor.seed.source_file),"utf8");
assert.equal(crypto.createHash("sha256").update(seed).digest("hex"),artifact.sha256);
const resolverSource=fs.readFileSync(path.join(apiRoot,"src","infrastructure","authorityScope","platformAdminWorkspaceResolver.js"),"utf8");
const topologySource=fs.readFileSync(path.join(apiRoot,"src","domain","authorityScope","platformTopologyVerification.js"),"utf8");
const repairSource=fs.readFileSync(path.join(apiRoot,"stagingCanonicalSemanticRepair.js"),"utf8");
assert.match(resolverSource,/platformAdminWorkspaceAuthority\.generated\.js/u);
assert.doesNotMatch(resolverSource,/platformTopologyVerification\.js/u);
assert.match(topologySource,/platformAdminWorkspaceAuthority\.generated\.js/u);
assert.match(repairSource,/platformAdminWorkspaceAuthority\.generated\.js/u);
console.log("Platform Admin Workspace authority descriptor parity tests passed");
