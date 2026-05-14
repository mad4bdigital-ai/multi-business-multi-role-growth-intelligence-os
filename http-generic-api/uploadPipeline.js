import { randomBytes } from "crypto";
import { Readable } from "stream";
import { google } from "googleapis";
import { getPool } from "./db.js";
import { runImport, runRepoImport } from "./schemaImportPipeline.js";

// ---------------------------------------------------------------------------
// Drive client (lazy, uses ADC / GOOGLE_APPLICATION_CREDENTIALS)
// ---------------------------------------------------------------------------

let _drive = null;
function getDrive() {
  if (_drive) return _drive;
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  _drive = google.drive({ version: "v3", auth });
  return _drive;
}

// ---------------------------------------------------------------------------
// ID + metadata helpers
// ---------------------------------------------------------------------------

export function generateUploadId() {
  return "upl_" + randomBytes(5).toString("hex");
}

export function buildMetadata({ goal = {}, platform = {}, helpers = {}, source = {} } = {}) {
  return {
    goal: {
      intent: null,
      expected_outcome: null,
      priority: null,
      notes: null,
      ...goal,
    },
    platform: {
      tenant_id: null,
      brand_key: null,
      action_key: null,
      agent_id: null,
      logic_pack_key: null,
      scope: null,
      ...platform,
    },
    helpers: {
      auto_process: false,
      validation_mode: "strict",
      language: "en",
      tags: [],
      notify_on_complete: false,
      ...helpers,
    },
    source: {
      mode: "direct",
      instruction_set_id: null,
      connector_session_id: null,
      origin_url: null,
      fetched_at: null,
      ...source,
    },
  };
}

export function buildInstructions(uploadId, uploadType, baseUrl) {
  const base = String(baseUrl || "https://api.mad4b.com").replace(/\/$/, "");
  return [
    `Upload ID: ${uploadId} — save this to reference your upload in chat`,
    `Send your ${uploadType} file content to complete this upload:`,
    `  POST ${base}/uploads/${uploadId}/content`,
    `  Authorization: Bearer <BACKEND_API_KEY>`,
    `  Content-Type: application/json`,
    `  Body: { "content": "<file content as string>", "filename": "yourfile.yaml" }`,
    `Once uploaded, tell the GPT: "I've uploaded it, the ID is ${uploadId}"`,
    `The GPT will call GET /uploads/${uploadId} to validate, then POST /uploads/${uploadId}/process to run the pipeline.`,
  ];
}

// ---------------------------------------------------------------------------
// Drive folder helper — find or create a named subfolder under parentId
// ---------------------------------------------------------------------------

