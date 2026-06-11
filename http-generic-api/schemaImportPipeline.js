import { randomUUID, createHash } from "crypto";
import { getPool } from "./db.js";
import { splitSchema } from "./schemaSplitter.js";

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function byteLength(value = "") {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function asBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
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

function operationSchemaHash(schemaJson = "") {
  return sha256(schemaJson || "{}");
}

async function upsertEndpoints(pool, actionKey, operations, jobId, sourceMeta = {}) {
  let upserted = 0;
  let deprecated = 0;
  const activeIds = new Set(operations.map(op => op.operationId));
  const parentSchemaRef = sourceMeta.parentSchemaRef || sourceMeta.sourceRef || sourceMeta.sourceUrl || sourceMeta.sourceFilename || "";
  const overlayNotes = JSON.stringify({
    import_job_id: jobId,
    parent_schema_ref: parentSchemaRef,
    source_sha256: sourceMeta.sourceSha256 || "",
    preserve_parent_schema_reference: Boolean(sourceMeta.preserveParentSchemaReference),
    splitter_version: "schema_split_importer_v2",
    secrets_included: false,
  });

  // Deprecate import-managed endpoints no longer present in the new schema.
  const [managed] = await pool.query(
    "SELECT endpoint_key FROM `endpoints` WHERE parent_action_key = ? AND import_job_id IS NOT NULL",
    [actionKey]
  );

  for (const { endpoint_key } of managed) {
    if (!activeIds.has(endpoint_key)) {
      await pool.query(
        `UPDATE \`endpoints\`
            SET status = 'deprecated',
                import_job_id = ?,
                schema_imported_at = NOW(),
                schema_overlay_parent_action_key = ?,
                schema_overlay_status = 'deprecated_missing_from_parent_schema',
                schema_overlay_notes = ?,
                inventory_source = ?
          WHERE endpoint_key = ? AND parent_action_key = ?`,
        [jobId, actionKey, overlayNotes, `schema_import_job:${jobId}`, endpoint_key, actionKey]
      );
      deprecated++;
    }
  }

  for (const op of operations) {
    await pool.query(
      `INSERT INTO \`endpoints\`
         (endpoint_key, endpoint_operation, parent_action_key, method, endpoint_path_or_function,
          schema_json, import_job_id, schema_imported_at, child_openai_schema_file_id,
          schema_overlay_parent_action_key, schema_overlay_status, schema_overlay_notes,
          inventory_source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 'validated', ?, ?, 'active')
       ON DUPLICATE KEY UPDATE
         endpoint_operation       = VALUES(endpoint_operation),
         method                   = VALUES(method),
         endpoint_path_or_function = VALUES(endpoint_path_or_function),
         schema_json              = VALUES(schema_json),
         import_job_id            = VALUES(import_job_id),
         schema_imported_at       = VALUES(schema_imported_at),
         child_openai_schema_file_id = VALUES(child_openai_schema_file_id),
         schema_overlay_parent_action_key = VALUES(schema_overlay_parent_action_key),
         schema_overlay_status    = VALUES(schema_overlay_status),
         schema_overlay_notes     = VALUES(schema_overlay_notes),
         inventory_source         = VALUES(inventory_source),
         status                   = 'active'`,
      [
        op.operationId,
        op.operationId,
        actionKey,
        op.method,
        op.path,
        op.schema_json,
        jobId,
        parentSchemaRef,
        actionKey,
        overlayNotes,
        `schema_import_job:${jobId}`,
      ]
    );
    upserted++;
  }

  return { upserted, deprecated };
}

async function insertPendingJob(pool, {
  jobId,
  actionKey,
  sourceType,
  sourceUrl,
  sourceRef,
  sourceFilename,
  raw,
  importedBy,
  parentSchemaRef,
  preserveParentSchemaReference,
  metadata,
}) {
  const preserve = Boolean(preserveParentSchemaReference);
  await pool.query(
    `INSERT INTO \`schema_import_jobs\`
       (job_id, action_key, source_type, source_url, source_ref, source_filename,
        source_sha256, source_bytes, parent_schema_ref, preserve_parent_schema_reference,
        raw_schema, metadata_json, status, imported_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      jobId,
      actionKey || "pending",
      sourceType,
      sourceUrl,
      sourceRef,
      sourceFilename,
      sha256(raw),
      byteLength(raw),
      parentSchemaRef || sourceRef || sourceUrl || sourceFilename || null,
      preserve ? 1 : 0,
      preserve ? null : raw,
      JSON.stringify({ ...(metadata || {}), secrets_included: false }),
      importedBy,
    ]
  );
}

export async function runImport({
  raw,
  sourceType,
  sourceUrl = null,
  sourceRef = null,
  sourceFilename = null,
  actionKeyOverride = null,
  importedBy = null,
  preserveParentSchemaReference = false,
  parentSchemaRef = null,
  metadata = {},
}) {
  const pool = getPool();
  const jobId = randomUUID();
  const sourceSha256 = sha256(raw);
  const preserve = asBool(preserveParentSchemaReference, false);
  const effectiveParentSchemaRef = parentSchemaRef || sourceRef || sourceUrl || sourceFilename || `upload:${sourceSha256}`;

  await insertPendingJob(pool, {
    jobId,
    actionKey: actionKeyOverride || "pending",
    sourceType,
    sourceUrl,
    sourceRef,
    sourceFilename,
    raw,
    importedBy,
    parentSchemaRef: effectiveParentSchemaRef,
    preserveParentSchemaReference: preserve,
    metadata,
  });

  try {
    const { actionMeta, operations, warnings } = splitSchema(raw);
    const actionKey = actionKeyOverride || slugify(actionMeta.title) || "imported_action";
    const endpointSnapshots = operations.map(({ path, method, operationId, schema_json }) => ({
      path,
      method,
      operationId,
      schema_sha256: operationSchemaHash(schema_json),
      schema_json,
    }));

    const actionSchemaJson = preserve ? null : JSON.stringify(actionMeta);
    const actionSchemaFileId = preserve ? `action_schema:${actionKey}` : null;
    const actionSchemaStorageSurface = preserve ? "sql_runtime_registry" : null;

    // Upsert the parent action row with reference-preserving action-level meta.
    await pool.query(
      `INSERT INTO \`actions\`
         (action_key, action_title, schema_json, openai_schema_file_id, openai_schema_ref,
          openai_schema_file_name, openai_schema_storage_surface, import_job_id,
          schema_imported_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'active')
       ON DUPLICATE KEY UPDATE
         action_title       = VALUES(action_title),
         schema_json        = VALUES(schema_json),
         openai_schema_file_id = COALESCE(VALUES(openai_schema_file_id), openai_schema_file_id),
         openai_schema_ref  = COALESCE(VALUES(openai_schema_ref), openai_schema_ref),
         openai_schema_file_name = COALESCE(VALUES(openai_schema_file_name), openai_schema_file_name),
         openai_schema_storage_surface = COALESCE(VALUES(openai_schema_storage_surface), openai_schema_storage_surface),
         import_job_id      = VALUES(import_job_id),
         schema_imported_at = VALUES(schema_imported_at),
         status             = 'active'`,
      [
        actionKey,
        actionMeta.title || actionKey,
        actionSchemaJson,
        actionSchemaFileId,
        effectiveParentSchemaRef,
        sourceFilename,
        actionSchemaStorageSurface,
        jobId,
      ]
    );

    const { upserted, deprecated } = await upsertEndpoints(pool, actionKey, operations, jobId, {
      parentSchemaRef: effectiveParentSchemaRef,
      sourceRef,
      sourceUrl,
      sourceFilename,
      sourceSha256,
      preserveParentSchemaReference: preserve,
    });

    await pool.query(
      `UPDATE \`schema_import_jobs\`
       SET action_key = ?, endpoint_snapshots = ?, endpoints_upserted = ?,
           endpoints_deprecated = ?, warnings = ?, status = 'completed'
       WHERE job_id = ?`,
      [actionKey, JSON.stringify(endpointSnapshots), upserted, deprecated, JSON.stringify(warnings), jobId]
    );

    return {
      ok: true,
      job_id: jobId,
      action_key: actionKey,
      source_sha256: sourceSha256,
      source_bytes: byteLength(raw),
      parent_schema_ref: effectiveParentSchemaRef,
      preserve_parent_schema_reference: preserve,
      endpoints_upserted: upserted,
      endpoints_deprecated: deprecated,
      warnings,
      secrets_included: false,
    };
  } catch (err) {
    await pool.query(
      "UPDATE `schema_import_jobs` SET status = 'failed', error_message = ? WHERE job_id = ?",
      [err.message, jobId]
    );
    throw err;
  }
}

