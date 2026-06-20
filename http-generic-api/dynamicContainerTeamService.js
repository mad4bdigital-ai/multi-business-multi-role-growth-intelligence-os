import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { stableSha256, validateNoSecretMetadata } from "./dynamicContainerAuthority.js";
import { invalidateContainerAuthorityCache } from "./dynamicContainerAuthorityResolver.js";
import {
  readIdempotentResult,
  storeIdempotentResult,
  withContainerAuthorityMutation
} from "./dynamicContainerAuthorityRepository.js";

const SUPPORTED_CONTAINER_TYPES = new Set(["workspace", "brand"]);
const MANAGED_ROLE_TEMPLATES = new Set(["container_viewer", "container_operator", "container_admin"]);
const ROLE_ALIASES = Object.freeze({
  viewer: "container_viewer",
  member: "container_viewer",
  container_viewer: "container_viewer",
  editor: "container_operator",
  operator: "container_operator",
  container_operator: "container_operator",
  owner: "container_admin",
  admin: "container_admin",
  container_admin: "container_admin"
});

function serviceError(status, code, message, details = []) {
  return Object.assign(new Error(message), { status, code, details });
}

function normalizeContainerType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SUPPORTED_CONTAINER_TYPES.has(normalized)) {
    throw serviceError(400, "container_team_type_invalid", "Team management is supported only for workspace and brand containers.");
  }
  return normalized;
}

function normalizeRoleTemplate(value) {
  const key = ROLE_ALIASES[String(value || "container_viewer").trim().toLowerCase()];
  if (!key || !MANAGED_ROLE_TEMPLATES.has(key)) {
    throw serviceError(422, "container_team_role_invalid", "Team role must resolve to container_viewer, container_operator, or container_admin.");
  }
  return key;
}

function normalizeInheritanceMode(value, containerType) {
  const fallback = containerType === "workspace" || containerType === "brand" ? "inherit_down" : "local_only";
  const normalized = String(value || fallback).trim().toLowerCase();
  if (!new Set(["local_only", "inherit_down"]).has(normalized)) {
    throw serviceError(422, "container_team_inheritance_invalid", "inheritanceMode must be local_only or inherit_down.");
  }
  return normalized;
}

