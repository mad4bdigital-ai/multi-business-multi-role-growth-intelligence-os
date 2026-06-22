import { Router } from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import jwt from "jsonwebtoken";
import { getPool } from "../db.js";
import { summarizeSessionIfNeeded } from "../sessionSummaryService.js";
import { runLiveResourceCoverageAudit } from "../resourceApiCoverageService.js";

const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";
const OWNER_ROLES = new Set(["owner", "admin"]);
const MANIFEST = JSON.parse(readFileSync(new URL("../resource-api-coverage.manifest.json", import.meta.url), "utf8"));
const MAX_PAGE_SIZE = 200;

const RESOURCES = Object.freeze({
  sessions: {
    table: "customer_sessions", id: "session_id", tenant: "tenant_id", user: "user_id",
    time: "COALESCE(r.archive_last_written_at,r.ended_at,r.started_at,r.created_at)",
    fields: `r.session_id,r.tenant_id,r.user_id,r.originator,r.brand_key,r.workspace_key,
      r.session_status,r.archive_status,r.turn_count,r.drive_doc_part_count,
      r.archive_last_written_at,r.started_at,r.ended_at,r.created_at`,
    search: ["r.session_id","r.originator","r.brand_key","r.workspace_key","r.session_status","r.archive_status"],
    filters: { status: "r.session_status", archive_status: "r.archive_status", brand_key: "r.brand_key", user_id: "r.user_id" },
    order: "COALESCE(r.archive_last_written_at,r.ended_at,r.started_at,r.created_at) DESC,r.id DESC",
    memberOwnOnly: true,
  },
  executions: {
    table: "execution_log", id: "id", tenant: "tenant_id", user: "user_id", time: "r.created_at",
    fields: `r.id,r.run_date,r.start_time,r.end_time,r.duration_seconds,r.entry_type,r.execution_class,
      r.source_layer,r.execution_mode,r.execution_status,LEFT(r.failure_reason,1000) AS failure_reason,
      r.recovery_status,r.tenant_id,r.workspace_id,r.workspace_key,r.user_id,r.brand_key,r.request_id,
      r.session_id,r.parent_action_key,r.endpoint_key,r.tool_key,r.app_key,r.agent_id,r.workflow_key,
      r.engine_key,r.resource_type,r.resource_id,r.correlation_id,r.created_at`,
    search: ["CAST(r.id AS CHAR)","r.execution_status","r.parent_action_key","r.endpoint_key","r.tool_key","r.workflow_key","r.app_key","r.correlation_id","r.failure_reason"],
    filters: { status: "r.execution_status", app_key: "r.app_key", workflow_key: "r.workflow_key", parent_action_key: "r.parent_action_key", session_id: "r.session_id" },
    order: "r.created_at DESC,r.id DESC",
  },
  assets: {
    table: "workspace_assets", id: "asset_id", tenant: "tenant_id", user: "created_by", time: "r.updated_at",
    fields: `r.asset_id,r.tenant_id,r.vault_id,r.asset_type,r.asset_ref,r.display_name,r.brand_ref,
      r.site_ref,r.workflow_ref,r.session_ref,r.visibility,r.lifecycle_status,r.created_by,r.created_at,r.updated_at`,
    search: ["r.asset_id","r.asset_ref","r.display_name","r.brand_ref","r.site_ref","r.workflow_ref","r.session_ref"],
    filters: { status: "r.lifecycle_status", asset_type: "r.asset_type", brand_ref: "r.brand_ref", visibility: "r.visibility" },
    order: "r.updated_at DESC,r.asset_id DESC", mutable: true,
  },
  approvals: {
    table: "approval_holds", id: "hold_id", tenant: "tenant_id", user: "user_id",
    time: "COALESCE(r.decided_at,r.created_at)",
    fields: `r.hold_id,r.run_id,r.step_run_id,r.tenant_id,r.workspace_id,r.workspace_key,r.hold_type,
      r.requested_by,r.user_id,r.actor_id,r.actor_type,r.brand_key,r.request_id,r.session_id,r.correlation_id,
      r.assigned_to,r.required_role,r.status,r.decision_by,r.decision_note,r.expires_at,r.decided_at,r.created_at`,
    search: ["r.hold_id","r.run_id","r.hold_type","r.requested_by","r.assigned_to","r.required_role","r.status","r.session_id","r.correlation_id"],
    filters: { status: "r.status", hold_type: "r.hold_type", assigned_to: "r.assigned_to", session_id: "r.session_id" },
    order: "COALESCE(r.decided_at,r.created_at) DESC,r.id DESC",
  },
});