export async function runRepoImport({ repoUrl, pathInRepo, ref, actionKeyOverride, importedBy, preserveParentSchemaReference = true }) {
  const { raw, source_url } = await fetchRaw(repoUrl, pathInRepo, ref);
  return runImport({
    raw,
    sourceType: "repo_link",
    sourceUrl: source_url,
    sourceRef: ref || null,
    sourceFilename: pathInRepo || "openapi.yaml",
    actionKeyOverride: actionKeyOverride || null,
    importedBy: importedBy || null,
    preserveParentSchemaReference,
    parentSchemaRef: source_url,
    metadata: { path_in_repo: pathInRepo || "openapi.yaml" },
  });
}

async function loadJsonAssetSchema(pool, ref) {
  const assetKey = String(ref || "").replace(/^ref:schema:/, "").trim();
  if (!assetKey) return null;
  const [rows] = await pool.query(
    `SELECT asset_key, json_payload, google_drive_link, source_asset_ref, storage_format, validation_status
       FROM \`json_assets\`
      WHERE asset_key = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [assetKey]
  );
  const asset = rows?.[0] || null;
  if (!asset?.json_payload) return null;
  return {
    raw: String(asset.json_payload),
    parentSchemaRef: `ref:schema:${asset.asset_key}`,
    sourceUrl: asset.google_drive_link || null,
    sourceFilename: asset.source_asset_ref || asset.asset_key,
    metadata: {
      json_asset_key: asset.asset_key,
      storage_format: asset.storage_format || "",
      validation_status: asset.validation_status || "",
    },
  };
}

function schemaAssetKeyForAction(action = {}) {
  const refAssetKey = String(action.openai_schema_ref || "").replace(/^ref:schema:/, "").trim();
  return refAssetKey || `${String(action.action_key || "action").trim()}_parent_schema_v1`;
}

function schemaStorageFormat(raw = "") {
  const trimmed = String(raw || "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? "openapi_json" : "openapi_yaml";
}

function resolveDriveFileIdForMirror(action = {}, overrideFileId = null) {
  const explicit = String(overrideFileId || "").trim();
  if (explicit) return explicit;

  const fileId = String(action.openai_schema_file_id || "").trim();
  if (fileId && !fileId.startsWith("action_schema:")) return fileId;

  const notes = String(action.notes || "");
  const match = notes.match(/\bDrive file\s+([A-Za-z0-9_-]{20,})\b/i);
  return match?.[1] || "";
}

export async function mirrorActionParentSchemaFromDrive({
  actionKey,
  driveFileId = null,
  fetchDriveContent,
  importedBy = null,
} = {}) {
  if (!actionKey) {
    const err = new Error("action_key is required");
    err.code = "missing_action_key";
    throw err;
  }
  if (typeof fetchDriveContent !== "function") {
    const err = new Error("fetchDriveContent function is required for Drive schema mirroring");
    err.code = "drive_fetcher_unavailable";
    throw err;
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT action_key, action_title, openai_schema_ref, openai_schema_file_id,
            openai_schema_file_name, notes
       FROM \`actions\`
      WHERE action_key = ?
      LIMIT 1`,
    [actionKey]
  );
  const action = rows?.[0] || null;
  if (!action) {
    const err = new Error(`Action not found: ${actionKey}`);
    err.code = "action_not_found";
    throw err;
  }

  const effectiveDriveFileId = resolveDriveFileIdForMirror(action, driveFileId);
  if (!effectiveDriveFileId) {
    const err = new Error(`No Drive file id available to mirror parent schema for action ${actionKey}.`);
    err.code = "drive_file_id_missing";
    err.details = {
      action_key: actionKey,
      openai_schema_ref: action.openai_schema_ref || "",
      openai_schema_file_id: action.openai_schema_file_id || "",
      secrets_included: false,
    };
    throw err;
  }

  const raw = await fetchDriveContent(effectiveDriveFileId);
  splitSchema(raw);

  const assetKey = schemaAssetKeyForAction(action);
  const assetId = `schema:${assetKey}`.slice(0, 255);
  const sourceFilename = action.openai_schema_file_name || `${assetKey}.yaml`;
  const driveLink = `https://drive.google.com/file/d/${effectiveDriveFileId}/view`;
  const notes = JSON.stringify({
    source: "schema_import_action_ref_drive_mirror",
    action_key: actionKey,
    source_drive_file_id: effectiveDriveFileId,
    source_sha256: sha256(raw),
    source_bytes: byteLength(raw),
    imported_by: importedBy || null,
    secrets_included: false,
  });

  const [existing] = await pool.query(
    "SELECT id FROM `json_assets` WHERE asset_key = ? ORDER BY updated_at DESC LIMIT 1",
    [assetKey]
  );
  const existingId = existing?.[0]?.id || null;
  if (existingId) {
    await pool.query(
      `UPDATE \`json_assets\`
          SET asset_id = COALESCE(asset_id, ?),
              asset_type = 'openapi_schema',
              mapping_status = 'mapped',
              storage_format = ?,
              google_drive_link = ?,
              source_mode = 'drive_mirror',
              source_asset_ref = ?,
              json_payload = ?,
              transport_status = 'mirrored',
              validation_status = 'validated',
              last_validated_at = ?,
              notes = ?,
              active_status = 'active',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [assetId, schemaStorageFormat(raw), driveLink, sourceFilename, raw, new Date().toISOString(), notes, existingId]
    );
  } else {
    await pool.query(
      `INSERT INTO \`json_assets\`
         (asset_id, asset_key, asset_type, mapping_status, storage_format,
          google_drive_link, source_mode, source_asset_ref, json_payload,
          transport_status, validation_status, last_validated_at, notes, active_status)
       VALUES (?, ?, 'openapi_schema', 'mapped', ?, ?, 'drive_mirror', ?, ?,
               'mirrored', 'validated', ?, ?, 'active')`,
      [assetId, assetKey, schemaStorageFormat(raw), driveLink, sourceFilename, raw, new Date().toISOString(), notes]
    );
  }

  return {
    ok: true,
    action_key: actionKey,
    asset_key: assetKey,
    parent_schema_ref: `ref:schema:${assetKey}`,
    source_drive_file_id: effectiveDriveFileId,
    source_sha256: sha256(raw),
    source_bytes: byteLength(raw),
    storage_format: schemaStorageFormat(raw),
    secrets_included: false,
  };
}

