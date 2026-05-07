import { randomUUID } from "crypto";
import { getPool } from "./db.js";
import { splitSchema } from "./schemaSplitter.js";

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function fetchRaw(repoUrl, pathInRepo, ref) {
  const filePath = pathInRepo || "openapi.yaml";
  const branch = ref || "main";
  let rawUrl = repoUrl;

  const ghMatch = repoUrl.match(/^https?:\/\/github\.com\/([^/?#]+\/[^/?#]+)/);
  if (ghMatch) {
    rawUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${branch}/${filePath}`;
  } else {
    const glMatch = repoUrl.match(/^https?:\/\/gitlab\.com\/([^/?#]+\/[^/?#]+)/);
    if (glMatch) {
      rawUrl = `https://gitlab.com/${glMatch[1]}/-/raw/${branch}/${filePath}`;
    }
    // Otherwise treat repoUrl as a direct raw URL
  }

  const res = await fetch(rawUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText} — ${rawUrl}`);
  }
  return { raw: await res.text(), source_url: rawUrl };
}

async function upsertEndpoints(pool, actionKey, operations, jobId) {
  let upserted = 0;
  let deprecated = 0;
  const activeIds = new Set(operations.map(op => op.operationId));

  // Deprecate import-managed endpoints no longer present in the new schema
  const [managed] = await pool.query(
    "SELECT endpoint_key FROM `endpoints` WHERE parent_action_key = ? AND import_job_id IS NOT NULL",
    [actionKey]
  );

  for (const { endpoint_key } of managed) {
    if (!activeIds.has(endpoint_key)) {
      await pool.query(
        "UPDATE `endpoints` SET status = 'deprecated', import_job_id = ?, schema_imported_at = NOW() WHERE endpoint_key = ? AND parent_action_key = ?",
        [jobId, endpoint_key, actionKey]
      );
      deprecated++;
    }
  }

  for (const op of operations) {
    await pool.query(
      `INSERT INTO \`endpoints\`
         (endpoint_key, parent_action_key, method, endpoint_path_or_function, schema_json, import_job_id, schema_imported_at, status)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), 'active')
       ON DUPLICATE KEY UPDATE
         method                   = VALUES(method),
         endpoint_path_or_function = VALUES(endpoint_path_or_function),
         schema_json              = VALUES(schema_json),
         import_job_id            = VALUES(import_job_id),
         schema_imported_at       = VALUES(schema_imported_at),
         status                   = 'active'`,
      [op.operationId, actionKey, op.method, op.path, op.schema_json, jobId]
    );
    upserted++;
  }

  return { upserted, deprecated };
}

export async function runImport({
  raw,
  sourceType,
  sourceUrl = null,
  sourceRef = null,
  sourceFilename = null,
  actionKeyOverride = null,
  importedBy = null,
}) {
  const pool = getPool();
  const jobId = randomUUID();

  await pool.query(
    `INSERT INTO \`schema_import_jobs\`
       (job_id, action_key, source_type, source_url, source_ref, source_filename, raw_schema, status, imported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [jobId, actionKeyOverride || "pending", sourceType, sourceUrl, sourceRef, sourceFilename, raw, importedBy]
  );

  try {
    const { actionMeta, operations, warnings } = splitSchema(raw);
    const actionKey = actionKeyOverride || slugify(actionMeta.title) || "imported_action";
    const endpointSnapshots = operations.map(({ path, method, operationId, schema_json }) => ({
      path, method, operationId, schema_json,
    }));

    // Upsert the parent action row with action-level meta
    await pool.query(
      `INSERT INTO \`actions\`
         (action_key, action_title, schema_json, import_job_id, schema_imported_at, status)
       VALUES (?, ?, ?, ?, NOW(), 'active')
       ON DUPLICATE KEY UPDATE
         action_title       = VALUES(action_title),
         schema_json        = VALUES(schema_json),
         import_job_id      = VALUES(import_job_id),
         schema_imported_at = VALUES(schema_imported_at)`,
      [actionKey, actionMeta.title || actionKey, JSON.stringify(actionMeta), jobId]
    );

    const { upserted, deprecated } = await upsertEndpoints(pool, actionKey, operations, jobId);

    await pool.query(
      `UPDATE \`schema_import_jobs\`
       SET action_key = ?, endpoint_snapshots = ?, endpoints_upserted = ?,
           endpoints_deprecated = ?, warnings = ?, status = 'completed'
       WHERE job_id = ?`,
      [actionKey, JSON.stringify(endpointSnapshots), upserted, deprecated, JSON.stringify(warnings), jobId]
    );

    return { ok: true, job_id: jobId, action_key: actionKey, endpoints_upserted: upserted, endpoints_deprecated: deprecated, warnings };
  } catch (err) {
    await pool.query(
      "UPDATE `schema_import_jobs` SET status = 'failed', error_message = ? WHERE job_id = ?",
      [err.message, jobId]
    );
    throw err;
  }
}

