import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import mysql from "mysql2/promise";

const apiRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const migrationPath = path.join(apiRoot, "migrations", "20260922_local_manager_desktop_commands.sql");
const surfacePath = path.join(apiRoot, "activation-surfaces", "local_manager_desktop_commands.json");
const artifactPath = path.join(apiRoot, "artifacts", "local-manager-desktop-command-mariadb-certification.json");

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function safeIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(value)) throw new Error(`Unsafe ${label}: ${value}`);
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function denied(error) {
  return [1044, 1045, 1142, 1143, 1227].includes(Number(error?.errno))
    || /ACCESS_DENIED|COMMAND_DENIED|TABLEACCESS_DENIED|DBACCESS_DENIED|denied/i.test(String(error?.code || "") + " " + String(error?.message || ""));
}

async function expectDenied(label, fn) {
  try {
    await fn();
  } catch (error) {
    if (!denied(error)) throw error;
    return { label, denied: true, code: error.code || null, errno: Number(error.errno || 0) || null };
  }
  throw new Error(`${label} unexpectedly succeeded under the runtime principal`);
}

const mode = required("LM_DESKTOP_MARIADB_CERTIFICATION_MODE");
if (mode !== "disposable") throw new Error("Certification is restricted to LM_DESKTOP_MARIADB_CERTIFICATION_MODE=disposable");

const host = required("DB_HOST");
if (!["127.0.0.1", "localhost"].includes(host)) throw new Error("Disposable certification refuses non-local DB_HOST");
const port = 3306;
const database = safeIdentifier(required("DB_NAME"), "DB_NAME");
if (!/^lm_desktop_cert_/i.test(database)) throw new Error("Disposable certification DB_NAME must begin with lm_desktop_cert_");

const rootUser = "root";
const rootPassword = required("DB_ROOT_PASSWORD");
const runtimeUser = "lm_runtime_cert";
const runtimePassword = required("RUNTIME_DB_PASSWORD");

const migrationSql = fs.readFileSync(migrationPath, "utf8");
const migrationSha256 = sha256(migrationSql);
const surface = JSON.parse(fs.readFileSync(surfacePath, "utf8"));

const expectedStatuses = ["queued", "claimed", "completed", "failed", "expired", "cancelled"];
if (JSON.stringify(surface.active_status_values) !== JSON.stringify(expectedStatuses)) {
  throw new Error("Activation surface status taxonomy does not match the desktop command DB enum");
}
const forbiddenProjectionColumns = ["payload_json", "result_json", "request_context_json", "error_code", "error_message", "claim_token", "claim_lease_expires_at"];
for (const column of forbiddenProjectionColumns) {
  if (surface.result_columns.includes(column)) throw new Error(`Activation projection exposes forbidden column: ${column}`);
}

fs.mkdirSync(path.dirname(artifactPath), { recursive: true });

let root;
let runtime;
const evidence = {
  ok: false,
  report_type: "local_manager_desktop_command_mariadb_certification",
  schema_version: "v1",
  mode: "disposable",
  database,
  migration: path.basename(migrationPath),
  migration_sha256: migrationSha256,
  runtime_principal: runtimeUser,
  lifecycle: {},
  privilege_denials: [],
  projection: {},
  production_authorized: false,
  staging_apply_authorized: false,
  external_environment_touched: false,
  secrets_included: false,
};

