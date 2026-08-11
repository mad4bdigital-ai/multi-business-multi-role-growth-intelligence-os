import assert from "node:assert/strict";

import { resolveGovernanceDbConfig } from "./governanceDb.js";
import {
  applyPlatformResourceAuthorityGrant,
  buildPlatformResourceAuthorityGrantPlan,
} from "./platformResourceAuthorityGrantTool.js";
import { createRepositoryMutationAuthorityBindingV6 } from "./repositoryGovernanceV6.js";

const runtimeOnly = {
  DB_HOST: "db.internal",
  DB_PORT: "3306",
  DB_NAME: "platform",
  DB_USER: "runtime_reader",
  DB_PASSWORD: "runtime-secret-value",
};

assert.throws(
  () => resolveGovernanceDbConfig(runtimeOnly),
  (error) => error?.code === "GOVERNANCE_DB_CONFIG_MISSING"
    && error?.details?.runtime_identity_fallback_allowed === false
    && error?.details?.governance_identity_required === true
    && error?.details?.secrets_included === false,
  "ordinary DB_USER/DB_PASSWORD must never satisfy resource-authority write authority",
);

const grantBase = {
  tenant_id: "00000000-0000-0000-0000-000000000000",
  workspace_id: "b50db01b-617e-4b7a-8bda-6bf4876f754f",
  user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
  resource_type: "github_repo",
  resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  recipe_key: "repo_patch_batch_apply",
  resource_ref: {
    branch: "gpt/resource-authority-writer-isolation-test",
    expected_commit_sha: "96af947ccc17d1ccee5c28c87fd975474283a81b",
  },
};

const grantDry = buildPlatformResourceAuthorityGrantPlan(grantBase);
let forbiddenRuntimePoolCalls = 0;
let grantWriterCalls = 0;
let grantBindingId = null;
const forbiddenRuntimePool = {
  async query() {
    forbiddenRuntimePoolCalls += 1;
    throw new Error("ordinary runtime pool must not be used by the resource-authority grant apply path");
  },
};
const grantWriterPool = {
  async query(sql, params = []) {
    grantWriterCalls += 1;
    if (/INSERT INTO platform_resource_authority_bindings/.test(sql)) {
      grantBindingId = params[0];
      return [{ affectedRows: 1 }];
    }
    if (/FROM platform_resource_authority_bindings/.test(sql)) {
      return [[{
        binding_id: grantBindingId,
        tenant_id: grantDry.tenant_id,
        workspace_id: grantDry.workspace_id,
        user_id: grantDry.user_id,
        resource_type: grantDry.resource_type,
        resource_uri: grantDry.resource_uri,
        recipe_key: grantDry.recipe_key,
        permission_level: grantDry.permission_level,
        allowed_modes_json: JSON.stringify(grantDry.allowed_modes),
        authority_source: grantDry.authority_source,
        resource_ref_json: JSON.stringify(grantDry.resource_ref),
        expires_at: "2026-08-11T12:00:00.000Z",
        status: "active",
        created_at: "2026-08-11T11:00:00.000Z",
      }]];
    }
    throw new Error(`Unexpected Governance writer query: ${sql}`);
  },
};

const grantApplied = await applyPlatformResourceAuthorityGrant({
  ...grantBase,
  mode: "apply",
  confirm: grantDry.expected_confirm,
  ttl_minutes: 30,
}, {
  pool: forbiddenRuntimePool,
  writerPool: grantWriterPool,
});
assert.equal(forbiddenRuntimePoolCalls, 0, "generic runtime pool injection must be ignored for authority writes");
assert.equal(grantWriterCalls, 2, "insert and same-cycle readback must use the Governance writer");
assert.equal(grantApplied.readback_verified, true);
assert.deepEqual(grantApplied.binding.principal, grantDry.principal);
assert.equal(grantApplied.binding.resource_uri, grantDry.resource_uri);
assert.equal(grantApplied.binding.recipe_key, grantDry.recipe_key);

const mismatchWriterPool = {
  async query(sql, params = []) {
    if (/INSERT INTO platform_resource_authority_bindings/.test(sql)) {
      grantBindingId = params[0];
      return [{ affectedRows: 1 }];
    }
    return [[{
      binding_id: grantBindingId,
      tenant_id: grantDry.tenant_id,
      workspace_id: grantDry.workspace_id,
      user_id: grantDry.user_id,
      resource_type: grantDry.resource_type,
      resource_uri: "github://wrong/repository",
      recipe_key: grantDry.recipe_key,
      permission_level: grantDry.permission_level,
      allowed_modes_json: JSON.stringify(grantDry.allowed_modes),
      authority_source: grantDry.authority_source,
      resource_ref_json: JSON.stringify(grantDry.resource_ref),
      status: "active",
    }]];
  },
};
await assert.rejects(
  () => applyPlatformResourceAuthorityGrant({
    ...grantBase,
    mode: "apply",
    confirm: grantDry.expected_confirm,
    ttl_minutes: 30,
  }, { writerPool: mismatchWriterPool }),
  (error) => error?.code === "platform_resource_authority_grant_readback_failed"
    && error?.details?.checks?.resource_uri === false
    && error?.details?.secrets_included === false,
  "same-cycle readback must fail closed when the persisted target differs",
);