function parseEpochTag(value) {
  if (value === undefined || value === null || value === "") return null;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function assertEpoch(expected, current) {
  if (expected !== null && Number(expected) !== Number(current)) {
    throw serviceError(409, "container_authority_epoch_changed", "Container authority epoch changed before the team mutation.", [{ expected, current }]);
  }
}

function assertNoSecret(value) {
  const check = validateNoSecretMetadata(value);
  if (!check.ok) {
    throw serviceError(422, "container_secret_field_forbidden", "Secret-like fields are forbidden in container team metadata.", check.violations);
  }
}

function requireIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (key.length < 8 || key.length > 128) {
    throw serviceError(400, "idempotency_key_invalid", "Idempotency-Key must contain 8 to 128 characters.");
  }
  return key;
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function resolveAccessibleContainer(executor, { principalId, containerType, containerRef }) {
  const normalizedType = normalizeContainerType(containerType);
  const ref = String(containerRef || "").trim();
  if (!ref) throw serviceError(400, "container_reference_required", "A workspace or brand reference is required.");
  const [rows] = await executor.query(
    `SELECT c.container_id,c.tenant_id,c.container_key,c.container_type_key,c.canonical_subject_type,
            c.canonical_subject_ref,c.display_name,c.status
       FROM containers c
       JOIN memberships m ON m.tenant_id=c.tenant_id AND m.user_id=? AND m.status='active'
      WHERE c.container_type_key=? AND c.status='active'
        AND (c.container_id=? OR c.container_key=? OR c.canonical_subject_ref=? OR c.container_key=CONCAT('brand:',?))
      ORDER BY CASE WHEN c.container_id=? THEN 0 WHEN c.canonical_subject_ref=? THEN 1 ELSE 2 END,c.container_id
      LIMIT 2`,
    [principalId,normalizedType,ref,ref,ref,ref,ref,ref]
  );
  if (!rows.length) throw serviceError(404, "container_not_found", "No active accessible workspace or brand container matched the reference.");
  if (rows.length > 1) throw serviceError(409, "container_reference_ambiguous", "Container reference matched more than one accessible container.");
  return rows[0];
}

async function readEffectiveRoleRank(executor, { tenantId, containerId, principalId }) {
  const [rows] = await executor.query(
    `SELECT COALESCE(MAX(rt.authority_rank),0) AS authority_rank
       FROM container_role_assignments a
       JOIN container_role_template_registry rt ON rt.role_template_key=a.role_template_key AND rt.status='active'
      WHERE a.tenant_id=? AND a.principal_type='user' AND a.principal_id=? AND a.status='active'
        AND (a.valid_from IS NULL OR a.valid_from<=UTC_TIMESTAMP())
        AND (a.valid_until IS NULL OR a.valid_until>UTC_TIMESTAMP())
        AND (a.container_id=? OR (a.inheritance_mode='inherit_down' AND EXISTS (
          SELECT 1 FROM container_closure cc
           WHERE cc.tenant_id=? AND cc.ancestor_container_id=a.container_id AND cc.descendant_container_id=?
        )))`,
    [tenantId,principalId,containerId,tenantId,containerId]
  );
  return Number(rows[0]?.authority_rank || 0);
}

async function assertContainerTeamAccess(executor, context, minimumRank) {
  const rank = await readEffectiveRoleRank(executor, context);
  if (rank < minimumRank) {
    throw serviceError(403, minimumRank >= 3 ? "container_team_admin_required" : "container_team_membership_required",
      minimumRank >= 3 ? "Effective container_admin authority is required." : "Effective container team membership is required.");
  }
  return rank;
}

async function resolveTargetUser(executor, { userId = null, email = null }) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedUserId && !normalizedEmail) {
    throw serviceError(400, "container_team_user_required", "userId or email is required.");
  }
  const [rows] = await executor.query(
    `SELECT user_id,email,display_name,status FROM users
      WHERE status='active' AND ((?<>'' AND user_id=?) OR (?<>'' AND LOWER(email)=?))
      LIMIT 2`,
    [normalizedUserId,normalizedUserId,normalizedEmail,normalizedEmail]
  );
  if (!rows.length) throw serviceError(404, "user_not_found", "No active registered user matched userId or email.");
  if (rows.length > 1) throw serviceError(409, "user_reference_ambiguous", "User reference matched more than one active user.");
  if (normalizedUserId && normalizedEmail && (rows[0].user_id !== normalizedUserId || String(rows[0].email).toLowerCase() !== normalizedEmail)) {
    throw serviceError(409, "user_reference_mismatch", "userId and email do not identify the same user.");
  }
  return rows[0];
}

async function readRoleTemplate(executor, { roleTemplateKey, containerType }) {
  const [rows] = await executor.query(
    `SELECT role_template_key,display_name,authority_rank,eligible_container_types_json
       FROM container_role_template_registry
      WHERE role_template_key=? AND status='active' LIMIT 1`,
    [roleTemplateKey]
  );
  const role = rows[0];
  if (!role) throw serviceError(422, "role_template_not_registered", "Container team role template is not active.");
  const eligibleTypes = parseJsonArray(role.eligible_container_types_json);
  if (eligibleTypes.length && !eligibleTypes.includes(containerType)) {
    throw serviceError(422, "container_team_role_invalid", "Role template is not eligible for this container type.");
  }
  return role;
}

async function ensureTargetTenantMembership(executor, { containerType, tenantId, userId }) {
  const [rows] = await executor.query(
    "SELECT user_id,role,status FROM memberships WHERE tenant_id=? AND user_id=? LIMIT 1 FOR UPDATE",
    [tenantId,userId]
  );
  const membership = rows[0] || null;
  if (containerType === "brand" && (!membership || membership.status !== "active")) {
    throw serviceError(409, "workspace_membership_required", "Brand team members must already have an active workspace or tenant membership.");
  }
  if (containerType === "workspace" && !membership) {
    await executor.query(
      "INSERT INTO memberships (user_id,tenant_id,role,status) VALUES (?,?,'member','active')",
      [userId,tenantId]
    );
    return { created:true,reactivated:false,role:"member" };
  }
  if (containerType === "workspace" && membership.status !== "active") {
    await executor.query(
      `UPDATE memberships
          SET status='active',role=IF(role IN ('owner','admin'),role,'member'),updated_at=NOW()
        WHERE tenant_id=? AND user_id=?`,
      [tenantId,userId]
    );
    return { created:false,reactivated:true,role:["owner","admin"].includes(membership.role) ? membership.role : "member" };
  }
  return { created:false,reactivated:false,role:membership?.role || null };
}

