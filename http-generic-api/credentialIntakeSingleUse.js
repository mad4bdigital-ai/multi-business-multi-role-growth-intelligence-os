function intakeError(code, status) {
  return { ok: false, status, error: code };
}

async function rollbackQuietly(connection) {
  try { await connection.rollback(); } catch {}
}

export async function atomicallyConsumeCredentialIntakeSession({
  pool,
  tokenHash,
  validateSession = null,
  createConnection,
  now = () => Date.now(),
}) {
  if (!pool || typeof pool.getConnection !== "function") {
    throw new TypeError("A transactional pool is required.");
  }
  if (!tokenHash) throw new TypeError("tokenHash is required.");
  if (typeof createConnection !== "function") {
    throw new TypeError("createConnection callback is required.");
  }

  const connection = await pool.getConnection();
  let transactionOpen = false;
  try {
    await connection.beginTransaction();
    transactionOpen = true;

    const [rows] = await connection.query(
      `SELECT *
         FROM credential_intake_sessions
        WHERE token_hash = ?
        LIMIT 1
        FOR UPDATE`,
      [tokenHash],
    );
    const session = rows?.[0] || null;

    if (!session) {
      await rollbackQuietly(connection);
      transactionOpen = false;
      return intakeError("credential_intake_session_not_found", 404);
    }

    if (session.status !== "pending") {
      await rollbackQuietly(connection);
      transactionOpen = false;
      return intakeError(`credential_intake_session_${session.status}`, 410);
    }

    if (new Date(session.expires_at).getTime() <= now()) {
      await connection.query(
        `UPDATE credential_intake_sessions
            SET status = 'expired'
          WHERE session_id = ?
            AND status = 'pending'`,
        [session.session_id],
      );
      await connection.commit();
      transactionOpen = false;
      return intakeError("credential_intake_session_expired", 410);
    }

    const created = await createConnection({ connection, session });
    const connectionId = String(created?.connectionId || "").trim();
    if (!connectionId) {
      const error = new Error("Credential intake connection creation did not return connectionId.");
      error.code = "credential_intake_connection_id_missing";
      error.status = 500;
      throw error;
    }

    const [updateResult] = await connection.query(
      `UPDATE credential_intake_sessions
          SET status = 'used', used_at = NOW(), connection_id = ?
        WHERE session_id = ?
          AND status = 'pending'`,
      [connectionId, session.session_id],
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      const error = new Error("Credential intake session was consumed concurrently.");
      error.code = "credential_intake_session_conflict";
      error.status = 409;
      throw error;
    }

    await connection.commit();
    transactionOpen = false;
    return { ok: true, session, connectionId, created };
  } catch (error) {
    if (transactionOpen) await rollbackQuietly(connection);
    throw error;
  } finally {
    connection.release();
  }
}
