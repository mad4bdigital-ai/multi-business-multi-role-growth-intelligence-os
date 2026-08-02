import { randomUUID } from "node:crypto";

export async function withManagedTransaction(pool, operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

export async function appendManagedEvent(connection, { bindingId, runId, tenantId, eventType, fromState = null, toState = null, actorId = null, evidence = {} }) {
  await connection.query(
    `INSERT INTO managed_execution_events
       (event_id, binding_id, run_id, tenant_id, event_type, from_state, to_state, actor_id, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), bindingId, runId, tenantId, eventType, fromState, toState, actorId, JSON.stringify({ ...evidence, secrets_included: false })],
  );
}
