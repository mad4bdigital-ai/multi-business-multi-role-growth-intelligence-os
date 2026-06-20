import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import {
  _testingDynamicContainerTeamService,
  listCoWorkspaces,
  listContainerTeam,
  removeContainerTeamMember,
  setContainerTeamMember
} from "./dynamicContainerTeamService.js";
import { _testingDynamicContainerTeamRoutes } from "./routes/dynamicContainerTeamRoutes.js";

const {
  normalizeContainerType,
  normalizeRoleTemplate,
  normalizeInheritanceMode,
  parseEpochTag,
  assertEpoch,
  requireIdempotencyKey
} = _testingDynamicContainerTeamService;

assert.equal(normalizeContainerType("WORKSPACE"),"workspace");
assert.equal(normalizeContainerType("brand"),"brand");
assert.throws(() => normalizeContainerType("tenant"),error => error.code === "container_team_type_invalid");
assert.equal(normalizeRoleTemplate("viewer"),"container_viewer");
assert.equal(normalizeRoleTemplate("editor"),"container_operator");
assert.equal(normalizeRoleTemplate("owner"),"container_admin");
assert.throws(() => normalizeRoleTemplate("platform_owner"),error => error.code === "container_team_role_invalid");
assert.equal(normalizeInheritanceMode(null,"workspace"),"inherit_down");
assert.equal(normalizeInheritanceMode("local_only","brand"),"local_only");
assert.throws(() => normalizeInheritanceMode("explicit_share","brand"),error => error.code === "container_team_inheritance_invalid");
assert.equal(parseEpochTag('W/"authority-17"'),17);
assert.equal(parseEpochTag(null),null);
assert.doesNotThrow(() => assertEpoch(7,7));
assert.throws(() => assertEpoch(7,8),error => error.code === "container_authority_epoch_changed");
assert.equal(requireIdempotencyKey("team-add-0001"),"team-add-0001");
assert.throws(() => requireIdempotencyKey("short"),error => error.code === "idempotency_key_invalid");
assert.throws(() => _testingDynamicContainerTeamRoutes.assertAllowedKeys({ unexpected:true },new Set()),error => error.code === "validation_error");

function assertPlaceholders(sql,params=[]) {
  const count=(String(sql).match(/\?/g) || []).length;
  assert.equal(count,params.length,`placeholder mismatch: ${String(sql).slice(0,120)}`);
}

const coWorkspacePool={
  query:async (sql,params=[]) => {
    assertPlaceholders(sql,params);
    assert.match(sql,/container_type_key='workspace'/);
    return [[
      { container_id:"workspace-container-1",tenant_id:"tenant-1",container_key:"workspace:one",canonical_subject_ref:"workspace-1",display_name:"Workspace One",workspace_id:"workspace-1",workspace_key:"one",workspace_type:"project",bootstrap_status:"ready",linked_brand_key:"brand-one",effective_role_rank:3 },
      { container_id:"workspace-container-2",tenant_id:"tenant-1",container_key:"workspace:two",canonical_subject_ref:"workspace-2",display_name:"Workspace Two",workspace_id:"workspace-2",workspace_key:"two",workspace_type:"campaign",bootstrap_status:"ready",linked_brand_key:"brand-two",effective_role_rank:2 }
    ]];
  }
};
const coWorkspaces=await listCoWorkspaces({ principalId:"actor-1",limit:1 },{ pool:coWorkspacePool });
assert.equal(coWorkspaces.items.length,1);
assert.equal(coWorkspaces.page.hasMore,true);
assert.equal(coWorkspaces.page.nextCursor,"workspace-container-1");
assert.equal(coWorkspaces.items[0].effectiveRoleRank,3);
assert.equal(coWorkspaces.secretsIncluded,false);

function accessibleContainer(type="workspace") {
  return {
    container_id:`${type}-container-1`,tenant_id:"tenant-1",container_key:type === "brand" ? "brand:brand-one" : "workspace-one",
    container_type_key:type,canonical_subject_type:type === "brand" ? "brand_target_key" : "workspace",
    canonical_subject_ref:type === "brand" ? "brand-one" : "workspace-1",display_name:type === "brand" ? "Brand One" : "Workspace One",status:"active"
  };
}

