#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", action: "list" };
  let applySeen = false;
  let drySeen = false;
  for (const arg of argv) {
    if (arg === "--apply") { args.mode = "apply"; applySeen = true; continue; }
    if (arg === "--dry-run") { args.mode = "dry_run"; drySeen = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  if (applySeen && drySeen) {
    const e = new Error("Conflicting mode flags: use either --dry-run or --apply, not both.");
    e.code = "conflicting_mode_flags";
    throw e;
  }
  return args;
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function required(args, key) {
  const value = clean(args[key]);
  if (!value) throw new Error(`Missing required argument --${key.replace(/_/g, "-")}`);
  return value;
}

function safePath(value, key = "path") {
  const path = clean(value);
  if (!path) throw new Error(`Missing ${key}`);
  if (path.length > 1024) throw new Error(`${key} is too long`);
  if (/[\0\r\n]/.test(path)) throw new Error(`${key} contains invalid control characters`);
  return path;
}

function parseJson(value, fallback = null) {
  if (!clean(value)) return fallback;
  try { return JSON.parse(value); } catch (err) {
    const e = new Error(`Invalid JSON: ${err.message}`);
    e.code = "invalid_json";
    throw e;
  }
}

function normalizeOwnerScope(value = "") {
  const scope = clean(value || "platform").toLowerCase();
  if (!["platform", "tenant", "user", "device"].includes(scope)) throw new Error("Invalid --owner-scope");
  return scope;
}

function normalizeAllowedSubjectScope(value = "", ownerScope = "platform") {
  const fallback = ownerScope === "tenant" ? "tenant_admin" : ownerScope === "user" || ownerScope === "device" ? "user_owner" : "admin";
  const scope = clean(value || fallback).toLowerCase();
  if (!["admin", "tenant_admin", "user_owner", "none"].includes(scope)) throw new Error("Invalid --allowed-subject-scope");
  return scope;
}

function defaultAllowedOperations(ownerScope = "platform", projectKey = "") {
  if (ownerScope === "platform") return ["validate", "repo_status", "controlled_repair"];
  if (projectKey === "local-connector" || ownerScope === "device") return ["health", "validate", "connector_status", "connector_repair", "bounded_dir_list", "bounded_file_search"];
  if (ownerScope === "tenant") return ["validate", "bounded_dir_list", "bounded_file_search", "controlled_repair"];
  if (ownerScope === "user") return ["validate", "bounded_dir_list", "bounded_file_search", "local_repair"];
  return [];
}

async function findPath(conn, { tenantId, deviceId, projectKey }) {
  const [rows] = await conn.query(
    `SELECT * FROM local_project_path_registry
      WHERE tenant_id=? AND device_id=? AND project_key=?
      LIMIT 1`,
    [tenantId, deviceId, projectKey]
  );
  return rows?.[0] || null;
}

async function insertEvent(conn, { pathId, eventType, oldPath = null, newPath = null, before = null, after = null, actor = "", event = {} }) {
  await conn.query(
    `INSERT INTO local_project_path_events
      (event_id, path_id, event_type, old_path, new_path, status_before, status_after, actor, event_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), pathId, eventType, oldPath, newPath, before, after, actor || null, JSON.stringify(event || {})]
  );
}

function output(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function usage() {
  return `Usage:\n\nnode scripts/local-project-path-helper.mjs --action=list [--tenant-id=...] [--device-id=...] [--project-key=...]\n\nnode scripts/local-project-path-helper.mjs --action=upsert --device-id=<device> --current-path=<path> [--project-key=growth-intelligence-os] [--user-id=...] [--repo-remote=...] [--repo-branch=...] [--expected-markers-json='[".git","package.json"]'] [--apply|--dry-run]\n\nnode scripts/local-project-path-helper.mjs --action=plan-move --device-id=<device> --project-key=<key> --new-path=<path> [--apply|--dry-run]\n\nnode scripts/local-project-path-helper.mjs --action=confirm-move --device-id=<device> --project-key=<key> [--validation-status=valid] [--apply|--dry-run]\n\nnode scripts/local-project-path-helper.mjs --action=mark-repair-required --device-id=<device> --project-key=<key> [--reason=...] [--apply|--dry-run]\n\nnode scripts/local-project-path-helper.mjs --action=archive --device-id=<device> --project-key=<key> [--apply|--dry-run]`;
}

async function main() {
  const args = parseArgs();
  const action = clean(args.action || "list");
  const tenantId = clean(args.tenant_id || "00000000-0000-0000-0000-000000000000");
  const userId = clean(args.user_id || "");
  const deviceId = clean(args.device_id || "");
  const projectKey = clean(args.project_key || "growth-intelligence-os");
  const actor = clean(args.actor || args.updated_by || "admin_control");
  const apply = args.mode === "apply";

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    if (action === "list") {
      const filters = ["tenant_id=?"];
      const params = [tenantId];
      if (deviceId) { filters.push("device_id=?"); params.push(deviceId); }
      if (projectKey) { filters.push("project_key=?"); params.push(projectKey); }
      if (userId) { filters.push("user_id=?"); params.push(userId); }
      const [rows] = await conn.query(
        `SELECT path_id, tenant_id, user_id, device_id, project_key, project_label,
                current_path, previous_path, repo_remote, repo_branch, path_status,
                validation_status, last_validated_at, last_repair_run_id, created_at, updated_at
           FROM local_project_path_registry
          WHERE ${filters.join(" AND ")}
          ORDER BY updated_at DESC
          LIMIT 100`,
        params
      );
      output({ ok: true, action, count: rows.length, rows });
      return;
    }

    if (!deviceId) required(args, "device_id");

    const existing = await findPath(conn, { tenantId, deviceId, projectKey });

    if (action === "upsert") {
      const currentPath = safePath(required(args, "current_path"), "current_path");
      const expectedMarkers = parseJson(args.expected_markers_json, [".git", "package.json"]);
      const plan = {
        action,
        mode: apply ? "apply" : "dry-run",
        tenantId,
        userId: userId || null,
        deviceId,
        projectKey,
        currentPath,
        previousPath: existing?.current_path || null,
        existing: Boolean(existing)
      };
      if (!apply) { output({ ok: true, ...plan }); return; }
      await conn.beginTransaction();
      const pathId = existing?.path_id || randomUUID();
      await conn.query(
        `INSERT INTO local_project_path_registry
          (path_id, tenant_id, user_id, device_id, project_key, project_label, current_path, previous_path,
           repo_remote, repo_branch, expected_markers_json, path_status, validation_status, created_by, updated_by)
         VALUES (?, ?, NULLIF(?, ''), ?, ?, NULLIF(?, ''), ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, 'active', 'unknown', ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id=VALUES(user_id), project_label=VALUES(project_label), previous_path=current_path,
           current_path=VALUES(current_path), repo_remote=VALUES(repo_remote), repo_branch=VALUES(repo_branch),
           expected_markers_json=VALUES(expected_markers_json), path_status='active', validation_status='unknown', updated_by=VALUES(updated_by)`,
        [pathId, tenantId, userId, deviceId, projectKey, clean(args.project_label), currentPath, existing?.current_path || null,
          clean(args.repo_remote), clean(args.repo_branch), JSON.stringify(expectedMarkers), actor, actor]
      );
      await insertEvent(conn, { pathId, eventType: existing ? "path_updated" : "registered", oldPath: existing?.current_path || null, newPath: currentPath, before: existing?.path_status || null, after: "active", actor, event: plan });
      await conn.commit();
      output({ ok: true, applied: true, pathId, ...plan });
      return;
    }

    if (!existing) {
      const e = new Error(`No path registry row found for tenant=${tenantId} device=${deviceId} project=${projectKey}`);
      e.code = "local_project_path_not_found";
      throw e;
    }

    if (action === "plan-move") {
      const newPath = safePath(required(args, "new_path"), "new_path");
      const plan = { action, mode: apply ? "apply" : "dry-run", pathId: existing.path_id, oldPath: existing.current_path, newPath };
      if (!apply) { output({ ok: true, ...plan }); return; }
      await conn.beginTransaction();
      await conn.query(
        `UPDATE local_project_path_registry
            SET previous_path=current_path, current_path=?, path_status='pending_move', validation_status='unknown', updated_by=?
          WHERE path_id=?`,
        [newPath, actor, existing.path_id]
      );
      await insertEvent(conn, { pathId: existing.path_id, eventType: "move_planned", oldPath: existing.current_path, newPath, before: existing.path_status, after: "pending_move", actor, event: plan });
      await conn.commit();
      output({ ok: true, applied: true, ...plan });
      return;
    }

    if (action === "confirm-move") {
      const validationStatus = clean(args.validation_status || "valid");
      if (!["valid", "partial", "mismatch", "missing", "inaccessible", "unknown"].includes(validationStatus)) throw new Error("Invalid --validation-status");
      const plan = { action, mode: apply ? "apply" : "dry-run", pathId: existing.path_id, currentPath: existing.current_path, validationStatus };
      if (!apply) { output({ ok: true, ...plan }); return; }
      await conn.beginTransaction();
      await conn.query(
        `UPDATE local_project_path_registry
            SET path_status='active', validation_status=?, last_validated_at=NOW(), updated_by=?
          WHERE path_id=?`,
        [validationStatus, actor, existing.path_id]
      );
      await insertEvent(conn, { pathId: existing.path_id, eventType: "move_confirmed", oldPath: existing.previous_path, newPath: existing.current_path, before: existing.path_status, after: "active", actor, event: plan });
      await conn.commit();
      output({ ok: true, applied: true, ...plan });
      return;
    }

    if (action === "mark-repair-required") {
      const reason = clean(args.reason || "manual_review_required");
      const plan = { action, mode: apply ? "apply" : "dry-run", pathId: existing.path_id, currentPath: existing.current_path, reason };
      if (!apply) { output({ ok: true, ...plan }); return; }
      await conn.beginTransaction();
      await conn.query(
        `UPDATE local_project_path_registry
            SET path_status='repair_required', validation_status='partial', metadata_json=JSON_SET(COALESCE(metadata_json, JSON_OBJECT()), '$.repair_reason', ?), updated_by=?
          WHERE path_id=?`,
        [reason, actor, existing.path_id]
      );
      await insertEvent(conn, { pathId: existing.path_id, eventType: "validation", oldPath: existing.previous_path, newPath: existing.current_path, before: existing.path_status, after: "repair_required", actor, event: plan });
      await conn.commit();
      output({ ok: true, applied: true, ...plan });
      return;
    }

    if (action === "archive") {
      const plan = { action, mode: apply ? "apply" : "dry-run", pathId: existing.path_id, currentPath: existing.current_path };
      if (!apply) { output({ ok: true, ...plan }); return; }
      await conn.beginTransaction();
      await conn.query(`UPDATE local_project_path_registry SET path_status='archived', updated_by=? WHERE path_id=?`, [actor, existing.path_id]);
      await insertEvent(conn, { pathId: existing.path_id, eventType: "archived", oldPath: existing.current_path, before: existing.path_status, after: "archived", actor, event: plan });
      await conn.commit();
      output({ ok: true, applied: true, ...plan });
      return;
    }

    throw new Error(`Unsupported --action=${action}\n${usage()}`);
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_project_path_helper_failed", message: err.message }, usage: usage() }, null, 2));
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "fatal", message: err.message }, usage: usage() }, null, 2));
  process.exitCode = 1;
});