async function countOtherEffectiveAdmins(executor, { tenantId, containerId, excludedUserId }) {
  const [rows] = await executor.query(
    `SELECT COUNT(DISTINCT a.principal_id) AS admin_count
       FROM container_role_assignments a
       JOIN container_role_template_registry rt ON rt.role_template_key=a.role_template_key AND rt.status='active' AND rt.authority_rank>=3
      WHERE a.tenant_id=? AND a.principal_type='user' AND a.status='active'
        AND (a.valid_from IS NULL OR a.valid_from<=UTC_TIMESTAMP())
        AND (a.valid_until IS NULL OR a.valid_until>UTC_TIMESTAMP())
        AND (a.container_id=? OR (a.inheritance_mode='inherit_down' AND EXISTS (
          SELECT 1 FROM container_closure cc
           WHERE cc.tenant_id=? AND cc.ancestor_container_id=a.container_id AND cc.descendant_container_id=?
        )))
        AND NOT (a.container_id=? AND a.principal_id=?)`,
    [tenantId,containerId,tenantId,containerId,containerId,excludedUserId]
  );
  return Number(rows[0]?.admin_count || 0);
}

async function assertNotLastContainerAdmin(executor, { tenantId, containerId, targetUserId, nextRank }) {
  const [rows] = await executor.query(
    `SELECT COALESCE(MAX(rt.authority_rank),0) AS direct_rank
       FROM container_role_assignments a
       JOIN container_role_template_registry rt ON rt.role_template_key=a.role_template_key AND rt.status='active'
      WHERE a.tenant_id=? AND a.container_id=? AND a.principal_type='user' AND a.principal_id=? AND a.status='active'`,
    [tenantId,containerId,targetUserId]
  );
  const currentDirectRank = Number(rows[0]?.direct_rank || 0);
  if (currentDirectRank < 3 || Number(nextRank || 0) >= 3) return;
  const otherAdmins = await countOtherEffectiveAdmins(executor,{ tenantId,containerId,excludedUserId:targetUserId });
  if (otherAdmins < 1) {
    throw serviceError(409, "last_container_admin_required", "Cannot remove or demote the last effective container administrator.");
  }
}

function publicTeamMember(row) {
  return {
    userId:row.principal_id,
    email:row.email || null,
    displayName:row.display_name || null,
    roleTemplateKey:row.role_template_key,
    roleDisplayName:row.role_display_name || null,
    authorityRank:Number(row.authority_rank || 0),
    inheritanceMode:row.inheritance_mode,
    validFrom:row.valid_from || null,
    validUntil:row.valid_until || null,
    assignmentId:row.assignment_id,
    status:row.status
  };
}

export async function listCoWorkspaces({ principalId, limit = 50, cursor = null }, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const boundedLimit = Math.max(1,Math.min(100,Number(limit || 50)));
  const cursorValue = String(cursor || "");
  const [rows] = await pool.query(
    `SELECT c.container_id,c.tenant_id,c.container_key,c.canonical_subject_ref,c.display_name,
            wr.workspace_id,wr.workspace_key,wr.workspace_type,wr.bootstrap_status,wr.linked_brand_key,
            MAX(rt.authority_rank) AS effective_role_rank
       FROM containers c
       JOIN memberships m ON m.tenant_id=c.tenant_id AND m.user_id=? AND m.status='active'
       JOIN container_role_assignments a ON a.tenant_id=c.tenant_id AND a.principal_type='user' AND a.principal_id=? AND a.status='active'
       JOIN container_role_template_registry rt ON rt.role_template_key=a.role_template_key AND rt.status='active'
       LEFT JOIN workspace_registry wr ON wr.workspace_id=c.canonical_subject_ref
      WHERE c.container_type_key='workspace' AND c.status='active' AND (?='' OR c.container_id>?)
        AND (a.valid_from IS NULL OR a.valid_from<=UTC_TIMESTAMP())
        AND (a.valid_until IS NULL OR a.valid_until>UTC_TIMESTAMP())
        AND (a.container_id=c.container_id OR (a.inheritance_mode='inherit_down' AND EXISTS (
          SELECT 1 FROM container_closure cc
           WHERE cc.tenant_id=c.tenant_id AND cc.ancestor_container_id=a.container_id AND cc.descendant_container_id=c.container_id
        )))
      GROUP BY c.container_id,c.tenant_id,c.container_key,c.canonical_subject_ref,c.display_name,
               wr.workspace_id,wr.workspace_key,wr.workspace_type,wr.bootstrap_status,wr.linked_brand_key
      ORDER BY c.container_id
      LIMIT ?`,
    [principalId,principalId,cursorValue,cursorValue,boundedLimit+1]
  );
  const hasMore = rows.length > boundedLimit;
  const items = rows.slice(0,boundedLimit).map(row => ({
    containerId:row.container_id,
    tenantId:row.tenant_id,
    workspaceId:row.workspace_id || row.canonical_subject_ref,
    workspaceKey:row.workspace_key || row.container_key,
    displayName:row.display_name,
    workspaceType:row.workspace_type || null,
    bootstrapStatus:row.bootstrap_status || null,
    linkedBrandKey:row.linked_brand_key || null,
    effectiveRoleRank:Number(row.effective_role_rank || 0)
  }));
  return { ok:true,items,page:{ nextCursor:hasMore ? items.at(-1)?.containerId || null : null,hasMore },secretsIncluded:false };
}

