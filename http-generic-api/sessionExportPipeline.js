import { getPool } from "./db.js";
import { uploadContentToDrive, fetchDriveContent, getOrCreateDriveFolder } from "./uploadPipeline.js";

// ---------------------------------------------------------------------------
// Build hierarchical file path for gpt_action sessions:
//   SESSIONS_DRIVE_FOLDER_ID/{year-month}/{day}/{userSlug}_{HH-MM-SS}_{shortId}.json
// ---------------------------------------------------------------------------
function buildSessionFilePath(session) {
  const ts = session.started_at ? new Date(session.started_at) : new Date();
  const yearMonth = ts.toISOString().slice(0, 7);
  const day = ts.toISOString().slice(8, 10);
  const time = ts.toISOString().slice(11, 19).replace(/:/g, "-");
  const userSlug = (session.user_id || "admin").slice(0, 12).replace(/[^a-z0-9]/gi, "_").toLowerCase();
  const shortId = String(session.session_id).slice(-8);
  return { yearMonth, day, filename: `${userSlug}_${time}_${shortId}.json` };
}

// ---------------------------------------------------------------------------
// Resolve the best email address to share the Drive export with.
// Priority: explicit override → user.email from users table → null (no share).
// ---------------------------------------------------------------------------
async function resolveShareEmail(pool, userId, emailOverride) {
  if (emailOverride && emailOverride.includes("@")) return emailOverride;
  if (!userId) return null;
  const [rows] = await pool.query(
    "SELECT email FROM `users` WHERE user_id = ? LIMIT 1",
    [userId]
  ).catch(() => [[]]);
  return rows[0]?.email || null;
}

// ---------------------------------------------------------------------------
// Export a single session to Drive.
// Returns { session_id, drive_file_id, drive_web_url, size_bytes, shared_with }
// ---------------------------------------------------------------------------
export async function exportSessionToDrive(sessionId, userEmailOverride = null) {
  const pool = getPool();

  const [[sessions], [turns], [events], [summaries]] = await Promise.all([
    pool.query("SELECT * FROM `customer_sessions` WHERE session_id = ? LIMIT 1", [sessionId]),
    pool.query(
      "SELECT * FROM `session_turns` WHERE session_id = ? ORDER BY turn_index ASC",
      [sessionId]
    ),
    pool.query(
      "SELECT * FROM `session_events` WHERE session_id = ? ORDER BY event_timestamp ASC, id ASC",
      [sessionId]
    ),
    pool.query(
      "SELECT * FROM `session_summaries` WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
      [sessionId]
    ).catch(() => [[]]),
  ]);

  const session = sessions[0];
  if (!session) {
    throw Object.assign(new Error(`Session ${sessionId} not found`), { status: 404 });
  }

  const shareEmail = await resolveShareEmail(pool, session.user_id, userEmailOverride);

  // Load the full raw dump from Drive if available — it contains complete event payloads.
  let rawRecords = null;
  if (session.raw_drive_id) {
    try {
      rawRecords = (await fetchDriveContent(session.raw_drive_id))
        .split("\n").filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    } catch {
      rawRecords = null;
    }
  }

  // Re-inflate base_instructions if it was offloaded.
  let baseInstructions = session.base_instructions_text || null;
  if (!baseInstructions && session.base_instructions_drive_id) {
    try {
      baseInstructions = await fetchDriveContent(session.base_instructions_drive_id);
    } catch {
      baseInstructions = null;
    }
  }

  const doc = {
    exported_at: new Date().toISOString(),
    session: { ...session, base_instructions_text: baseInstructions },
    turns,
    events,         // lean structured index from DB
    raw_records: rawRecords,  // full content from Drive (null if not yet available)
    summary: summaries[0] || null,
  };

  let filename;
  let folderIdOverride = null;
  const sessionsDriveRoot = process.env.SESSIONS_DRIVE_FOLDER_ID;

  if (session.originator === "gpt_action" && sessionsDriveRoot) {
    const { yearMonth, day, filename: gptFilename } = buildSessionFilePath(session);
    const monthFolderId = await getOrCreateDriveFolder(yearMonth, sessionsDriveRoot);
    const dayFolderId = await getOrCreateDriveFolder(day, monthFolderId);
    folderIdOverride = dayFolderId;
    filename = gptFilename;
  } else {
    filename = `session_${sessionId}_${new Date().toISOString().slice(0, 10)}.json`;
  }

  const driveResult = await uploadContentToDrive(
    JSON.stringify(doc, null, 2),
    filename,
    "application/json",
    shareEmail,
    folderIdOverride
  );

  await pool.query(
    `UPDATE \`customer_sessions\`
     SET drive_export_id = ?, drive_export_url = ?, drive_exported_at = NOW()
     WHERE session_id = ?`,
    [driveResult.drive_file_id, driveResult.drive_web_url, sessionId]
  );

  return {
    session_id: sessionId,
    drive_file_id: driveResult.drive_file_id,
    drive_web_url: driveResult.drive_web_url,
    size_bytes: driveResult.size_bytes,
    shared_with: shareEmail,
  };
}

// ---------------------------------------------------------------------------
// Bulk export — export each matching session individually.
// Returns { exported, failed, results[] }
// ---------------------------------------------------------------------------
export async function bulkExportSessionsToDrive({
  tenant_id,
  originator = null,
  date_from = null,
  date_to = null,
  session_ids = null,
  user_email_override = null,
  limit = 50,
}) {
  const pool = getPool();

  let sql = "SELECT session_id, user_id FROM `customer_sessions` WHERE tenant_id = ?";
  const params = [tenant_id];

  if (originator)            { sql += " AND originator = ?";        params.push(originator); }
  if (date_from)             { sql += " AND started_at >= ?";       params.push(date_from); }
  if (date_to)               { sql += " AND started_at <= ?";       params.push(date_to); }
  if (Array.isArray(session_ids) && session_ids.length) {
    sql += ` AND session_id IN (${session_ids.map(() => "?").join(",")})`;
    params.push(...session_ids);
  }

  sql += " ORDER BY started_at DESC LIMIT ?";
  params.push(Number(limit));

  const [rows] = await pool.query(sql, params);

  const results = [];
  let exported = 0;
  let failed = 0;

  for (const { session_id } of rows) {
    try {
      const result = await exportSessionToDrive(session_id, user_email_override);
      results.push({ ok: true, ...result });
      exported++;
    } catch (err) {
      results.push({ ok: false, session_id, error: err.message });
      failed++;
    }
  }

  return { exported, failed, results };
}