function err(code, message, details) {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) }, secrets_included: false };
}
function replyError(res, error, fallback) {
  return res.status(Number(error.status) || 500).json(err(error.code || fallback, error.message));
}
function descriptor(key) { return RESOURCES[String(key || "").trim()] || null; }
function pageSize(value, fallback = 50) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, MAX_PAGE_SIZE);
}
function encodeToken(row, d) {
  return Buffer.from(JSON.stringify({ id: String(row[d.id]), time: row.updated_at || row.created_at || row.archive_last_written_at || row.decided_at || row.started_at || null })).toString("base64url");
}
function decodeToken(value) {
  if (!value) return null;
  try { return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")); }
  catch {
    const error = new Error("Invalid pageToken."); error.status = 400; error.code = "invalid_page_token"; throw error;
  }
}
function verifyJwt(header) {
  if (!header?.startsWith("Bearer ")) return null;
  try { return jwt.verify(header.slice(7), JWT_SECRET); } catch { return null; }
}
function requireUser(req, res, next) {
  const auth = req.auth?.mode === "user_jwt" ? req.auth : verifyJwt(req.headers.authorization);
  if (!auth?.user_id) return res.status(401).json(err("user_jwt_required", "Sign in required."));
  req.auth = { mode: "user_jwt", user_id: auth.user_id, tenant_id: auth.tenant_id || null, is_admin: false };
  return next();
}
async function membership(req, res, tenantId) {
  const [rows] = await getPool().query(
    `SELECT m.user_id,m.tenant_id,m.role,m.status,t.status AS tenant_status
       FROM memberships m JOIN tenants t ON t.tenant_id=m.tenant_id
      WHERE m.user_id=? AND m.tenant_id=? LIMIT 1`,
    [req.auth.user_id, tenantId]
  );
  const row = rows[0];
  if (!row || row.status !== "active" || row.tenant_status !== "active") {
    res.status(403).json(err("active_membership_required", "Active workspace membership required."));
    return null;
  }
  return row;
}
function isOwner(role) { return OWNER_ROLES.has(String(role || "").toLowerCase()); }
function capabilities(key, { admin = false, member = null, item = null, auth = null } = {}) {
  if (admin) return { canRead: true, canSearch: true, canCreate: key === "assets", canUpdate: key === "assets", canArchive: key === "assets", canRestore: key === "assets", canManagePermissions: true, canPurge: false };
  const owner = isOwner(member?.role);
  const assetOwner = key === "assets" && item?.created_by === auth?.user_id;
  return { canRead: true, canSearch: true, canCreate: key === "assets", canUpdate: key === "assets" && (owner || assetOwner), canArchive: key === "assets" && (owner || assetOwner), canRestore: key === "assets" && owner, canManagePermissions: owner, canPurge: false };
}
function wrap(key, item, caps) {
  const d = descriptor(key);
  return { id: String(item[d.id]), resourceKey: key, data: item, capabilities: caps, version: item.updated_at || item.created_at || item.archive_last_written_at || item.decided_at || null };
}
function tenantContext(req, member) { return { tenantId: req.params.tenant_id, member, auth: req.auth }; }

function queryParts(d, query, context = null) {
  const params = [], clauses = [];
  if (context) {
    clauses.push(`r.${d.tenant}=?`); params.push(context.tenantId);
    if (d.memberOwnOnly && !isOwner(context.member.role)) {
      clauses.push(`r.${d.user}=?`); params.push(context.auth.user_id);
    }
  } else {
    if (query.tenant_id) { clauses.push(`r.${d.tenant}=?`); params.push(String(query.tenant_id).slice(0,128)); }
    if (query.user_id) { clauses.push(`r.${d.user}=?`); params.push(String(query.user_id).slice(0,128)); }
  }
  for (const [input, column] of Object.entries(d.filters || {})) {
    if (query[input] === undefined || query[input] === "") continue;
    clauses.push(`${column}=?`); params.push(String(query[input]).slice(0,255));
  }
  const term = String(query.q || "").trim();
  if (term && d.search.length) {
    const pattern = `%${term.slice(0,200).replace(/[%_]/g, "\\$&")}%`;
    clauses.push(`(${d.search.map((field) => `${field} LIKE ? ESCAPE '\\\\'`).join(" OR ")})`);
    d.search.forEach(() => params.push(pattern));
  }
  const token = decodeToken(query.pageToken);
  if (token?.time) { clauses.push(`${d.time}<?`); params.push(token.time); }
  return { clauses, params };
}
async function list(key, query, context = null) {
  const d = descriptor(key); if (!d) return null;
  const { clauses, params } = queryParts(d, query, context);
  const limit = pageSize(query.pageSize || query.limit);
  params.push(limit + 1);
  const [rows] = await getPool().query(
    `SELECT ${d.fields} FROM ${d.table} r ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ${d.order} LIMIT ?`,
    params
  );
  const more = rows.length > limit, items = more ? rows.slice(0, limit) : rows;
  return { items, count: items.length, nextPageToken: more ? encodeToken(items.at(-1), d) : null };
}
async function get(key, id, context = null) {
  const d = descriptor(key); if (!d) return null;
  const params = [String(id)], clauses = [`r.${d.id}=?`];
  if (context) {
    clauses.push(`r.${d.tenant}=?`); params.push(context.tenantId);
    if (d.memberOwnOnly && !isOwner(context.member.role)) { clauses.push(`r.${d.user}=?`); params.push(context.auth.user_id); }
  }
  const [rows] = await getPool().query(`SELECT ${d.fields} FROM ${d.table} r WHERE ${clauses.join(" AND ")} LIMIT 1`, params);
  return rows[0] || null;
}
async function createAsset(tenantId, auth, body = {}) {
  if (!body.asset_type || !body.display_name) {
    const error = new Error("asset_type and display_name are required."); error.status = 400; error.code = "asset_fields_required"; throw error;
  }
  const id = String(body.asset_id || randomUUID()).slice(0,64);
  await getPool().query(
    `INSERT INTO workspace_assets
      (asset_id,tenant_id,vault_id,asset_type,asset_ref,display_name,brand_ref,site_ref,workflow_ref,session_ref,visibility,lifecycle_status,metadata_json,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,tenantId,body.vault_id || null,String(body.asset_type),body.asset_ref || null,String(body.display_name),body.brand_ref || null,body.site_ref || null,body.workflow_ref || null,body.session_ref || null,body.visibility || "workspace",body.lifecycle_status || "active",body.metadata_json && typeof body.metadata_json === "object" ? JSON.stringify(body.metadata_json) : null,auth.user_id || "platform_admin"]
  );
  return id;
}
async function updateAsset(id, body, context = null, admin = false) {
  const item = await get("assets", id, context); if (!item) return null;
  if (!capabilities("assets",{ admin, member: context?.member, item, auth: context?.auth }).canUpdate) {
    const error = new Error("Asset update is not permitted."); error.status = 403; error.code = "asset_update_forbidden"; throw error;
  }
  const allowed = ["display_name","asset_ref","brand_ref","site_ref","workflow_ref","session_ref","visibility","lifecycle_status"];
  const sets = [], params = [];
  for (const field of allowed) if (body[field] !== undefined) { sets.push(`${field}=?`); params.push(body[field] === null ? null : String(body[field]).slice(0,512)); }
  if (body.metadata_json && typeof body.metadata_json === "object") { sets.push("metadata_json=?"); params.push(JSON.stringify(body.metadata_json)); }
  if (!sets.length) { const error = new Error("No supported fields were supplied."); error.status = 400; error.code = "no_supported_update_fields"; throw error; }
  params.push(id); await getPool().query(`UPDATE workspace_assets SET ${sets.join(",")},updated_at=NOW() WHERE asset_id=?`,params); return id;
}
async function lifecycleAsset(id, state, context = null, admin = false) {
  const item = await get("assets", id, context); if (!item) return null;
  const caps = capabilities("assets",{ admin, member: context?.member, item, auth: context?.auth });
  if (!(state === "archived" ? caps.canArchive : caps.canRestore)) {
    const error = new Error(`Asset ${state} is not permitted.`); error.status = 403; error.code = "asset_lifecycle_forbidden"; throw error;
  }
  await getPool().query("UPDATE workspace_assets SET lifecycle_status=?,updated_at=NOW() WHERE asset_id=?",[state,id]); return id;
}
async function revisions(key, id, context = null) {
  const item = await get(key,id,context); if (!item) return null;
  if (key !== "sessions") return { supported: false, revisions: [] };
  const params = [id]; let scope = "";
  if (context) { scope = " AND tenant_id=?"; params.push(context.tenantId); }
  const [rows] = await getPool().query(
    `SELECT summary_id AS revision_id,created_at,analyzed_at,analyzed,turn_count,complexity,session_model
       FROM session_summaries WHERE session_id=?${scope} ORDER BY created_at DESC LIMIT 100`,params);
  return { supported: true, revisions: rows };
}
async function changes(key, query, context = null, id = null) {
  if (id) {
    const item = await get(key,id,context);
    return { items: item ? [{ resourceKey:key,resourceId:String(id),changedAt:item.updated_at || item.created_at || item.archive_last_written_at || item.decided_at || item.started_at || null,changeType:"snapshot" }] : [], nextPageToken:null };
  }
  const page = await list(key,{...query,pageSize:query.pageSize || 100},context);
  if (!page) return null;
  const d = descriptor(key);
  return { ...page, items: page.items.map((item) => ({ resourceKey:key,resourceId:String(item[d.id]),changedAt:item.updated_at || item.created_at || item.archive_last_written_at || item.decided_at || item.started_at || null,changeType:"upsert" })) };
}
async function sessionSummary(id) {
  const session = await get("sessions",id); if (!session) return null;
  const [rows] = await getPool().query(
    `SELECT summary_id,session_id,summary_text,tasks_completed,blockers,feature_requests,integration_needs,
            complexity,session_model,turn_count,analyzed,analyzed_at,created_at
       FROM session_summaries WHERE session_id=? ORDER BY created_at DESC LIMIT 1`,[id]);
  return { session, summary:rows[0] || null };
}
async function sessionTurns(id, query = {}) {
  const session = await get("sessions",id); if (!session) return null;
  const limit = pageSize(query.pageSize || query.limit), after = Math.max(-1,Number.parseInt(String(query.after || "-1"),10) || -1);
  const params=[id,after]; let role="";
  if (query.role) { role=" AND role=?"; params.push(String(query.role).slice(0,32)); }
  params.push(limit+1);
  const [rows]=await getPool().query(
    `SELECT turn_id,turn_index,role,content_preview,content_sha256,storage_mode,action_key,drive_doc_part,drive_anchor,created_at
       FROM gpt_session_turns WHERE session_id=? AND turn_index>?${role} ORDER BY turn_index ASC LIMIT ?`,params);
  const more=rows.length>limit,items=more?rows.slice(0,limit):rows;
  return { session,items,nextAfter:more?items.at(-1).turn_index:null };
}
async function sessionEvents(id,query={}) {
  const session=await get("sessions",id); if(!session)return null;
  const params=[id]; let filter="";
  if(query.event_type){filter=" AND event_type=?";params.push(String(query.event_type).slice(0,128));}
  params.push(pageSize(query.pageSize || query.limit));
  const [rows]=await getPool().query(
    `SELECT event_id,session_id,turn_id,record_type,event_type,tool_name,status,payload_preview,payload_sha256,
            redaction_status,event_timestamp,created_at
       FROM session_events WHERE session_id=?${filter} ORDER BY COALESCE(event_timestamp,created_at) DESC,id DESC LIMIT ?`,params);
  return {session,items:rows};
}
function authorizedSession(result, req) {
  const admin = Boolean(req.auth?.is_admin || req.auth?.mode === "backend_api_key");
  return admin || !result?.session?.user_id || result.session.user_id === req.auth?.user_id;
}

export function buildResourceApiRoutes(deps={}) {
  const router=Router(), requireBackend=deps.requireBackendApiKey || ((req,res,next)=>next()), requireAdmin=deps.requireAdminPrincipal || ((req,res,next)=>next());

  router.get("/admin/resource-types",requireBackend,requireAdmin,(req,res)=>res.json({ok:true,resources:MANIFEST.resources,count:MANIFEST.resources.length,policy:MANIFEST.new_feature_gate,secrets_included:false}));
  router.get("/admin/resource-types/:resourceKey",requireBackend,requireAdmin,(req,res)=>{
    const resource=MANIFEST.resources.find((row)=>row.resource_key===req.params.resourceKey);
    return resource?res.json({ok:true,resource,capabilities:capabilities(resource.resource_key,{admin:true}),secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));
  });
  router.get("/admin/resources/:resourceKey",requireBackend,requireAdmin,async(req,res)=>{
    try{const page=await list(req.params.resourceKey,req.query);return page?res.json({ok:true,resourceKey:req.params.resourceKey,...page,secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));}catch(e){return replyError(res,e,"resource_list_failed");}
  });
  router.get("/admin/resources/:resourceKey/:resourceId",requireBackend,requireAdmin,async(req,res)=>{
    try{const item=await get(req.params.resourceKey,req.params.resourceId);return item?res.json({ok:true,resource:wrap(req.params.resourceKey,item,capabilities(req.params.resourceKey,{admin:true,item})),secrets_included:false}):res.status(404).json(err("resource_not_found","Resource not found."));}catch(e){return replyError(res,e,"resource_get_failed");}
  });
  router.post("/admin/resources/:resourceKey",requireBackend,requireAdmin,async(req,res)=>{
    try{if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Create is not enabled for this resource."));if(!req.body?.tenant_id)return res.status(400).json(err("tenant_id_required","tenant_id is required."));const id=await createAsset(req.body.tenant_id,{user_id:req.auth?.user_id || "platform_admin"},req.body);const item=await get("assets",id);return res.status(201).json({ok:true,resource:wrap("assets",item,capabilities("assets",{admin:true,item})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"resource_create_failed");}
  });
  router.patch("/admin/resources/:resourceKey/:resourceId",requireBackend,requireAdmin,async(req,res)=>{
    try{if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Update is not enabled for this resource."));const id=await updateAsset(req.params.resourceId,req.body || {},null,true);if(!id)return res.status(404).json(err("resource_not_found","Resource not found."));const item=await get("assets",id);return res.json({ok:true,resource:wrap("assets",item,capabilities("assets",{admin:true,item})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"resource_update_failed");}
  });
  router.delete("/admin/resources/:resourceKey/:resourceId",requireBackend,requireAdmin,async(req,res)=>{
    try{if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Archive is not enabled for this resource."));const id=await lifecycleAsset(req.params.resourceId,"archived",null,true);if(!id)return res.status(404).json(err("resource_not_found","Resource not found."));const item=await get("assets",id);return res.json({ok:true,resource:wrap("assets",item,capabilities("assets",{admin:true,item})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"resource_archive_failed");}
  });
  router.post("/admin/resources/:resourceKey/:resourceId/restore",requireBackend,requireAdmin,async(req,res)=>{
    try{if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Restore is not enabled for this resource."));const id=await lifecycleAsset(req.params.resourceId,"active",null,true);if(!id)return res.status(404).json(err("resource_not_found","Resource not found."));const item=await get("assets",id);return res.json({ok:true,resource:wrap("assets",item,capabilities("assets",{admin:true,item})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"resource_restore_failed");}
  });
  router.post("/admin/resources/:resourceKey/:resourceId/purge",requireBackend,requireAdmin,(req,res)=>res.status(409).json(err("purge_not_enabled","Hard purge is disabled. Use governed archive and retention policies.")));
  router.get("/admin/resources/:resourceKey/:resourceId/permissions",requireBackend,requireAdmin,async(req,res)=>{
    try{const item=await get(req.params.resourceKey,req.params.resourceId);return item?res.json({ok:true,resourceKey:req.params.resourceKey,resourceId:req.params.resourceId,capabilities:capabilities(req.params.resourceKey,{admin:true,item}),authority:"platform_admin",secrets_included:false}):res.status(404).json(err("resource_not_found","Resource not found."));}catch(e){return replyError(res,e,"resource_permissions_failed");}
  });
  router.get("/admin/resources/:resourceKey/:resourceId/revisions",requireBackend,requireAdmin,async(req,res)=>{
    try{const result=await revisions(req.params.resourceKey,req.params.resourceId);return result?res.json({ok:true,...result,count:result.revisions.length,secrets_included:false}):res.status(404).json(err("resource_not_found","Resource not found."));}catch(e){return replyError(res,e,"resource_revisions_failed");}
  });
  router.get("/admin/resources/:resourceKey/:resourceId/changes",requireBackend,requireAdmin,async(req,res)=>{
    try{const result=await changes(req.params.resourceKey,req.query,null,req.params.resourceId);return result?res.json({ok:true,...result,count:result.items.length,secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));}catch(e){return replyError(res,e,"resource_changes_failed");}
  });
  router.get("/admin/resource-changes",requireBackend,requireAdmin,async(req,res)=>{
    try{if(!req.query.resourceKey)return res.status(400).json(err("resource_key_required","resourceKey is required."));const result=await changes(req.query.resourceKey,req.query);return result?res.json({ok:true,...result,secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));}catch(e){return replyError(res,e,"resource_changes_failed");}
  });
  router.get("/admin/resource-coverage/audit",requireBackend,requireAdmin,async(req,res)=>{
    try{return res.json(await runLiveResourceCoverageAudit(getPool(),{triggerSource:"admin_api",commitSha:process.env.DEPLOYMENT_COMMIT_SHA || null,persist:String(req.query.persist || "true")!=="false",findingLimit:pageSize(req.query.limit,250)}));}catch(e){return replyError(res,e,"resource_coverage_audit_failed");}
  });
  router.get("/admin/operations/:operationId",requireBackend,requireAdmin,async(req,res)=>{
    try{const item=await get("executions",req.params.operationId);return item?res.json({ok:true,operation:wrap("executions",item,capabilities("executions",{admin:true,item})),secrets_included:false}):res.status(404).json(err("operation_not_found","Operation not found."));}catch(e){return replyError(res,e,"operation_get_failed");}
  });

  router.get("/me/workspaces/:tenant_id/resources",requireUser,async(req,res)=>{
    const member=await membership(req,res,req.params.tenant_id);if(!member)return;
    const resources=MANIFEST.resources.filter((row)=>row.tenant).map((row)=>({resource_key:row.resource_key,display_name:row.display_name,operations:row.operations,capabilities:capabilities(row.resource_key,{member,auth:req.auth})}));
    return res.json({ok:true,tenant_id:req.params.tenant_id,resources,count:resources.length,secrets_included:false});
  });
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;const page=await list(req.params.resourceKey,req.query,tenantContext(req,member));return page?res.json({ok:true,tenant_id:req.params.tenant_id,resourceKey:req.params.resourceKey,...page,secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));}catch(e){return replyError(res,e,"tenant_resource_list_failed");}
  });
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;const item=await get(req.params.resourceKey,req.params.resourceId,tenantContext(req,member));return item?res.json({ok:true,resource:wrap(req.params.resourceKey,item,capabilities(req.params.resourceKey,{member,item,auth:req.auth})),secrets_included:false}):res.status(404).json(err("resource_not_found","Resource not found."));}catch(e){return replyError(res,e,"tenant_resource_get_failed");}
  });
  router.post("/me/workspaces/:tenant_id/resources/:resourceKey",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Create is not enabled for this resource."));const id=await createAsset(req.params.tenant_id,req.auth,req.body);const item=await get("assets",id,tenantContext(req,member));return res.status(201).json({ok:true,resource:wrap("assets",item,capabilities("assets",{member,item,auth:req.auth})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"tenant_resource_create_failed");}
  });
  router.patch("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Update is not enabled for this resource."));const context=tenantContext(req,member),id=await updateAsset(req.params.resourceId,req.body || {},context,false);if(!id)return res.status(404).json(err("resource_not_found","Resource not found."));const item=await get("assets",id,context);return res.json({ok:true,resource:wrap("assets",item,capabilities("assets",{member,item,auth:req.auth})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"tenant_resource_update_failed");}
  });
  router.delete("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Archive is not enabled for this resource."));const context=tenantContext(req,member),id=await lifecycleAsset(req.params.resourceId,"archived",context,false);if(!id)return res.status(404).json(err("resource_not_found","Resource not found."));const item=await get("assets",id,context);return res.json({ok:true,resource:wrap("assets",item,capabilities("assets",{member,item,auth:req.auth})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"tenant_resource_archive_failed");}
  });
  router.post("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/restore",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;if(req.params.resourceKey!=="assets")return res.status(409).json(err("operation_not_supported","Restore is not enabled for this resource."));const context=tenantContext(req,member),id=await lifecycleAsset(req.params.resourceId,"active",context,false);if(!id)return res.status(404).json(err("resource_not_found","Resource not found."));const item=await get("assets",id,context);return res.json({ok:true,resource:wrap("assets",item,capabilities("assets",{member,item,auth:req.auth})),readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"tenant_resource_restore_failed");}
  });
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/permissions",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;const item=await get(req.params.resourceKey,req.params.resourceId,tenantContext(req,member));return item?res.json({ok:true,membership_role:member.role,capabilities:capabilities(req.params.resourceKey,{member,item,auth:req.auth}),secrets_included:false}):res.status(404).json(err("resource_not_found","Resource not found."));}catch(e){return replyError(res,e,"tenant_resource_permissions_failed");}
  });
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/revisions",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;const result=await revisions(req.params.resourceKey,req.params.resourceId,tenantContext(req,member));return result?res.json({ok:true,...result,count:result.revisions.length,secrets_included:false}):res.status(404).json(err("resource_not_found","Resource not found."));}catch(e){return replyError(res,e,"tenant_resource_revisions_failed");}
  });
  router.get("/me/workspaces/:tenant_id/resources/:resourceKey/:resourceId/changes",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;const result=await changes(req.params.resourceKey,req.query,tenantContext(req,member),req.params.resourceId);return result?res.json({ok:true,...result,count:result.items.length,secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));}catch(e){return replyError(res,e,"tenant_resource_changes_failed");}
  });
  router.get("/me/workspaces/:tenant_id/resource-changes",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;if(!req.query.resourceKey)return res.status(400).json(err("resource_key_required","resourceKey is required."));const result=await changes(req.query.resourceKey,req.query,tenantContext(req,member));return result?res.json({ok:true,...result,secrets_included:false}):res.status(404).json(err("resource_type_not_found","Resource type not found."));}catch(e){return replyError(res,e,"tenant_resource_changes_failed");}
  });
  router.get("/me/workspaces/:tenant_id/operations/:operationId",requireUser,async(req,res)=>{
    try{const member=await membership(req,res,req.params.tenant_id);if(!member)return;const item=await get("executions",req.params.operationId,tenantContext(req,member));return item?res.json({ok:true,operation:wrap("executions",item,capabilities("executions",{member,item,auth:req.auth})),secrets_included:false}):res.status(404).json(err("operation_not_found","Operation not found."));}catch(e){return replyError(res,e,"tenant_operation_get_failed");}
  });

  router.get("/gpt/sessions",requireBackend,async(req,res)=>{
    try{const query={...req.query};if(!(req.auth?.is_admin || req.auth?.mode==="backend_api_key")){if(!req.auth?.user_id)return res.status(401).json(err("authentication_required","Authentication required."));query.user_id=req.auth.user_id;if(req.auth.tenant_id)query.tenant_id=req.auth.tenant_id;}const page=await list("sessions",query);return res.json({ok:true,sessions:page.items,count:page.count,nextPageToken:page.nextPageToken,secrets_included:false});}catch(e){return replyError(res,e,"session_list_failed");}
  });
  router.get("/gpt/sessions/:id",requireBackend,async(req,res)=>{
    try{const item=await get("sessions",req.params.id);const result={session:item};if(!item)return res.status(404).json(err("session_not_found","Session not found."));if(!authorizedSession(result,req))return res.status(403).json(err("forbidden","Session belongs to a different user."));return res.json({ok:true,session:item,secrets_included:false});}catch(e){return replyError(res,e,"session_get_failed");}
  });
  router.get("/gpt/sessions/:id/turns",requireBackend,async(req,res)=>{
    try{const result=await sessionTurns(req.params.id,req.query);if(!result)return res.status(404).json(err("session_not_found","Session not found."));if(!authorizedSession(result,req))return res.status(403).json(err("forbidden","Session belongs to a different user."));return res.json({ok:true,session_id:req.params.id,turns:result.items,count:result.items.length,nextAfter:result.nextAfter,full_content_returned:false,secrets_included:false});}catch(e){return replyError(res,e,"session_turns_failed");}
  });
  router.get("/gpt/sessions/:id/summary",requireBackend,async(req,res)=>{
    try{const result=await sessionSummary(req.params.id);if(!result)return res.status(404).json(err("session_not_found","Session not found."));if(!authorizedSession(result,req))return res.status(403).json(err("forbidden","Session belongs to a different user."));return res.json({ok:true,session_id:req.params.id,summary:result.summary,secrets_included:false});}catch(e){return replyError(res,e,"session_summary_failed");}
  });
  router.get("/gpt/sessions/:id/events",requireBackend,async(req,res)=>{
    try{const result=await sessionEvents(req.params.id,req.query);if(!result)return res.status(404).json(err("session_not_found","Session not found."));if(!authorizedSession(result,req))return res.status(403).json(err("forbidden","Session belongs to a different user."));return res.json({ok:true,session_id:req.params.id,events:result.items,count:result.items.length,secrets_included:false});}catch(e){return replyError(res,e,"session_events_failed");}
  });
  router.get("/gpt/sessions/:id/transcript",requireBackend,async(req,res)=>{
    try{if(String(req.query.mode || "preview")==="full")return res.status(409).json(err("full_transcript_adapter_required","Full transcript retrieval requires a governed Drive adapter."));const result=await sessionTurns(req.params.id,{...req.query,pageSize:req.query.pageSize || 100});if(!result)return res.status(404).json(err("session_not_found","Session not found."));if(!authorizedSession(result,req))return res.status(403).json(err("forbidden","Session belongs to a different user."));return res.json({ok:true,session_id:req.params.id,mode:"preview",transcript:result.items.map(({turn_index,role,content_preview,action_key,created_at})=>({turn_index,role,content_preview,action_key,created_at})),count:result.items.length,nextAfter:result.nextAfter,full_content_storage:"drive_doc_and_jsonl",full_content_returned:false,secrets_included:false});}catch(e){return replyError(res,e,"session_transcript_failed");}
  });
  router.post("/gpt/sessions/:id/summary/generate",requireBackend,async(req,res)=>{
    try{const session=await get("sessions",req.params.id),result={session};if(!session)return res.status(404).json(err("session_not_found","Session not found."));if(!authorizedSession(result,req))return res.status(403).json(err("forbidden","Session belongs to a different user."));const callModel=deps.getCallModelForClass?deps.getCallModelForClass("standard"):deps.callModel;const generation=await summarizeSessionIfNeeded({pool:getPool(),session,callModel,force:Boolean(req.body?.force)});const readback=await sessionSummary(req.params.id);return res.json({ok:true,session_id:req.params.id,generation,summary:readback?.summary || null,readback:"same_cycle",secrets_included:false});}catch(e){return replyError(res,e,"session_summary_generate_failed");}
  });
  return router;
}

export const _testingResourceApiRoutes={MANIFEST,RESOURCES,descriptor,pageSize,encodeToken,decodeToken,capabilities,err};
