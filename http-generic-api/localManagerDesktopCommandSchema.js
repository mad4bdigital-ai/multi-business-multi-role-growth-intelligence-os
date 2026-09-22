export const LOCAL_MANAGER_DESKTOP_COMMAND_MIGRATION = "20260922_local_manager_desktop_commands.sql";
export const LOCAL_MANAGER_DESKTOP_COMMAND_TABLE = "local_manager_desktop_commands";

const REQUIRED_COLUMNS = Object.freeze([
  "command_id", "tenant_id", "user_id", "device_id", "execution_mode", "action", "status",
  "priority", "requires_user_confirmation", "payload_json", "result_json", "requested_by",
  "request_context_json", "error_code", "error_message", "created_at", "claimed_at",
  "completed_at", "expires_at", "updated_at",
]);

export async function assertLocalManagerDesktopCommandSchema(pool) {
  const [rows] = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [LOCAL_MANAGER_DESKTOP_COMMAND_TABLE],
  );
  const present = new Set((rows || []).map((row) => String(row.column_name || row.COLUMN_NAME || "")));
  const missing = REQUIRED_COLUMNS.filter((column) => !present.has(column));
  if (missing.length) {
    const error = new Error("Local Manager desktop command schema is not ready; apply the governed migration before polling.");
    error.status = 503;
    error.code = "local_manager_desktop_command_schema_not_ready";
    error.details = {
      table: LOCAL_MANAGER_DESKTOP_COMMAND_TABLE,
      migration: LOCAL_MANAGER_DESKTOP_COMMAND_MIGRATION,
      missing_columns: missing,
      migration_apply_required: true,
      database_mutation_performed: false,
      secrets_included: false,
    };
    throw error;
  }
  return { ok: true, table: LOCAL_MANAGER_DESKTOP_COMMAND_TABLE, migration_apply_required: false, secrets_included: false };
}