export async function listContainerTeam({ principalId, containerType, containerRef }, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const container = await resolveAccessibleContainer(pool,{ principalId,containerType,containerRef });
  const effectiveRoleRank = await assertContainerTeamAccess(pool,{ tenantId:container.tenant_id,containerId:container.container_id,principalId },1);
  const [rows] = await pool.query(
    `SELECT a.assignment_id,a.principal_id,a.role_template_key,a.inheritance_mode,a.valid_from,a.valid_until,a.status,
            u.email,u.display_name,rt.display_name AS role_display_name,rt.authority_rank
       FROM container_role_assignments a
       LEFT JOIN users u ON u.user_id=a.principal_id
       LEFT JOIN container_role_template_registry rt ON rt.role_template_key=a.role_template_key
      WHERE a.tenant_id=? AND a.container_id=? AND a.principal_type='user' AND a.status='active'
        AND (a.valid_from IS NULL OR a.valid_from<=UTC_TIMESTAMP())
        AND (a.valid_until IS NULL OR a.valid_until>UTC_TIMESTAMP())
      ORDER BY rt.authority_rank DESC,u.display_name,a.principal_id,a.created_at`,
    [container.tenant_id,container.container_id]
  );
  const members=[];
  const seen=new Set();
  for(const row of rows){
    if(seen.has(row.principal_id)) continue;
    seen.add(row.principal_id);
    members.push(publicTeamMember(row));
  }
  return {
    ok:true,
    container:{
      containerId:container.container_id,tenantId:container.tenant_id,containerType:container.container_type_key,
      containerKey:container.container_key,canonicalSubjectRef:container.canonical_subject_ref,displayName:container.display_name
    },
    caller:{ userId:principalId,effectiveRoleRank,canManage:effectiveRoleRank>=3 },
    members,count:members.length,secretsIncluded:false
  };
}

async function returnIdempotentOrConflict(scopeKey, idempotencyKey, requestSha256, dependencies) {
  if (!idempotencyKey) return null;
  const read = dependencies.readIdempotency || readIdempotentResult;
  const existing = await read(scopeKey,idempotencyKey);
  if (!existing) return null;
  if (existing.request_sha256 !== requestSha256) {
    throw serviceError(409, "idempotency_key_conflict", "Idempotency-Key was already used with a different team mutation.");
  }
  return existing.response;
}

