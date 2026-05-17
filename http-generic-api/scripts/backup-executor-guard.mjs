#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

function clean(value = "") { return String(value ?? "").trim(); }
function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", action: "plan-run" };
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
function print(payload) { console.log(JSON.stringify(payload, null, 2)); }

async function loadPolicy(conn, policyKey) {
  const [rows] = await conn.query(
    `SELECT p.*, s.location_key AS source_location_key, s.location_type AS source_location_type,
            s.provider AS source_provider, s.path_or_ref AS source_path_or_ref, s.status AS source_status,
            d.location_key AS destination_location_key, d.location_type AS destination_location_type,
            d.provider AS destination_provider, d.path_or_ref AS destination_path_or_ref, d.status AS destination_status,
            SUM(CASE WHEN a.approval_type='policy_activation' AND a.status='approved' THEN 1 ELSE 0 END) AS approved_count,
            SUM(CASE WHEN rt.status IN ('planned','passed') THEN 1 ELSE 0 END) AS restore_plan_count
       FROM platform_backup_policies p
       JOIN platform_copy_locations s ON s.location_id=p.source_location_id
       LEFT JOIN platform_copy_locations d ON d.location_id=p.destination_location_id
       LEFT JOIN platform_backup_approvals a ON a.policy_id=p.policy_id
       LEFT JOIN platform_backup_runs r ON r.policy_id=p.policy_id
       LEFT JOIN platform_restore_tests rt ON rt.backup_run_id=r.run_id
      WHERE p.policy_key=?
      GROUP BY p.policy_id, p.policy_key`,
    [policyKey]
  );
  return rows[0] || null;
}

function evaluateExecutionGate(policy) {
  const blockers = [];
  if (!policy) return ["policy_not_found"];
  if (policy.status !== "active") blockers.push("policy_not_active");
  if (!["ready", "active"].includes(policy.activation_gate_status)) blockers.push("activation_gate_not_ready");
  if (policy.preflight_required && policy.activation_gate_status !== "active") blockers.push("preflight_not_promoted_to_active");
  if (policy.approval_required && Number(policy.approved_count || 0) < 1) blockers.push("approval_not_granted");
  if (!policy.destination_location_key) blockers.push("missing_destination");
  if (policy.destination_status !== "active") blockers.push("destination_not_active");
  if (!policy.artifact_format || policy.artifact_format === "none") blockers.push("artifact_format_missing");
  if (!policy.checksum_algorithm || policy.checksum_algorithm === "none") blockers.push("checksum_algorithm_missing");
  if (policy.backup_kind === "database" && (!policy.encryption_scheme || policy.encryption_scheme === "none")) blockers.push("database_encryption_required");
  if (policy.allowed_executor === "none") blockers.push("executor_not_enabled");
  if (policy.backup_kind === "database" && policy.allowed_executor !== "local_connector") blockers.push("database_executor_must_be_local_connector_or_explicitly_changed");
  return blockers;
}

function buildPlan(policy, blockers) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `${policy.policy_key.replace(/[^a-zA-Z0-9._-]+/g, "_")}_${timestamp}`;
  const artifactExt = policy.artifact_format === "sql_dump" ? "sql.enc" : policy.artifact_format === "zip" ? "zip" : "artifact";
  const artifactRef = policy.destination_path_or_ref ? `${policy.destination_path_or_ref}\\artifacts\\${baseName}.${artifactExt}` : null;
  const manifestRef = policy.destination_path_or_ref ? `${policy.destination_path_or_ref}\\manifests\\${baseName}.manifest.json` : null;
  return {
    policyKey: policy.policy_key,
    backupKind: policy.backup_kind,
    allowedExecutor: policy.allowed_executor,
    source: {
      key: policy.source_location_key,
      type: policy.source_location_type,
      provider: policy.source_provider,
      ref: policy.source_path_or_ref
    },
    destination: {
      key: policy.destination_location_key,
      type: policy.destination_location_type,
      provider: policy.destination_provider,
      ref: policy.destination_path_or_ref
    },
    artifact: {
      ref: artifactRef,
      manifestRef,
      format: policy.artifact_format,
      encryption: policy.encryption_scheme,
      checksum: policy.checksum_algorithm,
      manifestSchemaVersion: policy.manifest_schema_version || "backup-manifest/v1"
    },
    executionStatus: blockers.length ? "blocked" : "ready",
    blockers,
    noBackupExecuted: true
  };
}

async function main() {
  const args = parseArgs();
  const action = clean(args.action || "plan-run");
  const apply = args.mode === "apply";
  const policyKey = required(args, "policy_key");
  const conn = await getPool().getConnection();
  try {
    const policy = await loadPolicy(conn, policyKey);
    if (!policy) throw new Error(`policy_key not found: ${policyKey}`);
    const blockers = evaluateExecutionGate(policy);
    const plan = buildPlan(policy, blockers);

    if (action === "plan-run") {
      print({ ok: true, action, mode: args.mode, plan, note: "Plan only. No backup executed." });
      return;
    }

    if (action === "prepare-run-record") {
      const payload = { ok: true, action, mode: args.mode, plan, note: "Creates metadata run record only when --apply is used. No backup executed." };
      if (!apply) { print(payload); return; }
      const runId = randomUUID();
      await conn.query(
        `INSERT INTO platform_backup_runs
          (run_id, policy_id, run_mode, status, artifact_format, encryption_scheme, checksum_algorithm,
           manifest_schema_version, preflight_status, preflight_json, destination_ref, manifest_json,
           initiated_by, started_at, completed_at)
         VALUES (?, ?, 'dry_run', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [runId, policy.policy_id, blockers.length ? "planned" : "planned", policy.artifact_format, policy.encryption_scheme,
          policy.checksum_algorithm, policy.manifest_schema_version || "backup-manifest/v1", blockers.length ? "blocked" : "passed",
          JSON.stringify({ executionGate: plan }), plan.artifact.ref, JSON.stringify({ plan, noBackupExecuted: true }), clean(args.actor || "backup_executor_guard")]
      );
      print({ ...payload, applied: true, runId });
      return;
    }

    if (action === "execute") {
      const payload = { ok: blockers.length === 0, action, mode: args.mode, plan, note: "Execution request evaluated. No implementation runs while blockers exist." };
      if (blockers.length) {
        print({ ...payload, ok: false, error: { code: "backup_execution_blocked", message: "Backup execution is blocked by governance gates.", blockers } });
        process.exitCode = 2;
        return;
      }
      if (!apply) { print({ ...payload, note: "Dry-run execute only. No backup executed." }); return; }
      throw new Error("Apply-mode backup execution is not implemented in this guard. Add a reviewed executor implementation before enabling.");
    }

    throw new Error(`Unsupported --action=${action}`);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: { code: err.code || "backup_executor_guard_failed", message: err.message } }, null, 2));
    process.exitCode = 1;
  } finally {
    conn.release();
    await getPool().end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "fatal", message: err.message } }, null, 2));
  process.exitCode = 1;
});
