import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  buildDynamicCapabilityGovernancePreview,
  stableCapabilityHash,
} from "./dynamicCapabilityGovernanceCompiler.js";

export const CAPABILITY_GOVERNANCE_PERSIST_CONFIRM = "PERSIST_CAPABILITY_GOVERNANCE_COMPILATION";
const LOCK_KEY = "platform_capability_governance_compilation";

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function fail(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  throw error;
}

function requiredString(value, field, { min = 1, max = 191 } = {}) {
  const normalized = String(value || "").trim();
  if (normalized.length < min || normalized.length > max) {
    fail("capability_governance_invalid_input", `${field} must contain ${min}-${max} characters.`, 400, { field });
  }
  return normalized;
}

function requireHash(value, field) {
  const normalized = requiredString(value, field, { min: 64, max: 64 }).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    fail("capability_governance_invalid_hash", `${field} must be a lowercase SHA-256 hash.`, 400, { field });
  }
  return normalized;
}

function requireConfirmation(value) {
  if (String(value || "").trim() !== CAPABILITY_GOVERNANCE_PERSIST_CONFIRM) {
    fail(
      "capability_governance_typed_confirmation_required",
      `Typed confirmation ${CAPABILITY_GOVERNANCE_PERSIST_CONFIRM} is required.`,
      400,
      { expected_confirmation: CAPABILITY_GOVERNANCE_PERSIST_CONFIRM }
    );
  }
}

async function loadExistingRun(pool, idempotencyKey) {
  const [rows] = await pool.query(
    `SELECT run_id,idempotency_key,compiler_version,status,source_revision_hash,input_hash,output_hash,
            source_count,compiled_manifest_count,persisted_manifest_count,reused_manifest_count,gap_count,
            blocked_manifest_count,shadow_ready_manifest_count,capability_envelope_id,secrets_included,
            started_at,completed_at
       FROM platform_capability_compilation_runs
      WHERE idempotency_key=?
      LIMIT 1`,
    [idempotencyKey]
  );
  return rows?.[0] || null;
}

async function readbackRun(connection, runId) {
  const [runRows] = await connection.query(
    `SELECT run_id,idempotency_key,compiler_version,status,source_revision_hash,input_hash,output_hash,
            source_count,compiled_manifest_count,persisted_manifest_count,reused_manifest_count,gap_count,
            blocked_manifest_count,shadow_ready_manifest_count,capability_envelope_id,secrets_included,
            started_at,completed_at
       FROM platform_capability_compilation_runs
      WHERE run_id=?
      LIMIT 1`,
    [runId]
  );
  const [manifestRows] = await connection.query(
    `SELECT COUNT(*) AS created_manifest_count,
            SUM(CASE WHEN is_current=1 THEN 1 ELSE 0 END) AS current_created_manifest_count
       FROM platform_capability_compiled_manifests
      WHERE run_id=?`,
    [runId]
  );
  const [gapRows] = await connection.query(
    `SELECT COUNT(*) AS persisted_gap_count,
            SUM(CASE WHEN blocks_dispatch=1 THEN 1 ELSE 0 END) AS blocking_gap_count
       FROM platform_capability_governance_gap_snapshots
      WHERE run_id=?`,
    [runId]
  );
  return {
    run: runRows?.[0] || null,
    manifests: manifestRows?.[0] || { created_manifest_count: 0, current_created_manifest_count: 0 },
    gaps: gapRows?.[0] || { persisted_gap_count: 0, blocking_gap_count: 0 },
  };
}

function persistenceInputHash(preview) {
  return stableCapabilityHash({
    compiler_version: preview.compiler_version,
    source_revision_hash: preview.source_revision_hash,
    filters: preview.filters,
    page: preview.page,
    manifest_hashes: preview.manifests.map((item) => item.manifest_hash),
  });
}

function gapFingerprint(gap) {
  return stableCapabilityHash({
    capability_key: gap.capability_key,
    gap_key: gap.gap_key,
    source_table: gap.source_table || null,
    source_key: gap.source_key || null,
    gap_severity: gap.gap_severity,
    blocks_dispatch: Boolean(gap.blocks_dispatch),
  });
}