export async function setContainerTeamMember(input, options = {}, dependencies = {}) {
  assertNoSecret(input);
  const pool = dependencies.pool || getPool();
  const withMutation = dependencies.withMutation || withContainerAuthorityMutation;
  const readIdempotency = dependencies.readIdempotency || readIdempotentResult;
  const storeIdempotency = dependencies.storeIdempotency || storeIdempotentResult;
  const containerType = normalizeContainerType(input.containerType);
  const requestedRoleValue = input.roleTemplateKey ?? input.role;
  const roleTemplateKey = requestedRoleValue ? normalizeRoleTemplate(requestedRoleValue) : options.partial ? null : normalizeRoleTemplate("container_viewer");
  const inheritanceMode = input.inheritanceMode ? normalizeInheritanceMode(input.inheritanceMode,containerType) : options.partial ? null : normalizeInheritanceMode(null,containerType);
  const validUntilSpecified = Object.prototype.hasOwnProperty.call(input,"validUntil");
  const principalId = String(options.actorUserId || "").trim();
  if (!principalId) throw serviceError(401,"user_jwt_required","A signed user principal is required.");
  const idempotencyKey = options.requireIdempotency ? requireIdempotencyKey(options.idempotencyKey) : String(options.idempotencyKey || "").trim() || null;
  const preflightContainer = await resolveAccessibleContainer(pool,{ principalId,containerType,containerRef:input.containerRef });
  await assertContainerTeamAccess(pool,{ tenantId:preflightContainer.tenant_id,containerId:preflightContainer.container_id,principalId },3);
  const requestSha256 = stableSha256({
    actorUserId:principalId,containerType,containerId:preflightContainer.container_id,userId:input.userId || null,
    email:String(input.email || "").trim().toLowerCase() || null,roleTemplateKey,inheritanceMode,validUntil:input.validUntil || null
  });
  const scopeKey = `container-team:${preflightContainer.tenant_id}:${preflightContainer.container_id}`;
  const replay = await returnIdempotentOrConflict(scopeKey,idempotencyKey,requestSha256,{ readIdempotency });
  if (replay) return { ...replay,idempotentReplay:true };
  const expectedEpoch = parseEpochTag(options.ifMatch);
  const assignmentRef = randomUUID();
  const mutation = await withMutation({
    tenantId:preflightContainer.tenant_id,
    mutationType:"container_team_member_set",
    mutationRef:assignmentRef,
    affectedContainerId:preflightContainer.container_id,
    work:async (connection,currentEpoch) => {
      assertEpoch(expectedEpoch,currentEpoch);
      const container = await resolveAccessibleContainer(connection,{ principalId,containerType,containerRef:preflightContainer.container_id });
      await assertContainerTeamAccess(connection,{ tenantId:container.tenant_id,containerId:container.container_id,principalId },3);
      const targetUser = await resolveTargetUser(connection,{ userId:input.userId,email:input.email });
      const [existingRows] = await connection.query(
        `SELECT assignment_id,role_template_key,inheritance_mode,valid_until,metadata_json FROM container_role_assignments
          WHERE tenant_id=? AND container_id=? AND principal_type='user' AND principal_id=? AND status='active'
          ORDER BY created_at,assignment_id FOR UPDATE`,
        [container.tenant_id,container.container_id,targetUser.user_id]
      );
      if(options.partial && !existingRows.length) {
        throw serviceError(404,"container_team_member_not_found","No active direct team assignment was found for this user.");
      }
      const effectiveRoleTemplateKey = roleTemplateKey || existingRows[0]?.role_template_key || (options.partial ? null : "container_viewer");
      if(!effectiveRoleTemplateKey) {
        throw serviceError(422,"container_team_role_invalid","An explicit managed role is required for inline or legacy assignments.");
      }
      const effectiveInheritanceMode = inheritanceMode || existingRows[0]?.inheritance_mode || normalizeInheritanceMode(null,containerType);
      const effectiveValidUntil = validUntilSpecified ? (input.validUntil || null) : (existingRows[0]?.valid_until || null);
      const role = await readRoleTemplate(connection,{ roleTemplateKey:effectiveRoleTemplateKey,containerType });
      await assertNotLastContainerAdmin(connection,{
        tenantId:container.tenant_id,containerId:container.container_id,targetUserId:targetUser.user_id,nextRank:role.authority_rank
      });
      const tenantMembership = await ensureTargetTenantMembership(connection,{
        containerType,tenantId:container.tenant_id,userId:targetUser.user_id
      });
      const assignmentMetadata=JSON.stringify({
        ...parseJsonObject(existingRows[0]?.metadata_json),
        ...(input.metadata || {}),
        source:"container_team_management"
      });
      let assignmentId;
      if(existingRows.length){
        assignmentId=existingRows[0].assignment_id;
        await connection.query(
          `UPDATE container_role_assignments
              SET role_template_key=?,inline_permissions_json=NULL,inheritance_mode=?,valid_until=?,version=version+1,
                  issued_by=?,approved_by=?,metadata_json=?,updated_at=UTC_TIMESTAMP()
            WHERE assignment_id=?`,
          [effectiveRoleTemplateKey,effectiveInheritanceMode,effectiveValidUntil,principalId,principalId,assignmentMetadata,assignmentId]
        );
        if(existingRows.length>1){
          await connection.query(
            `UPDATE container_role_assignments SET status='revoked',version=version+1,updated_at=UTC_TIMESTAMP()
              WHERE assignment_id IN (${existingRows.slice(1).map(() => "?").join(",")})`,
            existingRows.slice(1).map(row => row.assignment_id)
          );
        }
      }else{
        assignmentId=randomUUID();
        await connection.query(
          `INSERT INTO container_role_assignments
            (assignment_id,tenant_id,container_id,principal_type,principal_id,role_template_key,inline_permissions_json,
             inheritance_mode,valid_from,valid_until,status,version,issued_by,approved_by,metadata_json)
           VALUES (?,?,?,'user',?,?,NULL,?,UTC_TIMESTAMP(),?,'active',1,?,?,?)`,
          [assignmentId,container.tenant_id,container.container_id,targetUser.user_id,effectiveRoleTemplateKey,effectiveInheritanceMode,effectiveValidUntil,
           principalId,principalId,assignmentMetadata]
        );
      }
      return {
        assignmentId,userId:targetUser.user_id,email:targetUser.email,displayName:targetUser.display_name,
        tenantId:container.tenant_id,containerId:container.container_id,containerType,roleTemplateKey:effectiveRoleTemplateKey,
        authorityRank:Number(role.authority_rank || 0),inheritanceMode:effectiveInheritanceMode,validUntil:effectiveValidUntil,status:"active",tenantMembership
      };
    }
  });
  invalidateContainerAuthorityCache(preflightContainer.tenant_id);
  const response={ ok:true,...mutation.result,authorityEpoch:mutation.authorityEpoch,idempotentReplay:false,secretsIncluded:false };
  if(idempotencyKey){
    await storeIdempotency({ scopeKey,idempotencyKey,requestSha256,resultType:"container_team_member",resultId:mutation.result.assignmentId,response,ttlMinutes:60 });
  }
  return response;
}