const teamPool={
  query:async (sql,params=[]) => {
    assertPlaceholders(sql,params);
    if(sql.includes("FROM containers c") && sql.includes("JOIN memberships m")) return [[accessibleContainer("workspace")]];
    if(sql.includes("COALESCE(MAX(rt.authority_rank),0) AS authority_rank")) return [[{ authority_rank:2 }]];
    if(sql.includes("LEFT JOIN users u") && sql.includes("a.container_id=?")) return [[
      { assignment_id:"assignment-admin",principal_id:"user-admin",role_template_key:"container_admin",inheritance_mode:"inherit_down",valid_from:null,valid_until:null,status:"active",email:"admin@example.com",display_name:"Admin User",role_display_name:"Container Admin",authority_rank:3 },
      { assignment_id:"assignment-viewer",principal_id:"user-viewer",role_template_key:"container_viewer",inheritance_mode:"local_only",valid_from:null,valid_until:null,status:"active",email:"viewer@example.com",display_name:"Viewer User",role_display_name:"Container Viewer",authority_rank:1 }
    ]];
    throw new Error(`Unexpected team list SQL: ${sql}`);
  }
};
const team=await listContainerTeam({ principalId:"actor-1",containerType:"workspace",containerRef:"workspace-1" },{ pool:teamPool });
assert.equal(team.count,2);
assert.equal(team.caller.canManage,false);
assert.equal(team.members[0].roleTemplateKey,"container_admin");
assert.equal(team.container.containerType,"workspace");

function makePreflightPool(type="workspace",actorRank=3) {
  return {
    query:async (sql,params=[]) => {
      assertPlaceholders(sql,params);
      if(sql.includes("FROM containers c") && sql.includes("JOIN memberships m")) return [[accessibleContainer(type)]];
      if(sql.includes("COALESCE(MAX(rt.authority_rank),0) AS authority_rank")) return [[{ authority_rank:actorRank }]];
      throw new Error(`Unexpected preflight SQL: ${sql}`);
    }
  };
}

function makeMutationHarness({ type="workspace",targetDirectRank=0,otherAdmins=1,membership=null,existingAssignments=[] }={}) {
  const calls=[];
  const connection={
    query:async (sql,params=[]) => {
      assertPlaceholders(sql,params);
      calls.push({ sql:String(sql),params });
      if(sql.includes("FROM containers c") && sql.includes("JOIN memberships m")) return [[accessibleContainer(type)]];
      if(sql.includes("COALESCE(MAX(rt.authority_rank),0) AS authority_rank")) return [[{ authority_rank:3 }]];
      if(sql.includes("FROM users") && sql.includes("status='active'")) return [[{ user_id:"target-user",email:"target@example.com",display_name:"Target User",status:"active" }]];
      if(sql.includes("FROM container_role_template_registry") && sql.includes("role_template_key=?")) {
        const role=params[0];
        const rank=role === "container_admin" ? 3 : role === "container_operator" ? 2 : 1;
        return [[{ role_template_key:role,display_name:role,authority_rank:rank,eligible_container_types_json:JSON.stringify(["workspace","brand"]) }]];
      }
      if(sql.includes("AS direct_rank")) return [[{ direct_rank:targetDirectRank }]];
      if(sql.includes("COUNT(DISTINCT a.principal_id) AS admin_count")) return [[{ admin_count:otherAdmins }]];
      if(sql.includes("FROM memberships") && sql.includes("FOR UPDATE")) return [[membership].filter(Boolean)];
      if(sql.startsWith("INSERT INTO memberships") || sql.startsWith("UPDATE memberships")) return [{ affectedRows:1 }];
      if(sql.includes("SELECT assignment_id FROM container_role_assignments")) return [existingAssignments];
      if(sql.startsWith("INSERT INTO container_role_assignments")) return [{ affectedRows:1 }];
      if(sql.startsWith("UPDATE container_role_assignments") && sql.includes("role_template_key=?")) return [{ affectedRows:1 }];
      if(sql.startsWith("UPDATE container_role_assignments") && sql.includes("status='revoked'")) return [{ affectedRows:existingAssignments.length || 1 }];
      throw new Error(`Unexpected mutation SQL: ${sql}`);
    }
  };
  const withMutation=async ({ work }) => ({ result:await work(connection,7),previousAuthorityEpoch:7,authorityEpoch:8,closure:null });
  return { connection,withMutation,calls };
}

const workspaceHarness=makeMutationHarness({ type:"workspace",membership:null });
let storedIdempotency=null;
const workspaceAdded=await setContainerTeamMember(
  { containerType:"workspace",containerRef:"workspace-1",email:"target@example.com",role:"admin",metadata:{ source:"client_attempt" } },
  { actorUserId:"actor-1",idempotencyKey:"workspace-add-0001",ifMatch:'W/"authority-7"',requireIdempotency:true },
  {
    pool:makePreflightPool("workspace"),
    withMutation:workspaceHarness.withMutation,
    readIdempotency:async () => null,
    storeIdempotency:async value => { storedIdempotency=value; }
  }
);
assert.equal(workspaceAdded.roleTemplateKey,"container_admin");
assert.equal(workspaceAdded.tenantMembership.created,true);
assert.equal(workspaceAdded.authorityEpoch,8);
assert.equal(storedIdempotency.resultType,"container_team_member");
assert(workspaceHarness.calls.some(call => call.sql.startsWith("INSERT INTO memberships")),"workspace add should bootstrap a least-privilege tenant membership");
const insertedAssignment=workspaceHarness.calls.find(call => call.sql.startsWith("INSERT INTO container_role_assignments"));
assert(insertedAssignment,"workspace add must create a direct container role assignment");
assert.match(String(insertedAssignment.params.at(-1)),/"source":"container_team_management"/);
assert.doesNotMatch(String(insertedAssignment.params.at(-1)),/client_attempt.*source/);

