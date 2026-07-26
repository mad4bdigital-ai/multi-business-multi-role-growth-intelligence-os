#!/usr/bin/env node
import { getPool } from "../db.js";
import { writeExecutionEvidence } from "../executionEvidenceLogger.js";

const CONFIRMATION = "DISABLE_ROTATE_LOCAL_CONNECTOR_DEVICE";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    confirm: "",
    user_id: "",
    tenant_id: "",
    device_id: "",
    actor_id: "codex_governed_operator",
    reason: "tenant containment readiness remediation",
    record_execution_log: "true",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.apply = false;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
    const name = arg.slice(2).replace(/-/g, "_");
    if (!Object.prototype.hasOwnProperty.call(args, name)) throw new Error(`Unknown argument: ${arg}`);
    args[name] = String(argv[index + 1] || "");
    index += 1;
  }
  return args;
}

function boolOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function validateArgs(args) {
  const required = ["user_id", "tenant_id", "device_id"];
  const missing = required.filter((key) => !String(args[key] || "").trim());
  if (missing.length) {
    const err = new Error(`Missing required arguments: ${missing.join(", ")}`);
    err.code = "LOCAL_CONNECTOR_DEVICE_DISABLE_MISSING_ARGS";
    throw err;
  }
  if (args.apply && args.confirm !== CONFIRMATION) {
    const err = new Error(`Apply requires --confirm ${CONFIRMATION}`);
    err.code = "LOCAL_CONNECTOR_DEVICE_DISABLE_CONFIRMATION_REQUIRED";
    throw err;
  }
}

async function readDevice(connection, args) {
  const [[row]] = await connection.query(
    `SELECT config_id, user_id, tenant_id, device_id, is_enabled,
            cf_token IS NOT NULL AS cf_token_present,
            connector_secret IS NOT NULL AS connector_secret_present,
            connector_local_api_key IS NOT NULL AS connector_local_api_key_present,
            updated_at
       FROM local_connector_user_configs
      WHERE user_id = ? AND tenant_id = ? AND device_id = ?
      LIMIT 1`,
    [args.user_id, args.tenant_id, args.device_id]
  );
  return row || null;
}

async function disableAndRotateDevice(connection, args) {
  const [result] = await connection.query(
    `UPDATE local_connector_user_configs
        SET is_enabled = 0,
            cf_token = NULL,
            connector_secret = NULL,
            connector_local_api_key = NULL,
            updated_at = NOW()
      WHERE user_id = ? AND tenant_id = ? AND device_id = ?`,
    [args.user_id, args.tenant_id, args.device_id]
  );
  return { affected_rows: Number(result?.affectedRows || 0), changed_rows: Number(result?.changedRows || 0) };
}

async function main() {
  const args = parseArgs();
  validateArgs(args);
  const pool = getPool();
  const connection = await pool.getConnection();
  const traceId = `local-connector-disable-rotate:${args.tenant_id}:${args.user_id}:${args.device_id}:${Date.now()}`;
  try {
    const before = await readDevice(connection, args);
    if (!before) {
      console.log(JSON.stringify({
        ok: false,
        mode: args.apply ? "apply" : "dry_run",
        code: "LOCAL_CONNECTOR_DEVICE_NOT_FOUND",
        target: { user_id: args.user_id, tenant_id: args.tenant_id, device_id: args.device_id },
        secrets_included: false,
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    let update = null;
    let after = before;
    let executionLog = { trace_id: null, recorded: false, error: null };
    if (args.apply) {
      await connection.beginTransaction();
      update = await disableAndRotateDevice(connection, args);
      after = await readDevice(connection, args);
      await connection.commit();
      if (boolOption(args.record_execution_log, true)) {
        executionLog.trace_id = traceId;
        try {
          await writeExecutionEvidence({
            pool,
            traceId,
            entryType: "local_connector_device_disable_rotate",
            executionClass: "governed_operational_remediation",
            sourceLayer: "codex_operational_script",
            executionMode: "apply",
            decisionTrigger: "tenant_containment_readiness",
            executionStatus: "success",
            outputSummary: {
              target: { user_id: args.user_id, tenant_id: args.tenant_id, device_id: args.device_id },
              readback: {
                disabled: Number(after.is_enabled || 0) === 0,
                cf_token_cleared: !Boolean(after.cf_token_present),
                connector_secret_cleared: !Boolean(after.connector_secret_present),
                connector_local_api_key_cleared: !Boolean(after.connector_local_api_key_present),
              },
              no_provider_call: true,
              no_external_write: true,
              no_raw_secret_read: true,
              secrets_included: false,
            },
            tenantId: args.tenant_id,
            userId: args.user_id,
            actorId: args.actor_id,
            actorType: "codex_operator",
            toolKey: "local_connector_device_disable_rotate",
            resourceType: "local_connector_device",
            resourceId: args.device_id,
            targetType: "local_connector_user_configs",
            targetId: args.device_id,
            policyKeys: "tenant_containment_readiness_2026_06_18",
            runtimeEvidence: { script: "scripts/local-connector-device-disable-rotate.mjs", confirmation: CONFIRMATION, secrets_included: false },
            skipSurfaceAuthority: true,
          });
          executionLog.recorded = true;
        } catch (err) {
          executionLog.error = { code: err.code || "execution_log_write_failed", message: err.message };
        }
      }
    }

    console.log(JSON.stringify({
      ok: true,
      mode: args.apply ? "apply" : "dry_run",
      dry_run: !args.apply,
      will_disable: Boolean(before.is_enabled),
      will_clear_stored_credentials: Boolean(before.cf_token_present || before.connector_secret_present || before.connector_local_api_key_present),
      required_confirmation: CONFIRMATION,
      target: { user_id: args.user_id, tenant_id: args.tenant_id, device_id: args.device_id },
      before,
      update,
      after,
      readback: {
        disabled: Number(after.is_enabled || 0) === 0,
        cf_token_cleared: !Boolean(after.cf_token_present),
        connector_secret_cleared: !Boolean(after.connector_secret_present),
        connector_local_api_key_cleared: !Boolean(after.connector_local_api_key_present),
      },
      execution_log: executionLog,
      no_provider_call: true,
      no_external_write: true,
      no_raw_secret_read: true,
      secrets_included: false,
      actor_id: args.actor_id,
      reason: args.reason,
    }, null, 2));
  } catch (err) {
    try {
      if (args.apply) await connection.rollback();
    } catch {}
    console.error(JSON.stringify({
      ok: false,
      mode: args.apply ? "apply" : "dry_run",
      code: err.code || "LOCAL_CONNECTOR_DEVICE_DISABLE_ROTATE_FAILED",
      message: err.message,
      secrets_included: false,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

main();