export async function resolveActionParentSchema(actionKey) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT action_key, action_title, schema_json, openai_schema_file_id, openai_schema_ref,
            openai_schema_file_name, openai_schema_storage_surface
       FROM \`actions\`
      WHERE action_key = ?
      LIMIT 1`,
    [actionKey]
  );
  const action = rows?.[0] || null;
  if (!action) {
    const err = new Error(`Action not found: ${actionKey}`);
    err.code = "action_not_found";
    throw err;
  }

  const ref = String(action.openai_schema_ref || "").trim();
  if (ref.startsWith("ref:schema:")) {
    const resolved = await loadJsonAssetSchema(pool, ref);
    if (resolved) return { action, ...resolved };
  }

  const inline = String(action.schema_json || "").trim();
  if (inline) {
    return {
      action,
      raw: inline,
      parentSchemaRef: ref || `actions.schema_json:${action.action_key}`,
      sourceUrl: null,
      sourceFilename: action.openai_schema_file_name || null,
      metadata: { source: "actions.schema_json" },
    };
  }

  const fileId = String(action.openai_schema_file_id || "").trim();
  const err = new Error(
    `No resolvable parent schema payload found for action ${actionKey}. ` +
    `Expected actions.schema_json or json_assets row for ${ref || "openai_schema_ref"}. ` +
    `Drive/file references should be imported through upload/repo or mirrored into json_assets first.`
  );
  err.code = "parent_schema_reference_unresolved";
  err.details = {
    action_key: actionKey,
    openai_schema_ref: ref,
    openai_schema_file_id: fileId,
    openai_schema_file_name: action.openai_schema_file_name || "",
    secrets_included: false,
  };
  throw err;
}