const partialHarness=makeMutationHarness({
  type:"workspace",
  targetDirectRank:2,
  otherAdmins:1,
  membership:{ user_id:"target-user",role:"member",status:"active" },
  existingAssignments:[{
    assignment_id:"assignment-existing",
    role_template_key:"container_operator",
    inheritance_mode:"local_only",
    valid_until:"2026-12-31 00:00:00"
  }]
});
const partialUpdated=await setContainerTeamMember(
  { containerType:"workspace",containerRef:"workspace-1",userId:"target-user",metadata:{ note:"metadata-only" } },
  { actorUserId:"actor-1",ifMatch:'W/"authority-7"',partial:true },
  { pool:makePreflightPool("workspace"),withMutation:partialHarness.withMutation }
);
assert.equal(partialUpdated.roleTemplateKey,"container_operator");
assert.equal(partialUpdated.inheritanceMode,"local_only");
assert.equal(partialUpdated.validUntil,"2026-12-31 00:00:00");
const partialUpdateCall=partialHarness.calls.find(call => call.sql.startsWith("UPDATE container_role_assignments") && call.sql.includes("role_template_key=?"));
assert.deepEqual(partialUpdateCall.params.slice(0,3),["container_operator","local_only","2026-12-31 00:00:00"]);

const brandHarness=makeMutationHarness({ type:"brand",membership:null });
await assert.rejects(
  () => setContainerTeamMember(
    { containerType:"brand",containerRef:"brand-one",userId:"target-user",role:"viewer" },
    { actorUserId:"actor-1",idempotencyKey:"brand-add-000001",requireIdempotency:true },
    { pool:makePreflightPool("brand"),withMutation:brandHarness.withMutation,readIdempotency:async () => null,storeIdempotency:async () => {} }
  ),
  error => error.code === "workspace_membership_required"
);

const lastAdminHarness=makeMutationHarness({ type:"brand",targetDirectRank:3,otherAdmins:0,membership:{ user_id:"target-user",role:"member",status:"active" } });
await assert.rejects(
  () => setContainerTeamMember(
    { containerType:"brand",containerRef:"brand-one",userId:"target-user",role:"viewer" },
    { actorUserId:"actor-1",idempotencyKey:"brand-demote-0001",requireIdempotency:true },
    { pool:makePreflightPool("brand"),withMutation:lastAdminHarness.withMutation,readIdempotency:async () => null,storeIdempotency:async () => {} }
  ),
  error => error.code === "last_container_admin_required"
);

const removeHarness=makeMutationHarness({ type:"workspace",targetDirectRank:1,otherAdmins:1,membership:{ user_id:"target-user",role:"member",status:"active" },existingAssignments:[{ assignment_id:"assignment-viewer" }] });
const removed=await removeContainerTeamMember(
  { containerType:"workspace",containerRef:"workspace-1",userId:"target-user" },
  { actorUserId:"actor-1",ifMatch:'W/"authority-7"' },
  { pool:makePreflightPool("workspace"),withMutation:removeHarness.withMutation }
);
assert.equal(removed.status,"revoked");
assert.equal(removed.revokedAssignments,1);
assert(!removeHarness.calls.some(call => /UPDATE memberships SET status='revoked'/.test(call.sql)),"workspace team removal must not revoke tenant membership");

await assert.rejects(
  () => listContainerTeam({ principalId:"actor-1",containerType:"workspace",containerRef:"workspace-1" },{ pool:makePreflightPool("workspace",0) }),
  error => error.code === "container_team_membership_required"
);

const routeSource=readFileSync("routes/dynamicContainerTeamRoutes.js","utf8");
const serviceSource=readFileSync("dynamicContainerTeamService.js","utf8");
for(const route of [
  "/me/co-workspaces",
  "/me/workspaces/:workspaceId",
  "/me/brands/:brandRef",
  "/team/members/:userId"
]) assert(routeSource.includes(route),`route source must include ${route}`);
assert.match(routeSource,/requireUserJwt/);
assert.match(routeSource,/idempotency-key/);
assert.match(routeSource,/if-match/);
assert.doesNotMatch(routeSource,/requireBackendApiKey/);
assert.doesNotMatch(serviceSource,/credential|access_token|refresh_token|providerClient|buildAuthorizedClient/i);
assert.match(serviceSource,/container_role_assignments/);
assert.match(serviceSource,/workspace_membership_required/);
assert.match(serviceSource,/last_container_admin_required/);
assert.doesNotMatch(serviceSource,/UPDATE memberships SET status='revoked'/);

const rootOpenApi=YAML.parse(readFileSync("openapi.yaml","utf8"));
assert.equal(rootOpenApi.openapi,"3.1.0");

console.log("dynamic container team management tests passed");