export async function runRepoImport({ repoUrl, pathInRepo, ref, actionKeyOverride, importedBy }) {
  const { raw, source_url } = await fetchRaw(repoUrl, pathInRepo, ref);
  return runImport({
    raw,
    sourceType: "repo_link",
    sourceUrl: source_url,
    sourceRef: ref || null,
    actionKeyOverride: actionKeyOverride || null,
    importedBy: importedBy || null,
  });
}

export async function runRollback({ actionKey, jobId, requestedBy = null }) {
  const pool = getPool();

  const [rows] = await pool.query(
    "SELECT endpoint_snapshots FROM `schema_import_jobs` WHERE job_id = ? AND action_key = ? AND status = 'completed' LIMIT 1",
    [jobId, actionKey]
  );
  if (!rows[0]) {
    throw new Error(`Job ${jobId} not found for action_key "${actionKey}" or is not in completed state`);
  }

  const snapshots = rows[0].endpoint_snapshots || [];
  const rollbackJobId = randomUUID();
  const activeIds = new Set(snapshots.map(s => s.operationId));

  await pool.query(
    `INSERT INTO \`schema_import_jobs\`
       (job_id, action_key, source_type, source_url, status, imported_by)
     VALUES (?, ?, 'rollback', ?, 'pending', ?)`,
    [rollbackJobId, actionKey, `rollback:${jobId}`, requestedBy]
  );

  try {
    // Deprecate import-managed endpoints not in the target snapshot
    if (activeIds.size > 0) {
      await pool.query(
        `UPDATE \`endpoints\`
         SET status = 'deprecated', import_job_id = ?, schema_imported_at = NOW()
         WHERE parent_action_key = ? AND import_job_id IS NOT NULL AND endpoint_key NOT IN (?)`,
        [rollbackJobId, actionKey, [...activeIds]]
      );
    } else {
      await pool.query(
        `UPDATE \`endpoints\`
         SET status = 'deprecated', import_job_id = ?, schema_imported_at = NOW()
         WHERE parent_action_key = ? AND import_job_id IS NOT NULL`,
        [rollbackJobId, actionKey]
      );
    }

    let restored = 0;
    for (const snap of snapshots) {
      await pool.query(
        `INSERT INTO \`endpoints\`
           (endpoint_key, parent_action_key, method, endpoint_path_or_function, schema_json, import_job_id, schema_imported_at, status)
         VALUES (?, ?, ?, ?, ?, ?, NOW(), 'active')
         ON DUPLICATE KEY UPDATE
           schema_json        = VALUES(schema_json),
           import_job_id      = VALUES(import_job_id),
           schema_imported_at = VALUES(schema_imported_at),
           status             = 'active'`,
        [snap.operationId, actionKey, snap.method, snap.path, snap.schema_json, rollbackJobId]
      );
      restored++;
    }

    await pool.query(
      `UPDATE \`schema_import_jobs\`
       SET endpoints_upserted = ?, endpoint_snapshots = ?, status = 'completed'
       WHERE job_id = ?`,
      [restored, JSON.stringify(snapshots), rollbackJobId]
    );

    return { ok: true, job_id: rollbackJobId, action_key: actionKey, endpoints_restored: restored, rolled_back_to_job: jobId };
  } catch (err) {
    await pool.query(
      "UPDATE `schema_import_jobs` SET status = 'failed', error_message = ? WHERE job_id = ?",
      [err.message, rollbackJobId]
    );
    throw err;
  }
}
