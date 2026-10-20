// MariaDB reports JSON as LONGTEXT. No schema mutations are performed here.
export const DEVICE_LINK_COLUMNS = Object.freeze({
  session_id: ["varchar",64,"NO"], display_code: ["varchar",16,"YES"],
  display_code_hash: ["char",64,"NO"], poll_token_hash: ["char",64,"NO"],
  status: ["enum",null,"NO"], device_id: ["varchar",128,"NO"],
  hostname: ["varchar",255,"YES"], platform: ["varchar",32,"YES"],
  app_version: ["varchar",80,"YES"], user_id: ["varchar",64,"YES"], tenant_id: ["varchar",64,"YES"],
  approved_at: ["datetime",null,"YES"], completed_at: ["datetime",null,"YES"], expires_at: ["datetime",null,"NO"],
  device_token_jti: ["varchar",64,"YES"], device_token_issued_at: ["datetime",null,"YES"],
  revoked_at: ["datetime",null,"YES"], revoked_by_user_id: ["varchar",64,"YES"],
  metadata_json: ["json|longtext",null,"YES"], created_at: ["datetime",null,"NO"], updated_at: ["datetime",null,"NO"],
});
export function evaluateDeviceLinkSchema(columns, indexes) {
  const byName = new Map(columns.map(row => [row.COLUMN_NAME,row]));
  const missing = [], incompatible = [];
  for (const [name,[type,length,nullable]] of Object.entries(DEVICE_LINK_COLUMNS)) {
    const row = byName.get(name);
    if (!row) { missing.push(name); continue; }
    if (!type.split("|").includes(String(row.DATA_TYPE).toLowerCase())
      || (length && Number(row.CHARACTER_MAXIMUM_LENGTH) < length) || row.IS_NULLABLE !== nullable
      || (name === "status" && ["pending","approved","completed","expired","revoked"].some(value => !String(row.COLUMN_TYPE).includes(`'${value}'`)))) incompatible.push(name);
  }
  const groups = new Map();
  for (const row of indexes) { const group = groups.get(row.INDEX_NAME) || []; group.push(row); groups.set(row.INDEX_NAME,group); }
  const missingUnique = ["session_id","display_code_hash","poll_token_hash"].filter(column => ![...groups.values()].some(rows => {
    if (rows.length !== 1) return false;
    const [only] = rows;
    return Number(only.NON_UNIQUE) === 0 && only.COLUMN_NAME === column && only.SUB_PART == null;
  }));
  return { ready: !missing.length && !incompatible.length && !missingUnique.length,
    missing_columns: missing, incompatible_columns: incompatible, missing_unique_keys: missingUnique,
    migration_required: "20260922_local_manager_device_link_authority.sql",
    database_mutation_performed: false, privileges_verified: false, secrets_included: false };
}
export async function inspectDeviceLinkSchema(pool) {
  const [columns] = await pool.query(`SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'local_manager_device_link_sessions'`);
  const [indexes] = await pool.query(`SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX, SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'local_manager_device_link_sessions'`);
  return evaluateDeviceLinkSchema(columns,indexes);
}
