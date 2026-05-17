#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function clean(value = "") { return String(value ?? "").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", action: "list-locations" };
  let applySeen = false;
  let drySeen = false;
  for (const arg of argv) {
    if (arg === "--apply") { args.mode = "apply"; applySeen = true; continue; }
    if (arg === "--dry-run") { args.mode = "dry_run"; drySeen = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  if (applySeen && drySeen) throw new Error("Conflicting mode flags: use either --dry-run or --apply, not both.");
  return args;
}
function required(args, key) {
  const value = clean(args[key]);
  if (!value) throw new Error(`Missing required argument --${key.replace(/_/g, "-")}`);
  if (/[\0\r\n]/.test(value)) throw new Error(`${key} contains invalid control characters`);
  return value;
}
function parseJson(value, fallback = null) {
  if (!clean(value)) return fallback;
  try { return JSON.parse(value); } catch (err) { throw new Error(`Invalid JSON for argument: ${err.message}`); }
}
function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`Invalid ${label}: ${value}. Allowed: ${allowed.join(", ")}`);
  return value;
}
function print(payload) { console.log(JSON.stringify(payload, null, 2)); }
function usage() {
  return `Usage:\n\nbackup-copy-governance-helper.mjs --action=list-locations [--location-type=...] [--owner-scope=...]\nbackup-copy-governance-helper.mjs --action=register-location --location-key=... --location-type=repo_branch|hostinger_runtime|local_device_path|drive_folder|object_storage|database|other --path-or-ref=... [--apply]\nbackup-copy-governance-helper.mjs --action=list-policies [--status=draft|active|paused|archived]\nbackup-copy-governance-helper.mjs --action=draft-policy --policy-key=... --source-location-key=... --backup-kind=code|database|env_manifest|artifacts|drive_archive|full_bundle|metadata_only|other [--destination-location-key=...] [--apply]\nbackup-copy-governance-helper.mjs --action=record-dry-run --policy-key=... [--manifest-json='{}'] [--apply]\n\nThis helper never copies files, dumps DBs, or uploads artifacts.`;
}
async function getLocation(conn, key) {
  const [rows] = await conn.query(`SELECT * FROM platform_copy_locations WHERE location_key=? LIMIT 1`, [key]);
  return rows?.[0] || null;
}
async function getPolicy(conn, key) {
  const [rows] = await conn.query(`SELECT * FROM platform_backup_policies WHERE policy_key=? LIMIT 1`, [key]);
  return rows?.[0] || null;
}
async function main() {
  const args = parseArgs();
  const action = clean(args.action || "list-locations");
  const apply = args.mode === "apply";
  const conn = await getPool().getConnection();
  try {
    if (action === "list-locations") {
      const filters = [];
      const params = [];
      if (clean(args.location_type)) { filters.push("location_type=?"); params.push(clean(args.location_type)); }
      if (clean(args.owner_scope)) { filters.push("owner_scope=?"); params.push(clean(args.owner_scope)); }
      if (clean(args.status)) { filters.push("status=?"); params.push(clean(args.status)); }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const [rows] = await conn.query(
        `SELECT location_id, location_key, location_type, owner_scope, tenant_id, user_id, device_id,
                provider, path_or_ref, branch_name, host_name, is_source_of_truth,
                allowed_operations_json, risk_level, status, last_validated_at, notes
           FROM platform_copy_locations ${where}
          ORDER BY location_type, location_key
          LIMIT 200`, params);
      print({ ok: true, action, count: rows.length, rows });
      return;
    }

    if (action === "register-location") {
      const locationKey = required(args, "location_key");
      const locationType = assertEnum(clean(args.location_type), ['repo_branch','hostinger_runtime','local_device_path','drive_folder','object_storage','database','other'], 'location-type');
      const ownerScope = assertEnum(clean(args.owner_scope || 'platform'), ['platform','tenant','user','device'], 'owner-scope');
      const pathOrRef = required(args, "path_or_ref");
      const riskLevel = assertEnum(clean(args.risk_level || 'medium'), ['low','medium','high','critical'], 'risk-level');
      const status = assertEnum(clean(args.status || 'pending_validation'), ['active','pending_validation','degraded','archived'], 'status');
      const plan = { ok: true, action, mode: args.mode, locationKey, locationType, ownerScope, pathOrRef, riskLevel, status };
      if (!apply) { print(plan); return; }
      await conn.query(
        `INSERT INTO platform_copy_locations
          (location_id, location_key, location_type, owner_scope, tenant_id, user_id, device_id, provider,
           path_or_ref, branch_name, host_name, is_source_of_truth, allowed_operations_json, risk_level,
           status, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, NULLIF(?, ''), ?, ?)
         ON DUPLICATE KEY UPDATE
           location_type=VALUES(location_type), owner_scope=VALUES(owner_scope), tenant_id=VALUES(tenant_id),
           user_id=VALUES(user_id), device_id=VALUES(device_id), provider=VALUES(provider), path_or_ref=VALUES(path_or_ref),
           branch_name=VALUES(branch_name), host_name=VALUES(host_name), is_source_of_truth=VALUES(is_source_of_truth),
           allowed_operations_json=VALUES(allowed_operations_json), risk_level=VALUES(risk_level), status=VALUES(status),
           notes=VALUES(notes), updated_by=VALUES(updated_by)`,
        [randomUUID(), locationKey, locationType, ownerScope, clean(args.tenant_id), clean(args.user_id), clean(args.device_id), clean(args.provider),
          pathOrRef, clean(args.branch_name), clean(args.host_name), clean(args.is_source_of_truth) === 'true' ? 1 : 0,
          JSON.stringify(parseJson(args.allowed_operations_json, [])), riskLevel, status, clean(args.notes), clean(args.actor || 'backup_copy_governance_helper'), clean(args.actor || 'backup_copy_governance_helper')]
      );
      print({ ...plan, applied: true });
      return;
    }

    if (action === "list-policies") {
      const filters = [];
      const params = [];
      if (clean(args.status)) { filters.push("p.status=?"); params.push(clean(args.status)); }
      if (clean(args.scope)) { filters.push("p.scope=?"); params.push(clean(args.scope)); }
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
      const [rows] = await conn.query(
        `SELECT p.policy_id, p.policy_key, p.policy_label, p.scope, p.backup_kind, p.mode,
                p.retention_days, p.encryption_required, p.checksum_required, p.approval_required,
                p.restore_test_required, p.allowed_executor, p.status,
                s.location_key AS source_location_key, d.location_key AS destination_location_key
           FROM platform_backup_policies p
           JOIN platform_copy_locations s ON s.location_id=p.source_location_id
           LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
           ${where}
          ORDER BY p.created_at DESC
          LIMIT 200`, params);
      print({ ok: true, action, count: rows.length, rows });
      return;
    }

    if (action === "draft-policy") {
      const policyKey = required(args, "policy_key");
      const sourceLocationKey = required(args, "source_location_key");
      const source = await getLocation(conn, sourceLocationKey);
      if (!source) throw new Error(`source_location_key not found: ${sourceLocationKey}`);
      const destinationLocationKey = clean(args.destination_location_key);
      const destination = destinationLocationKey ? await getLocation(conn, destinationLocationKey) : null;
      if (destinationLocationKey && !destination) throw new Error(`destination_location_key not found: ${destinationLocationKey}`);
      const backupKind = assertEnum(clean(args.backup_kind), ['code','database','env_manifest','artifacts','drive_archive','full_bundle','metadata_only','other'], 'backup-kind');
      const plan = { ok: true, action, mode: args.mode, policyKey, sourceLocationKey, destinationLocationKey: destinationLocationKey || null, backupKind, status: 'draft' };
      if (!apply) { print(plan); return; }
      await conn.query(
        `INSERT INTO platform_backup_policies
          (policy_id, policy_key, policy_label, scope, source_location_id, destination_location_id, backup_kind,
           mode, retention_days, encryption_required, checksum_required, approval_required, restore_test_required,
           allowed_executor, forbidden_content_json, policy_json, status, created_by, updated_by)
         VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
         ON DUPLICATE KEY UPDATE
           policy_label=VALUES(policy_label), scope=VALUES(scope), source_location_id=VALUES(source_location_id),
           destination_location_id=VALUES(destination_location_id), backup_kind=VALUES(backup_kind), mode=VALUES(mode),
           retention_days=VALUES(retention_days), encryption_required=VALUES(encryption_required),
           checksum_required=VALUES(checksum_required), approval_required=VALUES(approval_required),
           restore_test_required=VALUES(restore_test_required), allowed_executor=VALUES(allowed_executor),
           forbidden_content_json=VALUES(forbidden_content_json), policy_json=VALUES(policy_json), status='draft', updated_by=VALUES(updated_by)`,
        [randomUUID(), policyKey, clean(args.policy_label), clean(args.scope || source.owner_scope || 'platform'), source.location_id, destination?.location_id || null,
          backupKind, clean(args.backup_mode || 'manual'), clean(args.retention_days) ? Number(args.retention_days) : null,
          clean(args.encryption_required || 'true') !== 'false' ? 1 : 0,
          clean(args.checksum_required || 'true') !== 'false' ? 1 : 0,
          clean(args.approval_required || 'true') !== 'false' ? 1 : 0,
          clean(args.restore_test_required || 'true') !== 'false' ? 1 : 0,
          assertEnum(clean(args.allowed_executor || 'none'), ['none','admin_tool','hostinger_ssh','local_connector','github_actions','manual'], 'allowed-executor'),
          JSON.stringify(parseJson(args.forbidden_content_json, ['plaintext_env','provider_credentials','oauth_refresh_tokens','api_keys','unencrypted_db_dump'])),
          JSON.stringify(parseJson(args.policy_json, {})), clean(args.actor || 'backup_copy_governance_helper'), clean(args.actor || 'backup_copy_governance_helper')]
      );
      print({ ...plan, applied: true });
      return;
    }

    if (action === "list-approvals") {
      const [rows] = await conn.query(
        `SELECT a.approval_id, p.policy_key, a.approval_type, a.status, a.requested_by,
                a.approved_by, a.rejected_by, a.reason, a.requested_at, a.decided_at, a.expires_at
           FROM platform_backup_approvals a
           JOIN platform_backup_policies p ON p.policy_id=a.policy_id
          ORDER BY a.requested_at DESC
          LIMIT 200`
      );
      print({ ok: true, action, count: rows.length, rows });
      return;
    }

    if (action === "list-restore-tests") {
      const [rows] = await conn.query(
        `SELECT t.test_id, p.policy_key, r.run_mode, r.status AS backup_run_status,
                t.restore_target, t.status AS restore_test_status, t.validated_commit_sha,
                t.validated_tables_count, t.validated_checksum_sha256, t.notes, t.created_at
           FROM platform_restore_tests t
           JOIN platform_backup_runs r ON r.run_id=t.backup_run_id
           JOIN platform_backup_policies p ON p.policy_id=r.policy_id
          ORDER BY t.created_at DESC
          LIMIT 200`
      );
      print({ ok: true, action, count: rows.length, rows });
      return;
    }

    if (action === "preflight-policy") {
      const policyKey = required(args, "policy_key");
      const policy = await getPolicy(conn, policyKey);
      if (!policy) throw new Error(`policy_key not found: ${policyKey}`);
      const [rows] = await conn.query(
        `SELECT p.policy_id, p.policy_key, p.status AS policy_status, p.backup_kind,
                p.artifact_format, p.encryption_scheme, p.checksum_algorithm, p.manifest_schema_version,
                p.approval_required, p.restore_test_required, p.allowed_executor,
                s.location_key AS source_location_key, s.status AS source_status,
                d.location_key AS destination_location_key, d.status AS destination_status,
                SUM(CASE WHEN a.approval_type='policy_activation' AND a.status='approved' THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN rt.status IN ('planned','passed') THEN 1 ELSE 0 END) AS restore_plan_count
           FROM platform_backup_policies p
           JOIN platform_copy_locations s ON s.location_id=p.source_location_id
           LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
           LEFT JOIN platform_backup_approvals a ON a.policy_id=p.policy_id
           LEFT JOIN platform_backup_runs r ON r.policy_id=p.policy_id
           LEFT JOIN platform_restore_tests rt ON rt.backup_run_id=r.run_id
          WHERE p.policy_key=?
          GROUP BY p.policy_id, p.policy_key, p.status, p.backup_kind, p.artifact_format,
                   p.encryption_scheme, p.checksum_algorithm, p.manifest_schema_version,
                   p.approval_required, p.restore_test_required, p.allowed_executor,
                   s.location_key, s.status, d.location_key, d.status`,
        [policyKey]
      );
      const row = rows[0];
      const blockers = [];
      if (!row.destination_location_key) blockers.push("missing_destination");
      if (row.destination_status !== "active") blockers.push("destination_not_active");
      if (row.source_status !== "active" && row.source_status !== "pending_validation") blockers.push("source_not_available");
      if (row.policy_status !== "active") blockers.push("policy_not_active");
      if (row.approval_required && Number(row.approved_count || 0) < 1) blockers.push("approval_not_granted");
      if (row.restore_test_required && Number(row.restore_plan_count || 0) < 1) blockers.push("restore_test_plan_missing");
      if (!row.artifact_format || row.artifact_format === "none") blockers.push("artifact_format_missing");
      if (!row.checksum_algorithm || row.checksum_algorithm === "none") blockers.push("checksum_algorithm_missing");
      if (row.backup_kind === "database" && row.encryption_scheme === "none") blockers.push("encryption_required_for_database");
      if (row.allowed_executor === "none") blockers.push("executor_not_enabled");
      const preflight = {
        ok: true,
        action,
        policyKey,
        preflightStatus: blockers.length ? "blocked" : "passed",
        blockers,
        contract: {
          artifactFormat: row.artifact_format,
          encryptionScheme: row.encryption_scheme,
          checksumAlgorithm: row.checksum_algorithm,
          manifestSchemaVersion: row.manifest_schema_version,
          allowedExecutor: row.allowed_executor
        },
        source: { key: row.source_location_key, status: row.source_status },
        destination: { key: row.destination_location_key, status: row.destination_status },
        approvals: { approvedCount: Number(row.approved_count || 0) },
        restoreTests: { planCount: Number(row.restore_plan_count || 0) },
        note: "Preflight only. No backup executed."
      };
      if (apply) {
        await conn.query(
          `UPDATE platform_backup_runs r
             JOIN platform_backup_policies p ON p.policy_id=r.policy_id
              SET r.preflight_status=?, r.preflight_json=?,
                  r.artifact_format=?, r.encryption_scheme=?, r.checksum_algorithm=?, r.manifest_schema_version=?
            WHERE p.policy_key=? AND r.run_mode='dry_run'
            ORDER BY r.created_at DESC
            LIMIT 1`,
          [preflight.preflightStatus, JSON.stringify(preflight), row.artifact_format, row.encryption_scheme,
            row.checksum_algorithm, row.manifest_schema_version, policyKey]
        );
        preflight.recorded = true;
      }
      print(preflight);
      return;
    }

    if (action === "preflight-policy") {
      const policyKey = required(args, "policy_key");
      const policy = await getPolicy(conn, policyKey);
      if (!policy) throw new Error(`policy_key not found: ${policyKey}`);
      const [rows] = await conn.query(
        `SELECT p.policy_id, p.policy_key, p.status AS policy_status, p.backup_kind,
                p.artifact_format, p.encryption_scheme, p.checksum_algorithm, p.manifest_schema_version,
                p.approval_required, p.restore_test_required, p.allowed_executor,
                s.location_key AS source_location_key, s.status AS source_status,
                d.location_key AS destination_location_key, d.status AS destination_status,
                SUM(CASE WHEN a.approval_type='policy_activation' AND a.status='approved' THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN rt.status IN ('planned','passed') THEN 1 ELSE 0 END) AS restore_plan_count
           FROM platform_backup_policies p
           JOIN platform_copy_locations s ON s.location_id=p.source_location_id
           LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
           LEFT JOIN platform_backup_approvals a ON a.policy_id=p.policy_id
           LEFT JOIN platform_backup_runs r ON r.policy_id=p.policy_id
           LEFT JOIN platform_restore_tests rt ON rt.backup_run_id=r.run_id
          WHERE p.policy_key=?
          GROUP BY p.policy_id, p.policy_key, p.status, p.backup_kind, p.artifact_format,
                   p.encryption_scheme, p.checksum_algorithm, p.manifest_schema_version,
                   p.approval_required, p.restore_test_required, p.allowed_executor,
                   s.location_key, s.status, d.location_key, d.status`,
        [policyKey]
      );
      const row = rows[0];
      const blockers = [];
      if (!row.destination_location_key) blockers.push("missing_destination");
      if (row.destination_status !== "active") blockers.push("destination_not_active");
      if (row.source_status !== "active" && row.source_status !== "pending_validation") blockers.push("source_not_available");
      if (row.policy_status !== "active") blockers.push("policy_not_active");
      if (row.approval_required && Number(row.approved_count || 0) < 1) blockers.push("approval_not_granted");
      if (row.restore_test_required && Number(row.restore_plan_count || 0) < 1) blockers.push("restore_test_plan_missing");
      if (!row.artifact_format || row.artifact_format === "none") blockers.push("artifact_format_missing");
      if (!row.checksum_algorithm || row.checksum_algorithm === "none") blockers.push("checksum_algorithm_missing");
      if (row.backup_kind === "database" && row.encryption_scheme === "none") blockers.push("encryption_required_for_database");
      if (row.allowed_executor === "none") blockers.push("executor_not_enabled");
      const preflight = {
        ok: true,
        action,
        policyKey,
        preflightStatus: blockers.length ? "blocked" : "passed",
        blockers,
        contract: {
          artifactFormat: row.artifact_format,
          encryptionScheme: row.encryption_scheme,
          checksumAlgorithm: row.checksum_algorithm,
          manifestSchemaVersion: row.manifest_schema_version,
          allowedExecutor: row.allowed_executor
        },
        source: { key: row.source_location_key, status: row.source_status },
        destination: { key: row.destination_location_key, status: row.destination_status },
        approvals: { approvedCount: Number(row.approved_count || 0) },
        restoreTests: { planCount: Number(row.restore_plan_count || 0) },
        note: "Preflight only. No backup executed."
      };
      if (apply) {
        await conn.query(
          `UPDATE platform_backup_runs r
             JOIN platform_backup_policies p ON p.policy_id=r.policy_id
              SET r.preflight_status=?, r.preflight_json=?,
                  r.artifact_format=?, r.encryption_scheme=?, r.checksum_algorithm=?, r.manifest_schema_version=?
            WHERE p.policy_key=? AND r.run_mode='dry_run'
            ORDER BY r.created_at DESC
            LIMIT 1`,
          [preflight.preflightStatus, JSON.stringify(preflight), row.artifact_format, row.encryption_scheme,
            row.checksum_algorithm, row.manifest_schema_version, policyKey]
        );
        preflight.recorded = true;
      }
      print(preflight);
      return;
    }

    if (action === "decide-approval") {
      const policyKey = required(args, "policy_key");
      const decision = clean(args.decision || "").toLowerCase();
      if (!["approved", "rejected", "revoked"].includes(decision)) throw new Error("--decision must be approved, rejected, or revoked");
      const actor = required(args, "actor");
      const decisionToken = clean(args.decision_token || "");
      if (decision === "approved" && decisionToken !== `APPROVE:${policyKey}`) {
        throw new Error(`Approval requires --decision-token=APPROVE:${policyKey}`);
      }
      const policy = await getPolicy(conn, policyKey);
      if (!policy) throw new Error(`policy_key not found: ${policyKey}`);
      const [approvalRows] = await conn.query(
        `SELECT * FROM platform_backup_approvals
          WHERE policy_id=? AND approval_type='policy_activation' AND status='requested'
          ORDER BY requested_at DESC LIMIT 1`,
        [policy.policy_id]
      );
      const approval = approvalRows[0];
      if (!approval) throw new Error(`No requested policy_activation approval found for ${policyKey}`);
      const plan = { ok: true, action, mode: args.mode, policyKey, decision, approvalId: approval.approval_id, actor, note: "Approval decision only. No backup executed." };
      if (!apply) { print(plan); return; }
      await conn.query(
        `UPDATE platform_backup_approvals
            SET status=?, approved_by=CASE WHEN ?='approved' THEN ? ELSE approved_by END,
                rejected_by=CASE WHEN ? IN ('rejected','revoked') THEN ? ELSE rejected_by END,
                decision_token=NULLIF(?, ''), decision_source='admin_session',
                reason=COALESCE(NULLIF(?, ''), reason),
                policy_snapshot_json=?, decided_at=NOW()
          WHERE approval_id=?`,
        [decision, decision, actor, decision, actor, decisionToken, clean(args.reason), JSON.stringify(policy), approval.approval_id]
      );
      print({ ...plan, applied: true });
      return;
    }

    if (action === "evaluate-activation-gate") {
      const policyKey = required(args, "policy_key");
      const [rows] = await conn.query(
        `SELECT p.policy_id, p.policy_key, p.status AS policy_status, p.backup_kind,
                p.artifact_format, p.encryption_scheme, p.checksum_algorithm, p.manifest_schema_version,
                p.approval_required, p.restore_test_required, p.allowed_executor,
                s.location_key AS source_location_key, s.status AS source_status,
                d.location_key AS destination_location_key, d.status AS destination_status,
                SUM(CASE WHEN a.approval_type='policy_activation' AND a.status='approved' THEN 1 ELSE 0 END) AS approved_count,
                SUM(CASE WHEN rt.status IN ('planned','passed') THEN 1 ELSE 0 END) AS restore_plan_count
           FROM platform_backup_policies p
           JOIN platform_copy_locations s ON s.location_id=p.source_location_id
           LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
           LEFT JOIN platform_backup_approvals a ON a.policy_id=p.policy_id
           LEFT JOIN platform_backup_runs r ON r.policy_id=p.policy_id
           LEFT JOIN platform_restore_tests rt ON rt.backup_run_id=r.run_id
          WHERE p.policy_key=?
          GROUP BY p.policy_id, p.policy_key, p.status, p.backup_kind, p.artifact_format,
                   p.encryption_scheme, p.checksum_algorithm, p.manifest_schema_version,
                   p.approval_required, p.restore_test_required, p.allowed_executor,
                   s.location_key, s.status, d.location_key, d.status`,
        [policyKey]
      );
      if (!rows[0]) throw new Error(`policy_key not found: ${policyKey}`);
      const row = rows[0];
      const blockers = [];
      if (!row.destination_location_key) blockers.push("missing_destination");
      if (row.destination_status !== "active") blockers.push("destination_not_active");
      if (row.source_status !== "active" && row.source_status !== "pending_validation") blockers.push("source_not_available");
      if (row.approval_required && Number(row.approved_count || 0) < 1) blockers.push("approval_not_granted");
      if (row.restore_test_required && Number(row.restore_plan_count || 0) < 1) blockers.push("restore_test_plan_missing");
      if (!row.artifact_format || row.artifact_format === "none") blockers.push("artifact_format_missing");
      if (!row.checksum_algorithm || row.checksum_algorithm === "none") blockers.push("checksum_algorithm_missing");
      if (row.backup_kind === "database" && row.encryption_scheme === "none") blockers.push("encryption_required_for_database");
      if (row.backup_kind === "database" && row.allowed_executor === "none") blockers.push("executor_not_enabled");
      const gate = { ok: true, action, policyKey, activationGateStatus: blockers.length ? "blocked" : "ready", blockers, note: "Activation gate only. No backup executed." };
      if (apply) {
        await conn.query(`UPDATE platform_backup_policies SET activation_gate_status=?, activation_gate_json=? WHERE policy_key=?`, [gate.activationGateStatus, JSON.stringify(gate), policyKey]);
        gate.recorded = true;
      }
      print(gate);
      return;
    }

    if (action === "activate-policy") {
      const policyKey = required(args, "policy_key");
      const actor = required(args, "actor");
      const token = clean(args.activation_token || "");
      if (token !== `ACTIVATE:${policyKey}`) throw new Error(`Activation requires --activation-token=ACTIVATE:${policyKey}`);
      const [rows] = await conn.query(`SELECT activation_gate_status FROM platform_backup_policies WHERE policy_key=? LIMIT 1`, [policyKey]);
      if (!rows[0]) throw new Error(`policy_key not found: ${policyKey}`);
      if (rows[0].activation_gate_status !== "ready") throw new Error(`Policy is not activation-ready: ${rows[0].activation_gate_status}`);
      const plan = { ok: true, action, mode: args.mode, policyKey, actor, note: "Policy activation only. No backup executed." };
      if (!apply) { print(plan); return; }
      await conn.query(`UPDATE platform_backup_policies SET status='active', activation_gate_status='active', approved_by=?, approved_at=NOW(), updated_by=? WHERE policy_key=?`, [actor, actor, policyKey]);
      print({ ...plan, applied: true });
      return;
    }

    if (action === "record-dry-run") {
      const policyKey = required(args, "policy_key");
      const policy = await getPolicy(conn, policyKey);
      if (!policy) throw new Error(`policy_key not found: ${policyKey}`);
      const plan = { ok: true, action, mode: args.mode, policyKey, runMode: 'dry_run', status: 'planned' };
      if (!apply) { print(plan); return; }
      const [result] = await conn.query(
        `INSERT INTO platform_backup_runs
          (run_id, policy_id, run_mode, status, manifest_json, initiated_by, created_at)
         VALUES (?, ?, 'dry_run', 'planned', ?, ?, NOW())`,
        [randomUUID(), policy.policy_id, JSON.stringify(parseJson(args.manifest_json, { note: 'dry-run record only; no backup executed' })), clean(args.actor || 'backup_copy_governance_helper')]
      );
      print({ ...plan, applied: true, affectedRows: result.affectedRows });
      return;
    }

    throw new Error(`Unsupported --action=${action}\n${usage()}`);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: { code: err.code || 'backup_copy_governance_helper_failed', message: err.message }, usage: usage() }, null, 2));
    process.exitCode = 1;
  } finally {
    conn.release();
    await getPool().end();
  }
}
main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || 'fatal', message: err.message }, usage: usage() }, null, 2));
  process.exitCode = 1;
});
