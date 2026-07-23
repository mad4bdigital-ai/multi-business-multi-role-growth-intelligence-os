import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { OperationRegistryContractError, isMutableOperationStatus, normalizeOperationDefinition, operationRevisionHash, requireOperationRevisionHash, stableOperationHash } from "./operationRegistryContracts.js";

function fail(code, message, status = 400, details = {}) {
  throw new OperationRegistryContractError(code, message, status, details);
}

function parseJson(value, field) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { fail("operation_registry_invalid_persisted_json", `${field} contains invalid persisted JSON.`, 500, { field }); }
}

function jsonParam(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

async function readVersion(connection, operationKey, version, { forUpdate = false } = {}) {
  const [rows] = await connection.query(
    `SELECT id,operation_id,operation_key,version,display_name,description,operation_class,scope_type,risk_level,
            execution_mode,input_schema_json,output_schema_json,status,revision_hash,source_revision_hash,
            compiler_version,metadata_json,created_by,created_at,updated_at,activated_at,superseded_at
       FROM operation_registry
      WHERE operation_key=? AND version=?
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [operationKey, version]
  );
  const row = rows?.[0];
  if (!row) return null;
  const [stepRows] = await connection.query(
    `SELECT step_id,step_key,step_order,depends_on_json,handler_key,capability_key,input_mapping_json,
            success_condition_json,retry_policy_json,failure_policy_json,timeout_seconds,compensation_required,
            compensation_policy_key,status,revision_hash,metadata_json,created_by,created_at,updated_at
       FROM operation_step_registry
      WHERE operation_registry_id=?
      ORDER BY step_order ASC,step_key ASC`,
    [row.id]
  );
  return {
    id: Number(row.id),
    operation_id: row.operation_id,
    revision_hash: row.revision_hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
    activated_at: row.activated_at,
    superseded_at: row.superseded_at,
    definition: {
      operation_key: row.operation_key,
      version: Number(row.version),
      display_name: row.display_name,
      description: row.description,
      operation_class: row.operation_class,
      scope_type: row.scope_type,
      risk_level: row.risk_level,
      execution_mode: row.execution_mode,
      input_schema_json: parseJson(row.input_schema_json, "input_schema_json"),
      output_schema_json: parseJson(row.output_schema_json, "output_schema_json"),
      status: row.status,
      source_revision_hash: row.source_revision_hash,
      compiler_version: row.compiler_version,
      metadata_json: parseJson(row.metadata_json, "metadata_json"),
      created_by: row.created_by,
      steps: (stepRows || []).map((step) => ({
        step_key: step.step_key,
        step_order: Number(step.step_order),
        depends_on: parseJson(step.depends_on_json, `${step.step_key}.depends_on_json`) || [],
        handler_key: step.handler_key,
        capability_key: step.capability_key,
        input_mapping_json: parseJson(step.input_mapping_json, `${step.step_key}.input_mapping_json`),
        success_condition_json: parseJson(step.success_condition_json, `${step.step_key}.success_condition_json`),
        retry_policy_json: parseJson(step.retry_policy_json, `${step.step_key}.retry_policy_json`),
        failure_policy_json: parseJson(step.failure_policy_json, `${step.step_key}.failure_policy_json`),
        timeout_seconds: step.timeout_seconds === null ? null : Number(step.timeout_seconds),
        compensation_required: Boolean(step.compensation_required),
        compensation_policy_key: step.compensation_policy_key,
        status: step.status,
        metadata_json: parseJson(step.metadata_json, `${step.step_key}.metadata_json`),
      })),
    },
  };
}

async function writeSteps(connection, operationRegistryId, definition, uuid) {
  for (const step of definition.steps) {
    const { status: _status, ...semanticStep } = step;
    const revisionHash = stableOperationHash({ operation_key: definition.operation_key, version: definition.version, ...semanticStep });
    await connection.query(
      `INSERT INTO operation_step_registry
        (step_id,operation_registry_id,step_key,step_order,depends_on_json,handler_key,capability_key,input_mapping_json,
         success_condition_json,retry_policy_json,failure_policy_json,timeout_seconds,compensation_required,
         compensation_policy_key,status,revision_hash,metadata_json,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [uuid(), operationRegistryId, step.step_key, step.step_order, jsonParam(step.depends_on), step.handler_key, step.capability_key,
        jsonParam(step.input_mapping_json), jsonParam(step.success_condition_json), jsonParam(step.retry_policy_json),
        jsonParam(step.failure_policy_json), step.timeout_seconds, step.compensation_required ? 1 : 0,
        step.compensation_policy_key, step.status, revisionHash, jsonParam(step.metadata_json), definition.created_by]
    );
  }
}

function verifyReadback(readback, definition, revisionHash) {
  if (!readback) fail("operation_registry_readback_missing", "Operation write completed without a readback row.", 500);
  if (readback.revision_hash !== revisionHash) fail("operation_registry_readback_revision_mismatch", "Operation readback revision does not match the write revision.", 500, { expected_revision_hash: revisionHash, observed_revision_hash: readback.revision_hash });
  const observedHash = operationRevisionHash(readback.definition);
  if (observedHash !== revisionHash) fail("operation_registry_readback_contract_mismatch", "Operation readback contract does not match the persisted contract.", 500, { expected_revision_hash: revisionHash, observed_contract_hash: observedHash });
  if (readback.definition.steps.length !== definition.steps.length) fail("operation_registry_readback_step_count_mismatch", "Operation readback step count does not match the write.", 500);
}

function deps(input = {}) {
  return { pool: input.pool || getPool(), uuid: input.uuid || randomUUID };
}

export async function createOperationVersion(input, dependencies = {}) {
  const resolved = deps(dependencies);
  const definition = normalizeOperationDefinition(input, { mutableOnly: true });
  const revisionHash = operationRevisionHash(definition);
  const connection = await resolved.pool.getConnection();
  try {
    await connection.beginTransaction();
    const [existing] = await connection.query("SELECT id,operation_id,revision_hash,status FROM operation_registry WHERE operation_key=? AND version=? LIMIT 1 FOR UPDATE", [definition.operation_key, definition.version]);
    if (existing?.[0]) fail("operation_registry_version_exists", "The requested operation version already exists.", 409, { operation_id: existing[0].operation_id });
    const operationId = resolved.uuid();
    const [insert] = await connection.query(
      `INSERT INTO operation_registry
        (operation_id,operation_key,version,display_name,description,operation_class,scope_type,risk_level,
         execution_mode,input_schema_json,output_schema_json,status,revision_hash,source_revision_hash,
         compiler_version,metadata_json,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [operationId, definition.operation_key, definition.version, definition.display_name, definition.description,
        definition.operation_class, definition.scope_type, definition.risk_level, definition.execution_mode,
        jsonParam(definition.input_schema_json), jsonParam(definition.output_schema_json), definition.status,
        revisionHash, definition.source_revision_hash, definition.compiler_version, jsonParam(definition.metadata_json), definition.created_by]
    );
    const internalId = Number(insert?.insertId || 0);
    if (!internalId) fail("operation_registry_insert_id_missing", "Operation insert did not return an internal identifier.", 500);
    await writeSteps(connection, internalId, definition, resolved.uuid);
    const readback = await readVersion(connection, definition.operation_key, definition.version);
    verifyReadback(readback, definition, revisionHash);
    await connection.commit();
    return { ok: true, report_type: "operation_registry_create", operation_id: operationId, operation_registry_id: internalId, revision_hash: revisionHash, operation: readback, readback_complete: true, provider_calls_performed: false, external_writes_performed: false, runtime_activation_changed: false, secrets_included: false };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

export async function getOperationVersion(operationKey, version, dependencies = {}) {
  const resolved = deps(dependencies);
  const key = String(operationKey || "").trim().toLowerCase();
  const number = Number(version);
  if (!/^[a-z0-9][a-z0-9._-]{2,190}$/.test(key) || !Number.isInteger(number) || number < 1) fail("operation_registry_identity_invalid", "operation_key and version are invalid.", 400);
  const connection = await resolved.pool.getConnection();
  try {
    const operation = await readVersion(connection, key, number);
    if (!operation) fail("operation_registry_version_not_found", "The requested operation version was not found.", 404, { operation_key: key, version: number });
    return { ok: true, report_type: "operation_registry_get", operation, read_only: true, secrets_included: false };
  } finally { connection.release(); }
}

export async function updateMutableOperationVersion(args = {}, dependencies = {}) {
  const resolved = deps(dependencies);
  const operationKey = String(args.operation_key || "").trim().toLowerCase();
  const version = Number(args.version);
  const expectedRevisionHash = requireOperationRevisionHash(args.expected_revision_hash);
  if (!/^[a-z0-9][a-z0-9._-]{2,190}$/.test(operationKey) || !Number.isInteger(version) || version < 1) fail("operation_registry_update_identity_invalid", "operation_key and version are invalid.", 400);
  const connection = await resolved.pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await readVersion(connection, operationKey, version, { forUpdate: true });
    if (!current) fail("operation_registry_version_not_found", "The requested operation version was not found.", 404, { operation_key: operationKey, version });
    if (!isMutableOperationStatus(current.definition.status)) fail("operation_registry_version_immutable", "Non-draft operation versions cannot be modified in place.", 409, { status: current.definition.status });
    if (current.revision_hash !== expectedRevisionHash) fail("operation_registry_revision_conflict", "The expected revision does not match the current operation revision.", 409, { expected_revision_hash: expectedRevisionHash, current_revision_hash: current.revision_hash });
    const definition = normalizeOperationDefinition({ ...(args.definition || {}), operation_key: operationKey, version, created_by: current.definition.created_by }, { mutableOnly: true });
    const revisionHash = operationRevisionHash(definition);
    await connection.query(
      `UPDATE operation_registry SET display_name=?,description=?,operation_class=?,scope_type=?,risk_level=?,execution_mode=?,
       input_schema_json=?,output_schema_json=?,status=?,revision_hash=?,source_revision_hash=?,compiler_version=?,metadata_json=? WHERE id=?`,
      [definition.display_name, definition.description, definition.operation_class, definition.scope_type, definition.risk_level,
        definition.execution_mode, jsonParam(definition.input_schema_json), jsonParam(definition.output_schema_json), definition.status,
        revisionHash, definition.source_revision_hash, definition.compiler_version, jsonParam(definition.metadata_json), current.id]
    );
    await connection.query("DELETE FROM operation_step_registry WHERE operation_registry_id=?", [current.id]);
    await writeSteps(connection, current.id, definition, resolved.uuid);
    const readback = await readVersion(connection, operationKey, version);
    verifyReadback(readback, definition, revisionHash);
    await connection.commit();
    return { ok: true, report_type: "operation_registry_update_mutable", operation_id: current.operation_id, previous_revision_hash: current.revision_hash, revision_hash: revisionHash, operation: readback, readback_complete: true, provider_calls_performed: false, external_writes_performed: false, runtime_activation_changed: false, secrets_included: false };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally { connection.release(); }
}

export function createOperationRegistryRepository(dependencies = {}) {
  return Object.freeze({
    createVersion: (input) => createOperationVersion(input, dependencies),
    getVersion: (operationKey, version) => getOperationVersion(operationKey, version, dependencies),
    updateMutableVersion: (args) => updateMutableOperationVersion(args, dependencies),
  });
}