const repositoryTenantId = "11111111-1111-4111-8111-111111111111";
const repositoryReadQueries = [];
const repositoryReadPool = {
  async query(sql) {
    repositoryReadQueries.push(sql);
    assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE)\b/i, "repository binding read pool must remain read-only");
    if (/FROM platform_resource_recipes/.test(sql)) {
      return [[{
        recipe_key: "repo.pr.comment_advisory",
        status: "active",
        risk_class: "mutation",
        read_only: 0,
        requires_capability_envelope: 1,
        requires_typed_confirmation: 1,
        requires_same_cycle_readback: 1,
      }]];
    }
    if (/FROM platform_resource_authority_bindings/.test(sql)) return [[]];
    throw new Error(`Unexpected runtime read query: ${sql}`);
  },
};

let repositoryBindingId = null;
let repositoryWriterCalls = 0;
const repositoryWriterPool = {
  async query(sql, params = []) {
    repositoryWriterCalls += 1;
    if (/INSERT INTO platform_resource_authority_bindings/.test(sql)) {
      repositoryBindingId = params[0];
      return [{ affectedRows: 1 }];
    }
    if (/FROM platform_resource_authority_bindings/.test(sql)) {
      return [[{
        binding_id: repositoryBindingId,
        tenant_id: repositoryTenantId,
        workspace_id: null,
        user_id: null,
        resource_type: "github_repo",
        resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
        resource_ref_json: JSON.stringify({ owner: "mad4bdigital-ai", repo: "multi-business-multi-role-growth-intelligence-os" }),
        recipe_key: "repo.pr.comment_advisory",
        permission_level: "comment",
        allowed_modes_json: JSON.stringify(["apply"]),
        authority_source: "platform_managed",
        source_system_id: null,
        source_installation_id: null,
        status: "active",
        created_by: "platform-admin-test",
      }]];
    }
    throw new Error(`Unexpected repository Governance writer query: ${sql}`);
  },
};

const repositoryBinding = await createRepositoryMutationAuthorityBindingV6({
  tenant_id: repositoryTenantId,
  owner: "mad4bdigital-ai",
  repo: "multi-business-multi-role-growth-intelligence-os",
  recipe_key: "repo.pr.comment_advisory",
  permission_level: "comment",
  authority_source: "platform_managed",
  created_by: "platform-admin-test",
}, {
  auth: { is_admin: true, user_id: "platform-admin-test" },
  readPool: repositoryReadPool,
  writerPool: repositoryWriterPool,
});
assert.equal(repositoryBinding.created, true);
assert.equal(repositoryWriterCalls, 2, "repository binding insert and exact readback must share the Governance writer");
assert.equal(repositoryReadQueries.length, 2, "runtime reader should only validate recipe and existing binding state");
assert.equal(repositoryBinding.binding.tenant_id, repositoryTenantId);
assert.equal(repositoryBinding.binding.resource_uri, "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os");
assert.equal(repositoryBinding.binding.recipe_key, "repo.pr.comment_advisory");

const repositoryMismatchWriter = {
  async query(sql, params = []) {
    if (/INSERT INTO platform_resource_authority_bindings/.test(sql)) {
      repositoryBindingId = params[0];
      return [{ affectedRows: 1 }];
    }
    return [[{
      binding_id: repositoryBindingId,
      tenant_id: "22222222-2222-4222-8222-222222222222",
      workspace_id: null,
      user_id: null,
      resource_type: "github_repo",
      resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      recipe_key: "repo.pr.comment_advisory",
      permission_level: "comment",
      allowed_modes_json: JSON.stringify(["apply"]),
      authority_source: "platform_managed",
      source_system_id: null,
      source_installation_id: null,
      status: "active",
    }]];
  },
};
await assert.rejects(
  () => createRepositoryMutationAuthorityBindingV6({
    tenant_id: repositoryTenantId,
    owner: "mad4bdigital-ai",
    repo: "multi-business-multi-role-growth-intelligence-os",
    recipe_key: "repo.pr.comment_advisory",
    permission_level: "comment",
    authority_source: "platform_managed",
  }, {
    auth: { is_admin: true, user_id: "platform-admin-test" },
    readPool: repositoryReadPool,
    writerPool: repositoryMismatchWriter,
  }),
  (error) => error?.code === "repository_mutation_binding_readback_failed"
    && error?.details?.checks?.tenant_id === false
    && error?.details?.secrets_included === false,
  "repository binding creation must fail closed on wrong-principal readback",
);

console.log("platform resource authority write authority isolation tests passed");
