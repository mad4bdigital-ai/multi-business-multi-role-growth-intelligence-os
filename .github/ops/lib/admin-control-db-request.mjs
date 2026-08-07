import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONTRACT_URL = new URL('../../contracts/admin-control-db.v1.json', import.meta.url);
export const ADMIN_CONTROL_DB_CONTRACT = Object.freeze(JSON.parse(readFileSync(CONTRACT_URL, 'utf8')));

function requireContractShape() {
  const contract = ADMIN_CONTROL_DB_CONTRACT;
  assert.equal(contract.schema_version, 1, 'Unsupported admin DB control contract schema version.');
  assert.equal(contract.endpoint, '/admin/control', 'Admin DB control endpoint drifted.');
  assert.equal(contract.tool, 'db', 'Admin DB control tool drifted.');
  assert.equal(contract.request?.action, 'run', 'Admin DB control action drifted.');
  assert.equal(contract.request?.sql_field, 'sql', 'Admin DB control SQL field drifted.');
  return contract;
}

export function buildAdminControlDbReadRequest({
  sql,
  params = [],
  maxRows = 20,
  authorityContext,
} = {}) {
  const contract = requireContractShape();
  assert.equal(typeof sql, 'string', 'Admin DB control sql must be a string.');
  assert.ok(sql.trim(), 'Admin DB control sql must not be empty.');
  assert.ok(Array.isArray(params), 'Admin DB control params must be an array.');
  assert.ok(Number.isInteger(maxRows) && maxRows > 0, 'Admin DB control maxRows must be a positive integer.');
  assert.ok(authorityContext && typeof authorityContext === 'object', 'Admin DB control authorityContext is required.');

  return {
    tool: contract.tool,
    action: contract.request.action,
    [contract.request.sql_field]: sql,
    params,
    read_only: true,
    max_rows: maxRows,
    authority_context: authorityContext,
  };
}
