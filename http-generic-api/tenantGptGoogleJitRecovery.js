function recoveryFailure(status, code, message) {
  const error = new Error(message);
  error.auth_status = status;
  error.auth_code = code;
  return error;
}

export function isDuplicateEntryError(error) {
  return error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062;
}

async function findGoogleCredentialUser(pool, providerId) {
  const [rows] = await pool.query(
    `SELECT u.user_id, u.email, u.display_name, u.status
       FROM \`user_credentials\` uc
       JOIN \`users\` u ON u.user_id = uc.user_id
      WHERE uc.auth_provider = 'google' AND uc.provider_id = ?
      LIMIT 1`,
    [providerId],
  );
  return rows[0] || null;
}

async function findUserByEmail(pool, email) {
  const [rows] = await pool.query(
    `SELECT user_id, email, display_name, status
       FROM \`users\`
      WHERE email = ?
      LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function ensureGoogleCredentialBinding(pool, userId, providerId) {
  try {
    await pool.query(
      `INSERT INTO \`user_credentials\` (user_id, auth_provider, provider_id)
       VALUES (?, 'google', ?)`,
      [userId, providerId],
    );
    return;
  } catch (error) {
    if (!isDuplicateEntryError(error)) throw error;
  }

  const raced = await findGoogleCredentialUser(pool, providerId);
  if (!raced || raced.user_id !== userId) {
    throw recoveryFailure(409, "google_identity_conflict", "This Google identity is already linked to another account.");
  }
}

export async function recoverGoogleJitIdentityAfterDuplicate({
  pool,
  provider_id,
  email,
  display_name,
  ensureWorkspace,
} = {}) {
  if (!pool || typeof pool.query !== "function" || typeof pool.getConnection !== "function") {
    throw new TypeError("A transactional pool is required.");
  }
  if (typeof ensureWorkspace !== "function") throw new TypeError("ensureWorkspace is required.");

  let user = await findGoogleCredentialUser(pool, provider_id);
  if (!user) {
    user = await findUserByEmail(pool, email);
    if (!user) return null;
    await ensureGoogleCredentialBinding(pool, user.user_id, provider_id);
  }

  if (user.status !== "active") {
    throw recoveryFailure(403, "account_inactive", "The existing account is not active.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `SELECT user_id FROM \`users\` WHERE user_id = ? FOR UPDATE`,
      [user.user_id],
    );
    const workspace = await ensureWorkspace(connection, {
      userId: user.user_id,
      email: user.email || email,
      displayName: user.display_name || display_name,
      source: "google_signup_race_recovery",
    });
    await connection.commit();
    return { user_id: user.user_id, workspace };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