try {
  root = await mysql.createConnection({
    host, port, user: rootUser, password: rootPassword, database,
    connectTimeout: 10000,
    multipleStatements: false,
  });

  await root.query(migrationSql);
  await root.query(`
    CREATE TABLE IF NOT EXISTS local_connector_device_aliases (
      alias_device_id VARCHAR(128) NOT NULL,
      canonical_device_id VARCHAR(128) NOT NULL,
      user_id VARCHAR(64) NULL,
      tenant_id VARCHAR(64) NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'active',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (alias_device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await root.query(`
    CREATE TABLE IF NOT EXISTS local_connector_user_configs (
      config_id VARCHAR(64) NOT NULL,
      tenant_id VARCHAR(64) NULL,
      user_id VARCHAR(64) NOT NULL,
      device_id VARCHAR(128) NOT NULL,
      hostname VARCHAR(255) NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      last_health_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (config_id),
      KEY idx_lm_cert_config (user_id, device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await root.query(
    "INSERT INTO local_connector_device_aliases (alias_device_id, canonical_device_id, user_id, tenant_id, status) VALUES (?, ?, ?, ?, 'active') ON DUPLICATE KEY UPDATE canonical_device_id=VALUES(canonical_device_id), status='active'",
    ["device-alias", "device-canonical", "user-cert", "tenant-cert"],
  );
  await root.query(
    "INSERT INTO local_connector_user_configs (config_id, tenant_id, user_id, device_id, hostname, is_enabled, last_health_at) VALUES (?, ?, ?, ?, ?, 1, NOW()) ON DUPLICATE KEY UPDATE last_health_at=NOW(), is_enabled=1",
    ["cfg-cert", "tenant-cert", "user-cert", "device-canonical", "cert-host"],
  );

  await root.query(`DROP USER IF EXISTS '${runtimeUser}'@'%'`);
  await root.query(`CREATE USER '${runtimeUser}'@'%' IDENTIFIED BY ?`, [runtimePassword]);
  await root.query(`GRANT SELECT, INSERT, UPDATE ON \`${database}\`.\`local_manager_desktop_commands\` TO '${runtimeUser}'@'%'`);
  await root.query(`GRANT SELECT ON \`${database}\`.\`local_connector_device_aliases\` TO '${runtimeUser}'@'%'`);
  await root.query(`GRANT SELECT ON \`${database}\`.\`local_connector_user_configs\` TO '${runtimeUser}'@'%'`);

  const [grantRows] = await root.query(`SHOW GRANTS FOR '${runtimeUser}'@'%'`);
  const grants = grantRows.map((row) => Object.values(row)[0]).filter(Boolean).map(String);
  const grantText = grants.join("\n");
  if (/GRANT OPTION|ALL PRIVILEGES/i.test(grantText)) throw new Error("Runtime certification principal received broad grant authority");
  if (/\bDELETE\b|\bCREATE\b|\bALTER\b|\bDROP\b/i.test(grantText)) throw new Error("Runtime certification principal received forbidden mutation/schema authority");
  evidence.grants = grants;

  runtime = await mysql.createConnection({
    host, port, user: runtimeUser, password: runtimePassword, database,
    connectTimeout: 10000,
  });

  const [schemaRows] = await runtime.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'local_manager_desktop_commands' ORDER BY ordinal_position",
    [database],
  );
  if (schemaRows.length < 22) throw new Error("Runtime principal cannot inspect the desktop command ownership schema");

  const [aliasRows] = await runtime.query("SELECT alias_device_id, canonical_device_id FROM local_connector_device_aliases WHERE user_id = ? LIMIT 5", ["user-cert"]);
  const [configRows] = await runtime.query("SELECT device_id, hostname FROM local_connector_user_configs WHERE user_id = ? LIMIT 5", ["user-cert"]);
  if (aliasRows.length !== 1 || configRows.length !== 1) throw new Error("Runtime principal cannot read desktop identity dependencies");
  evidence.identity_dependency_readback = { aliases: aliasRows.length, configs: configRows.length };

  const commandId = "cmd-cert-main";
  await runtime.query(
    `INSERT INTO local_manager_desktop_commands
      (command_id, tenant_id, user_id, device_id, execution_mode, action, status, priority, payload_json, requested_by, request_context_json, expires_at)
     VALUES (?, ?, ?, ?, 'desktop', 'notify', 'queued', 10, JSON_OBJECT('message','cert'), 'certification', JSON_OBJECT('source','disposable'), DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
    [commandId, "tenant-cert", "user-cert", "device-canonical"],
  );

  const [queued] = await runtime.query(
    "SELECT command_id, status FROM local_manager_desktop_commands WHERE user_id=? AND device_id=? AND status='queued' ORDER BY priority ASC, created_at ASC LIMIT 5",
    ["user-cert", "device-canonical"],
  );
  if (queued.length !== 1 || queued[0].command_id !== commandId) throw new Error("Queued desktop command was not pollable");
  evidence.lifecycle.queued = true;

  const claimToken = "claim-cert-primary";
  const competingClaimToken = "claim-cert-competing";
  const [claimResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='claimed', claimed_at=NOW(), claim_token=?, claim_lease_expires_at=DATE_ADD(NOW(), INTERVAL 120 SECOND)
      WHERE command_id=? AND status='queued'`,
    [claimToken, commandId],
  );
  if (Number(claimResult.affectedRows) !== 1) throw new Error("Desktop command atomic claim failed");
  const [competingClaimResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='claimed', claimed_at=NOW(), claim_token=?, claim_lease_expires_at=DATE_ADD(NOW(), INTERVAL 120 SECOND)
      WHERE command_id=? AND status='queued'`,
    [competingClaimToken, commandId],
  );
  if (Number(competingClaimResult.affectedRows) !== 0) throw new Error("Competing poller claimed an already-owned desktop command");
  const [[claimedRow]] = await runtime.query(
    "SELECT status, claim_token, claim_lease_expires_at FROM local_manager_desktop_commands WHERE command_id=?",
    [commandId],
  );
  if (claimedRow?.status !== "claimed" || claimedRow?.claim_token !== claimToken || !claimedRow?.claim_lease_expires_at) {
    throw new Error("Desktop command claim ownership proof was not persisted");
  }
  evidence.lifecycle.claimed = true;
  evidence.lifecycle.atomic_claim = true;
  evidence.lifecycle.duplicate_claim_rejected = true;

  const [heartbeatResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET claim_lease_expires_at=DATE_ADD(NOW(), INTERVAL 120 SECOND)
      WHERE command_id=? AND status='claimed' AND claim_token=? AND claim_lease_expires_at > NOW()`,
    [commandId, claimToken],
  );
  if (Number(heartbeatResult.affectedRows) !== 1) throw new Error("Desktop command claim heartbeat failed");
  evidence.lifecycle.heartbeat_extended = true;

  const [wrongCompletionResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='completed', completed_at=NOW(), claim_token=NULL, claim_lease_expires_at=NULL
      WHERE command_id=? AND status='claimed' AND claim_token=? AND claim_lease_expires_at > NOW()`,
    [commandId, competingClaimToken],
  );
  if (Number(wrongCompletionResult.affectedRows) !== 0) throw new Error("Wrong claim token completed a desktop command");
  evidence.lifecycle.wrong_completion_rejected = true;

  const [completeResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='completed', result_json=JSON_OBJECT('ok', true, 'secrets_included', false), completed_at=NOW(), claim_token=NULL, claim_lease_expires_at=NULL
      WHERE command_id=? AND status='claimed' AND claim_token=? AND claim_lease_expires_at > NOW()`,
    [commandId, claimToken],
  );
  if (Number(completeResult.affectedRows) !== 1) throw new Error("Desktop command owned completion failed");
  evidence.lifecycle.completed = true;

  const [terminalRewriteResult] = await runtime.query(
    "UPDATE local_manager_desktop_commands SET status='failed' WHERE command_id=? AND status='claimed' AND claim_token=?",
    [commandId, claimToken],
  );
  if (Number(terminalRewriteResult.affectedRows) !== 0) throw new Error("Terminal desktop command was rewritten");
  evidence.lifecycle.terminal_rewrite_rejected = true;

  const leaseId = "cmd-cert-lease";
  await runtime.query(
    `INSERT INTO local_manager_desktop_commands
      (command_id, tenant_id, user_id, device_id, execution_mode, action, status, priority, expires_at)
     VALUES (?, ?, ?, ?, 'desktop', 'notify', 'queued', 15, DATE_ADD(NOW(), INTERVAL 5 MINUTE))`,
    [leaseId, "tenant-cert", "user-cert", "device-canonical"],
  );
  await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='claimed', claimed_at=NOW(), claim_token='claim-cert-lease', claim_lease_expires_at=DATE_SUB(NOW(), INTERVAL 1 SECOND)
      WHERE command_id=? AND status='queued'`,
    [leaseId],
  );
  const [requeueResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='queued', claimed_at=NULL, claim_token=NULL, claim_lease_expires_at=NULL, error_code=NULL, error_message=NULL
      WHERE status='claimed'
        AND (claim_lease_expires_at IS NULL OR claim_lease_expires_at < NOW())
        AND (expires_at IS NULL OR expires_at >= NOW())`,
  );
  if (Number(requeueResult.affectedRows) < 1) throw new Error("Expired claim lease was not requeued independently of enqueue TTL");
  const [[requeuedRow]] = await runtime.query("SELECT status, claim_token FROM local_manager_desktop_commands WHERE command_id=?", [leaseId]);
  if (requeuedRow?.status !== "queued" || requeuedRow?.claim_token !== null) throw new Error("Expired lease requeue retained claim ownership");
  evidence.lifecycle.lease_requeued = true;

  const expiredId = "cmd-cert-expired";
  await runtime.query(
    `INSERT INTO local_manager_desktop_commands
      (command_id, tenant_id, user_id, device_id, execution_mode, action, status, priority, expires_at)
     VALUES (?, ?, ?, ?, 'desktop', 'notify', 'queued', 20, DATE_SUB(NOW(), INTERVAL 1 SECOND))`,
    [expiredId, "tenant-cert", "user-cert", "device-canonical"],
  );
  const [expireResult] = await runtime.query(
    `UPDATE local_manager_desktop_commands
        SET status='expired', error_code='command_expired', error_message='Command expired before claim.', claim_token=NULL, claim_lease_expires_at=NULL
      WHERE status='queued' AND expires_at IS NOT NULL AND expires_at < NOW()`,
  );
  if (Number(expireResult.affectedRows) < 1) throw new Error("Desktop command enqueue expiry transition failed");
  evidence.lifecycle.expired = true;

  const selectColumns = surface.result_columns.map((column) => `\`${column}\``).join(", ");
  const statusPlaceholders = surface.active_status_values.map(() => "?").join(", ");
  const [projectionRows] = await runtime.query(
    `SELECT ${selectColumns} FROM \`${surface.source_table}\` WHERE tenant_id=? AND user_id=? AND status IN (${statusPlaceholders}) ORDER BY updated_at DESC LIMIT ?`,
    ["tenant-cert", "user-cert", ...surface.active_status_values, Number(surface.max_rows || 50)],
  );
  const projectedStatuses = [...new Set(projectionRows.map((row) => row.status))].sort();
  if (!projectedStatuses.includes("completed") || !projectedStatuses.includes("expired")) {
    throw new Error("Activation projection did not expose completed and expired lifecycle metadata");
  }
  for (const row of projectionRows) {
    for (const forbidden of forbiddenProjectionColumns) {
      if (Object.prototype.hasOwnProperty.call(row, forbidden)) throw new Error(`Projection leaked forbidden field: ${forbidden}`);
    }
  }
  evidence.projection = {
    row_count: projectionRows.length,
    statuses: projectedStatuses,
    result_columns: [...surface.result_columns],
    forbidden_columns_exposed: [],
  };

  evidence.privilege_denials.push(await expectDenied("delete", () => runtime.query("DELETE FROM local_manager_desktop_commands WHERE command_id=?", [commandId])));
  evidence.privilege_denials.push(await expectDenied("create", () => runtime.query("CREATE TABLE lm_runtime_forbidden_create (id INT)")));
  evidence.privilege_denials.push(await expectDenied("alter", () => runtime.query("ALTER TABLE local_manager_desktop_commands ADD COLUMN forbidden_probe INT NULL")));

  const [finalRows] = await runtime.query("SELECT command_id, status, claim_token FROM local_manager_desktop_commands WHERE command_id IN (?, ?, ?) ORDER BY command_id", [commandId, leaseId, expiredId]);
  evidence.lifecycle.final_rows = finalRows;
  evidence.lifecycle.route_cycle_complete = finalRows.some((row) => row.command_id === commandId && row.status === "completed" && row.claim_token === null)
    && finalRows.some((row) => row.command_id === leaseId && row.status === "queued" && row.claim_token === null)
    && finalRows.some((row) => row.command_id === expiredId && row.status === "expired");

  evidence.ok = evidence.lifecycle.route_cycle_complete
    && evidence.lifecycle.atomic_claim === true
    && evidence.lifecycle.duplicate_claim_rejected === true
    && evidence.lifecycle.heartbeat_extended === true
    && evidence.lifecycle.wrong_completion_rejected === true
    && evidence.lifecycle.terminal_rewrite_rejected === true
    && evidence.lifecycle.lease_requeued === true
    && evidence.privilege_denials.every((item) => item.denied === true)
    && evidence.projection.forbidden_columns_exposed.length === 0;

  fs.writeFileSync(artifactPath, JSON.stringify(evidence, null, 2) + "\n");
  if (!evidence.ok) throw new Error("Disposable Local Manager desktop command certification did not converge");
  console.log(JSON.stringify({ ok: true, artifact: path.relative(apiRoot, artifactPath), migration_sha256: migrationSha256, secrets_included: false }));
} catch (error) {
  evidence.error = { code: error.code || "certification_failed", message: String(error.message || error).slice(0, 500) };
  evidence.ok = false;
  try { fs.writeFileSync(artifactPath, JSON.stringify(evidence, null, 2) + "\n"); } catch {}
  throw error;
} finally {
  if (runtime) await runtime.end().catch(() => {});
  if (root) {
    await root.query(`DROP USER IF EXISTS '${runtimeUser}'@'%'`).catch(() => {});
    await root.end().catch(() => {});
  }
}