export async function runActionReferenceImport({ actionKey, importedBy = null, preserveParentSchemaReference = true } = {}) {
  if (!actionKey) {
    const err = new Error("action_key is required");
    err.code = "missing_action_key";
    throw err;
  }
  const resolved = await resolveActionParentSchema(actionKey);
  return runImport({
    raw: resolved.raw,
    // schema_import_jobs.source_type is a legacy enum. Keep the DB enum stable
    // and record the more specific action-ref provenance in parent_schema_ref
    // plus metadata_json.source_type_detail instead of widening the enum.
    sourceType: "upload",
    sourceUrl: resolved.sourceUrl || null,
    sourceRef: resolved.parentSchemaRef,
    sourceFilename: resolved.sourceFilename || resolved.action?.openai_schema_file_name || null,
    actionKeyOverride: actionKey,
    importedBy,
    preserveParentSchemaReference,
    parentSchemaRef: resolved.parentSchemaRef,
    metadata: { ...(resolved.metadata || {}), source_type_detail: "action_ref" },
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

  const snapshots = typeof rows[0].endpoint_snapshots === "string"
    ? JSON.parse(rows[0].endpoint_snapshots || "[]")
    : (rows[0].endpoint_snapshots || []);
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
    let deprecateResult;
    if (activeIds.size > 0) {
      [deprecateResult] = await pool.query(
        `UPDATE \`endpoints\`
         SET status = 'deprecated', import_job_id = ?, schema_imported_at = NOW()
         WHERE parent_action_key = ? AND import_job_id IS NOT NULL AND endpoint_key NOT IN (?)`,
        [rollbackJobId, actionKey, [...activeIds]]
      );
    } else {
      [deprecateResult] = await pool.query(
        `UPDATE \`endpoints\`
         SET status = 'deprecated', import_job_id = ?, schema_imported_at = NOW()
         WHERE parent_action_key = ? AND import_job_id IS NOT NULL`,
        [rollbackJobId, actionKey]
      );
    }
    const deprecated = deprecateResult?.affectedRows ?? 0;

    let restored = 0;
    for (const snap of snapshots) {
      await pool.query(
        `INSERT INTO \`endpoints\`
           (endpoint_key, endpoint_operation, parent_action_key, method, endpoint_path_or_function, schema_json, import_job_id, schema_imported_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 'active')
         ON DUPLICATE KEY UPDATE
           endpoint_operation = VALUES(endpoint_operation),
           schema_json        = VALUES(schema_json),
           import_job_id      = VALUES(import_job_id),
           schema_imported_at = VALUES(schema_imported_at),
           status             = 'active'`,
        [snap.operationId, snap.operationId, actionKey, snap.method, snap.path, snap.schema_json, rollbackJobId]
      );
      restored++;
    }

    await pool.query(
      `UPDATE \`schema_import_jobs\`
       SET endpoints_upserted = ?, endpoints_deprecated = ?, endpoint_snapshots = ?, status = 'completed'
       WHERE job_id = ?`,
      [restored, deprecated, JSON.stringify(snapshots), rollbackJobId]
    );

    return { ok: true, job_id: rollbackJobId, action_key: actionKey, endpoints_restored: restored, endpoints_deprecated: deprecated, rolled_back_to_job: jobId, secrets_included: false };
  } catch (err) {
    await pool.query(
      "UPDATE `schema_import_jobs` SET status = 'failed', error_message = ? WHERE job_id = ?",
      [err.message, rollbackJobId]
    );
    throw err;
  }
}