export async function removeContainerTeamMember(input, options = {}, dependencies = {}) {
  assertNoSecret(input);
  const pool = dependencies.pool || getPool();
  const withMutation = dependencies.withMutation || withContainerAuthorityMutation;
  const principalId = String(options.actorUserId || "").trim();
  if (!principalId) throw serviceError(401,"user_jwt_required","A signed user principal is required.");
  const containerType = normalizeContainerType(input.containerType);
  const targetUserId = String(input.userId || "").trim();
  if(!targetUserId) throw serviceError(400,"container_team_user_required","userId is required.");
  const preflightContainer = await resolveAccessibleContainer(pool,{ principalId,containerType,containerRef:input.containerRef });
  await assertContainerTeamAccess(pool,{ tenantId:preflightContainer.tenant_id,containerId:preflightContainer.container_id,principalId },3);
  const expectedEpoch=parseEpochTag(options.ifMatch);
  const mutation=await withMutation({
    tenantId:preflightContainer.tenant_id,mutationType:"container_team_member_remove",mutationRef:targetUserId,
    affectedContainerId:preflightContainer.container_id,
    work:async (connection,currentEpoch) => {
      assertEpoch(expectedEpoch,currentEpoch);
      const container=await resolveAccessibleContainer(connection,{ principalId,containerType,containerRef:preflightContainer.container_id });
      await assertContainerTeamAccess(connection,{ tenantId:container.tenant_id,containerId:container.container_id,principalId },3);
      await assertNotLastContainerAdmin(connection,{ tenantId:container.tenant_id,containerId:container.container_id,targetUserId,nextRank:0 });
      const [result]=await connection.query(
        `UPDATE container_role_assignments
            SET status='revoked',version=version+1,updated_at=UTC_TIMESTAMP()
          WHERE tenant_id=? AND container_id=? AND principal_type='user' AND principal_id=? AND status='active'`,
        [container.tenant_id,container.container_id,targetUserId]
      );
      if(!result.affectedRows) throw serviceError(404,"container_team_member_not_found","No active direct team assignment was found for this user.");
      return { userId:targetUserId,tenantId:container.tenant_id,containerId:container.container_id,containerType,status:"revoked",revokedAssignments:Number(result.affectedRows) };
    }
  });
  invalidateContainerAuthorityCache(preflightContainer.tenant_id);
  return { ok:true,...mutation.result,authorityEpoch:mutation.authorityEpoch,secretsIncluded:false };
}

export const _testingDynamicContainerTeamService={
  SUPPORTED_CONTAINER_TYPES,MANAGED_ROLE_TEMPLATES,normalizeContainerType,normalizeRoleTemplate,normalizeInheritanceMode,
  parseEpochTag,assertEpoch,requireIdempotencyKey,publicTeamMember
};