export async function persistDynamicCapabilityGovernanceCompilation(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const idempotencyKey = requiredString(args.idempotency_key, "idempotency_key", { min: 8, max: 191 });
  const capabilityEnvelopeId = requiredString(args.capability_envelope_id, "capability_envelope_id", { min: 1, max: 64 });
  const expectedSourceRevisionHash = requireHash(args.expected_source_revision_hash, "expected_source_revision_hash");
  requireConfirmation(args.confirm);

  const existingRun = await loadExistingRun(pool, idempotencyKey);
  if (existingRun) {
    if (existingRun.status !== "complete") {
      fail("capability_governance_idempotency_in_progress", "The idempotency key belongs to a non-complete run.", 409, {
        run_id: existingRun.run_id,
        status: existingRun.status,
      });
    }
    if (
      existingRun.source_revision_hash !== expectedSourceRevisionHash
      || existingRun.capability_envelope_id !== capabilityEnvelopeId
    ) {
      fail("capability_governance_idempotency_conflict", "The idempotency key is already bound to a different source revision or capability envelope.", 409, {
        run_id: existingRun.run_id,
      });
    }
    return {
      ok: true,
      report_type: "dynamic_capability_governance_persist",
      replayed: true,
      run: existingRun,
      readback_complete: true,
      mutations_performed: false,
      provider_calls_performed: false,
      tenant_authority_changed: false,
      secrets_included: false,
    };
  }

  const preview = await (deps.previewBuilder || buildDynamicCapabilityGovernancePreview)(args, {
    pool,
    now: deps.now,
  });
  if (preview.source_revision_hash !== expectedSourceRevisionHash) {
    fail("capability_governance_source_revision_mismatch", "The live source revision changed after preview.", 409, {
      expected_source_revision_hash: expectedSourceRevisionHash,
      observed_source_revision_hash: preview.source_revision_hash,
    });
  }

  const runId = (deps.uuid || randomUUID)();
  const inputHash = persistenceInputHash(preview);
  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_KEY]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) {
      fail("capability_governance_compilation_locked", "Another capability governance compilation is active.", 409);
    }

    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO platform_capability_compilation_runs
        (run_id,idempotency_key,compiler_version,mode,status,source_revision_hash,input_hash,filters_json,
         source_count,compiled_manifest_count,gap_count,blocked_manifest_count,shadow_ready_manifest_count,
         requested_by,capability_envelope_id,secrets_included)
       VALUES (?,?,?,'shadow_persist','running',?,?,?, ?,?,?,?, ?,?,?,0)`,
      [
        runId,
        idempotencyKey,
        preview.compiler_version,
        preview.source_revision_hash,
        inputHash,
        JSON.stringify(preview.filters || {}),
        Number(preview.counts?.source_rows || 0),
        Number(preview.counts?.manifest_count || 0),
        Number(preview.counts?.gap_count || 0),
        Number(preview.counts?.blocked_manifest_count || 0),
        Number(preview.counts?.shadow_ready_manifest_count || 0),
        String(args.requested_by || "platform_admin").slice(0, 191),
        capabilityEnvelopeId,
      ]
    );

    const manifestIds = new Map();
    let persistedManifestCount = 0;
    let reusedManifestCount = 0;

    for (const manifest of preview.manifests) {
      const [existingRows] = await connection.query(
        `SELECT manifest_id,manifest_version,is_current
           FROM platform_capability_compiled_manifests
          WHERE capability_key=? AND source_revision_hash=? AND manifest_hash=?
          LIMIT 1
          FOR UPDATE`,
        [manifest.capability_key, preview.source_revision_hash, manifest.manifest_hash]
      );
      const existing = existingRows?.[0] || null;
      if (existing) {
        manifestIds.set(manifest.capability_key, existing.manifest_id);
        reusedManifestCount += 1;
        continue;
      }

      const [versionRows] = await connection.query(
        `SELECT manifest_version
           FROM platform_capability_compiled_manifests
          WHERE capability_key=?
          ORDER BY manifest_version DESC
          LIMIT 1
          FOR UPDATE`,
        [manifest.capability_key]
      );
      const nextVersion = Number(versionRows?.[0]?.manifest_version || 0) + 1;
      await connection.query(
        `UPDATE platform_capability_compiled_manifests
            SET is_current=0,status='superseded',superseded_at=COALESCE(superseded_at,CURRENT_TIMESTAMP)
          WHERE capability_key=? AND is_current=1`,
        [manifest.capability_key]
      );

      const manifestId = (deps.uuid || randomUUID)();
      await connection.query(
        `INSERT INTO platform_capability_compiled_manifests
          (manifest_id,run_id,capability_key,manifest_version,manifest_hash,source_revision_hash,compiler_version,
           effect_class,risk_class,authority_requirement_type,status,rollout_mode,manifest_json,is_current)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
        [
          manifestId,
          runId,
          manifest.capability_key,
          nextVersion,
          manifest.manifest_hash,
          preview.source_revision_hash,
          preview.compiler_version,
          manifest.effect_class,
          manifest.risk_class,
          manifest.authority_requirement_type || "none",
          manifest.status,
          manifest.rollout_mode,
          JSON.stringify(manifest),
        ]
      );
      manifestIds.set(manifest.capability_key, manifestId);
      persistedManifestCount += 1;

      const sourceTable = manifest.source?.table || null;
      const sourceKey = manifest.source?.key || null;
      if (sourceTable || sourceKey) {
        await connection.query(
          `INSERT INTO platform_capability_manifest_source_links
            (source_link_id,manifest_id,source_table,source_key,source_revision_hash,source_hash,source_metadata_json)
           VALUES (?,?,?,?,?,?,?)`,
          [
            (deps.uuid || randomUUID)(),
            manifestId,
            sourceTable,
            sourceKey,
            preview.source_revision_hash,
            stableCapabilityHash(manifest.source || {}),
            JSON.stringify({ compiler_version: preview.compiler_version, secrets_included: false }),
          ]
        );
      }
    }

    const gapFingerprints = [];
    for (const gap of preview.gaps) {
      const fingerprint = gapFingerprint(gap);
      gapFingerprints.push(fingerprint);
      await connection.query(
        `INSERT INTO platform_capability_governance_gap_snapshots
          (gap_snapshot_id,run_id,manifest_id,capability_key,gap_key,gap_severity,gap_description,
           blocks_dispatch,gap_fingerprint,source_table,source_key,snapshot_status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'observed')`,
        [
          (deps.uuid || randomUUID)(),
          runId,
          manifestIds.get(gap.capability_key) || null,
          gap.capability_key,
          gap.gap_key,
          gap.gap_severity,
          String(gap.gap_description || "").slice(0, 1000),
          gap.blocks_dispatch ? 1 : 0,
          fingerprint,
          gap.source_table || null,
          gap.source_key || null,
        ]
      );
    }

    const outputHash = stableCapabilityHash({
      manifest_hashes: preview.manifests.map((item) => item.manifest_hash),
      gap_fingerprints: gapFingerprints,
      source_revision_hash: preview.source_revision_hash,
    });
    await connection.query(
      `UPDATE platform_capability_compilation_runs
          SET status='complete',output_hash=?,persisted_manifest_count=?,reused_manifest_count=?,completed_at=CURRENT_TIMESTAMP
        WHERE run_id=?`,
      [outputHash, persistedManifestCount, reusedManifestCount, runId]
    );
    await connection.commit();

    const readback = await readbackRun(connection, runId);
    const readbackComplete = Boolean(
      readback.run
      && readback.run.status === "complete"
      && Number(readback.gaps?.persisted_gap_count || 0) === Number(preview.counts?.gap_count || 0)
      && Number(readback.run?.persisted_manifest_count || 0) === persistedManifestCount
      && Number(readback.run?.reused_manifest_count || 0) === reusedManifestCount
    );
    if (!readbackComplete) {
      fail("capability_governance_persistence_readback_incomplete", "Persistence completed but same-cycle readback did not match expected counts.", 500, {
        run_id: runId,
      });
    }

    return {
      ok: true,
      report_type: "dynamic_capability_governance_persist",
      replayed: false,
      run_id: runId,
      source_revision_hash: preview.source_revision_hash,
      input_hash: inputHash,
      output_hash: outputHash,
      counts: {
        compiled_manifest_count: Number(preview.counts?.manifest_count || 0),
        persisted_manifest_count: persistedManifestCount,
        reused_manifest_count: reusedManifestCount,
        persisted_gap_count: Number(preview.counts?.gap_count || 0),
      },
      page: preview.page,
      readback,
      readback_complete: true,
      mutations_performed: true,
      provider_calls_performed: false,
      tenant_authority_changed: false,
      callable_exports_created: false,
      secrets_included: false,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
    }
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_KEY]);
      } catch {
      }
    }
    connection.release();
  }
}