export async function getOrCreateDriveFolder(name, parentId) {
  const drive = getDrive();
  const safeName = String(name).replace(/'/g, "\\'");
  const list = await drive.files.list({
    q: `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: "files(id)",
    pageSize: 1,
  });
  if (list.data.files.length > 0) return list.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    supportsAllDrives: true,
    fields: "id",
  });
  return created.data.id;
}

// ---------------------------------------------------------------------------
// Drive upload
// ---------------------------------------------------------------------------

export async function uploadContentToDrive(content, filename, mimeType, userEmail = null, folderIdOverride = null) {
  const folderId = folderIdOverride || process.env.UPLOADS_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("UPLOADS_DRIVE_FOLDER_ID is not configured");

  const drive = getDrive();
  const safeFilename = String(filename || "upload.txt").replace(/[^\w.\-]/g, "_");

  const response = await drive.files.create({
    requestBody: {
      name: safeFilename,
      parents: [folderId],
      mimeType: mimeType || "text/plain",
    },
    media: {
      mimeType: mimeType || "text/plain",
      body: Readable.from([content]),
    },
    supportsAllDrives: true,
    fields: "id,webViewLink,name,mimeType,size",
  });

  const fileId = response.data.id;

  // Share with user email so they can open and edit the file directly in Drive
  if (userEmail && typeof userEmail === "string" && userEmail.includes("@")) {
    try {
      await drive.permissions.create({
        fileId,
        supportsAllDrives: true,
        sendNotificationEmail: false,
        requestBody: {
          role: "writer",
          type: "user",
          emailAddress: userEmail,
        },
      });
    } catch (permErr) {
      // Non-fatal — file is uploaded, sharing failed (e.g. external domain restriction)
      console.warn(`[uploads] Drive permission share failed for ${fileId} → ${userEmail}:`, permErr.message);
    }
  }

  return {
    drive_file_id: fileId,
    drive_folder_id: folderId,
    drive_web_url: response.data.webViewLink || null,
    size_bytes: response.data.size ? Number(response.data.size) : null,
  };
}

export async function fetchDriveContent(driveFileId) {
  const drive = getDrive();
  const meta = await drive.files.get({
    fileId: driveFileId,
    supportsAllDrives: true,
    fields: "id,name,mimeType",
  });
  const { mimeType = "text/plain" } = meta.data;

  let raw;
  if (mimeType.startsWith("application/vnd.google-apps")) {
    const exported = await drive.files.export(
      { fileId: driveFileId, supportsAllDrives: true, mimeType: "text/plain" },
      { responseType: "text" }
    );
    raw = String(exported.data || "");
  } else {
    const content = await drive.files.get(
      { fileId: driveFileId, supportsAllDrives: true, alt: "media" },
      { responseType: "text" }
    );
    raw = String(content.data || "");
  }

  return raw;
}

export async function deleteDriveFile(driveFileId) {
  const drive = getDrive();
  try {
    await drive.files.delete({ fileId: driveFileId, supportsAllDrives: true });
  } catch {
    // non-fatal — file may already be gone
  }
}

// ---------------------------------------------------------------------------
// Processing pipeline router
// ---------------------------------------------------------------------------

export async function processUpload(uploadRecord) {
  const pool = getPool();
  const { upload_id, upload_type, drive_file_id, metadata } = uploadRecord;
  const meta = metadata || {};
  const platform = meta.platform || {};

  await pool.query(
    "UPDATE `uploads` SET status = 'processing', updated_at = NOW() WHERE upload_id = ?",
    [upload_id]
  );

  try {
    let processedRef = null;

    if (upload_type === "schema") {
      const raw = await fetchDriveContent(drive_file_id);
      const result = await runImport({
        raw,
        sourceType: "upload",
        sourceFilename: uploadRecord.filename || null,
        actionKeyOverride: platform.action_key || null,
        importedBy: uploadRecord.uploaded_by || null,
      });
      processedRef = result.job_id;

    } else if (upload_type === "repo_link") {
      const sourceSegment = meta.source || {};
      const repoUrl = sourceSegment.origin_url || uploadRecord.filename;
      if (!repoUrl) throw new Error("repo_link upload has no origin_url in source metadata");
      const result = await runRepoImport({
        repoUrl,
        pathInRepo: platform.path_in_repo || null,
        ref: platform.ref || null,
        actionKeyOverride: platform.action_key || null,
        importedBy: uploadRecord.uploaded_by || null,
      });
      processedRef = result.job_id;

    } else if (upload_type === "skill") {
      // Skill registration pipeline — parse JSON/YAML from Drive and upsert into agent_skills
      const raw = await fetchDriveContent(drive_file_id);
      let skillDef;
      try { skillDef = JSON.parse(raw); } catch { skillDef = (await import("yaml")).parse(raw); }
      const skillId = skillDef.skill_id || `skill_${upload_id}`;
      await pool.query(
        `INSERT INTO \`agent_skills\` (skill_id, skill_key, display_name, description, capability_json, status)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE
           display_name = VALUES(display_name),
           description = VALUES(description),
           capability_json = VALUES(capability_json),
           status = 'active'`,
        [
          skillId,
          skillDef.skill_key || skillId,
          skillDef.display_name || skillId,
          skillDef.description || null,
          skillDef.parameters_schema ? JSON.stringify(skillDef.parameters_schema) : null,
        ]
      );
      processedRef = skillId;

    } else if (upload_type === "knowledge") {
      // Knowledge is stored in Drive — mark processed, indexing handled separately
      processedRef = drive_file_id;

    } else {
      // asset — just mark processed
      processedRef = drive_file_id;
    }

    await pool.query(
      "UPDATE `uploads` SET status = 'processed', processed_ref = ?, processed_at = NOW(), updated_at = NOW() WHERE upload_id = ?",
      [processedRef, upload_id]
    );

    return { ok: true, upload_id, processed_ref: processedRef };
  } catch (err) {
    await pool.query(
      "UPDATE `uploads` SET status = 'failed', error_message = ?, updated_at = NOW() WHERE upload_id = ?",
      [err.message, upload_id]
    );
    throw err;
  }
}
