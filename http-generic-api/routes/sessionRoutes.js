import { Router }     from "express";
import { randomUUID, createHash } from "node:crypto";
import { getPool }    from "../db.js";
import { dispatchPlan } from "../connectorExecutor.js";

// ── JSONL ingest helpers ──────────────────────────────────────────────────────

function parseJsonl(text) {
  return text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function sha256(text) {
  return createHash("sha256").update(text || "").digest("hex");
}

function toDatetime(val) {
  if (!val) return null;
  // Codex CLI emits started_at as Unix epoch seconds (e.g. 1778001172), not milliseconds.
  // Detect by magnitude: anything < 1e10 is almost certainly seconds.
  const n = Number(val);
  const d = (!isNaN(n) && n < 1e10) ? new Date(n * 1000) : new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
}

// Normalise a raw record to a canonical shape regardless of whether the
// originator used { data: ... }, { payload: ... }, or flat fields.
function unwrap(rec) {
  return rec?.payload ?? rec?.data ?? rec ?? {};
}

// Extract base_instructions text from either a plain string or { text: "..." } object.
function extractInstructions(val) {
  if (!val) return null;
  if (typeof val === "string") return val;
  if (typeof val === "object" && typeof val.text === "string") return val.text;
  return JSON.stringify(val);
}

// ── Ingest a single parsed session record array into DB ───────────────────────

async function ingestParsedRecords(records, { tenant_id, user_id, brand_key, workspace_key }) {
  const pool = getPool();

  // --- 1. Locate session_meta ---
  const meta = records.find(r => r.type === "session_meta" || r.record_type === "session_meta");

  // Codex CLI: { type, timestamp, payload: { id, cwd, git, base_instructions: { text } } }
  // Platform format: { type, data: { session_id, cwd, git_context, base_instructions: string } }
  const sessionData = unwrap(meta);

  // session_id: Codex uses payload.id, platform format uses session_id or data.session_id
  const session_id = sessionData.id || sessionData.session_id || randomUUID();

  // git context: Codex uses .git, platform format uses .git_context
  const gitCtx = sessionData.git || sessionData.git_context || {};

  // base_instructions: Codex uses { text: "..." }, platform uses plain string
  const instrText = extractInstructions(sessionData.base_instructions);

  // brand_key: explicit arg wins, then session_meta payload, then null
  const resolvedBrandKey     = brand_key     || sessionData.brand_key     || null;
  const resolvedWorkspaceKey = workspace_key || sessionData.workspace_key || null;

  // Resolve brand properties for enrichment (non-blocking if brand not found)
  let brandRow = null;
  if (resolvedBrandKey) {
    const [bRows] = await pool.query(
      `SELECT brand_name, brand_domain, hosting_provider, server_environment_type,
              server_region_or_datacenter, auth_type, write_allowed
       FROM \`brands\` WHERE target_key = ? OR normalized_brand_name = ? LIMIT 1`,
      [resolvedBrandKey, resolvedBrandKey]
    ).catch(() => [[]]);
    brandRow = bRows[0] || null;
  }

  // Resolve workspace properties (non-blocking)
  let workspaceRow = null;
  if (resolvedWorkspaceKey) {
    const [wRows] = await pool.query(
      `SELECT workspace_id, display_name, workspace_type, linked_brand_key, bootstrap_status
       FROM \`workspace_registry\` WHERE workspace_key = ? AND tenant_id = ? LIMIT 1`,
      [resolvedWorkspaceKey, tenant_id]
    ).catch(() => [[]]);
    workspaceRow = wRows[0] || null;
    // If workspace has a linked brand and no explicit brand_key was given, use it
    if (!resolvedBrandKey && workspaceRow?.linked_brand_key) {
      const [bRows] = await pool.query(
        `SELECT brand_name, brand_domain, hosting_provider, server_environment_type,
                server_region_or_datacenter, auth_type, write_allowed
         FROM \`brands\` WHERE target_key = ? LIMIT 1`,
        [workspaceRow.linked_brand_key]
      ).catch(() => [[]]);
      brandRow = bRows[0] || null;
    }
  }

  // Validate user membership in tenant (if user_id provided)
  if (user_id) {
    const [memRows] = await pool.query(
      "SELECT user_id FROM `memberships` WHERE user_id = ? AND tenant_id = ? AND status = 'active' LIMIT 1",
      [user_id, tenant_id]
    ).catch(() => [[]]);
    if (!memRows[0]) {
      throw Object.assign(
        new Error(`User '${user_id}' has no active membership in tenant '${tenant_id}'`),
        { code: "membership_required", status: 403 }
      );
    }
  }

  // Upsert customer_sessions
  await pool.query(
    `INSERT INTO \`customer_sessions\`
       (session_id, tenant_id, user_id, originator, cli_version, source, model_provider,
        model_name, cwd, git_branch, git_commit_hash, git_repo_url,
        brand_key, workspace_key,
        base_instructions_hash, base_instructions_text, session_status, started_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)
     ON DUPLICATE KEY UPDATE
       session_status = IF(session_status = 'active', 'active', session_status),
       ended_at = NULL`,
    [
      session_id,
      tenant_id,
      user_id || null,
      sessionData.originator    || null,
      sessionData.cli_version   || null,
      sessionData.source        || null,
      sessionData.model_provider || null,
      sessionData.model_name    || null,
      sessionData.cwd           || null,
      gitCtx.branch             || null,
      // Codex: commit_hash  |  platform: commit_hash (same, but guard both)
      gitCtx.commit_hash        || null,
      // Codex: repository_url  |  platform: repository_url or repo_url
      gitCtx.repository_url    || gitCtx.repo_url || null,
      resolvedBrandKey,
      resolvedWorkspaceKey,
      instrText ? sha256(instrText) : null,
      instrText,
      toDatetime(sessionData.timestamp || sessionData.started_at),
    ]
  );

  // --- 2. Process event_msg and response_item records ---
  const turnIndex = {};
  let nextIndex   = 0;

  for (const rec of records) {
    const rtype = rec.type || rec.record_type;

    // ── event_msg ─────────────────────────────────────────────────────────────
    if (rtype === "event_msg") {
      // Codex: { type, timestamp, payload: { type, turn_id, started_at (epoch s), ... } }
      const d       = unwrap(rec);
      const turn_id = d.turn_id || null;
      const etype   = d.type || rec.event_type;

      if (turn_id && etype === "task_started") {
        if (!(turn_id in turnIndex)) turnIndex[turn_id] = nextIndex++;

        await pool.query(
          `INSERT INTO \`session_turns\`
             (turn_id, session_id, tenant_id, turn_index, model_context_window,
              collaboration_mode, turn_status, started_at)
           VALUES (?,?,?,?,?,?,'running',?)
           ON DUPLICATE KEY UPDATE started_at = VALUES(started_at)`,
          [
            turn_id, session_id, tenant_id,
            turnIndex[turn_id],
            d.model_context_window || null,
            d.collaboration_mode_kind || d.collaboration_mode || null,
            toDatetime(d.started_at || rec.timestamp),
          ]
        );

        // bump session turn_count
        await pool.query(
          "UPDATE `customer_sessions` SET turn_count = turn_count + 1 WHERE session_id = ?",
          [session_id]
        ).catch(() => {});
      }

      if (turn_id && (etype === "task_completed" || etype === "task_aborted" || etype === "task_failed")) {
        const ts = etype === "task_completed" ? "completed"
                 : etype === "task_aborted"   ? "aborted" : "failed";
        await pool.query(
          "UPDATE `session_turns` SET turn_status = ?, completed_at = ? WHERE turn_id = ?",
          [ts, toDatetime(d.completed_at || rec.timestamp), turn_id]
        ).catch(() => {});
      }

      // Always log as event
      await pool.query(
        `INSERT IGNORE INTO \`session_events\`
           (event_id, session_id, turn_id, tenant_id, record_type, event_type, payload_json, event_timestamp)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          randomUUID(), session_id, turn_id, tenant_id,
          "event_msg", etype,
          JSON.stringify(d),
          toDatetime(d.started_at || rec.timestamp),
        ]
      );
    }

    // ── response_item ─────────────────────────────────────────────────────────
    if (rtype === "response_item") {
      // Codex: { type, timestamp, payload: { type: "message", role, content: [...] } }
      const d       = unwrap(rec);
      const turn_id = d.turn_id || null;
      const etype   = d.type || d.role || "response_item";

      await pool.query(
        `INSERT IGNORE INTO \`session_events\`
           (event_id, session_id, turn_id, tenant_id, record_type, event_type, payload_json, event_timestamp)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          randomUUID(), session_id, turn_id, tenant_id,
          "response_item", etype,
          JSON.stringify(d),
          toDatetime(rec.timestamp),
        ]
      );
    }

    // ── session_meta as event ─────────────────────────────────────────────────
    if (rtype === "session_meta") {
      const d = unwrap(rec);
      await pool.query(
        `INSERT IGNORE INTO \`session_events\`
           (event_id, session_id, turn_id, tenant_id, record_type, event_type, payload_json, event_timestamp)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          randomUUID(), session_id, null, tenant_id,
          "session_meta", "session_started",
          JSON.stringify(d),
          toDatetime(d.timestamp || rec.timestamp),
        ]
      );
    }
  }

  return { session_id };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function buildSessionRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();
  router.use(requireBackendApiKey);

  // ── POST /sessions/ingest — ingest a JSONL session dump ───────────────────
  // Body: { tenant_id, user_id?, brand_key?, workspace_key?, records: [...] }
  // records may be a pre-parsed array or raw JSONL text sent as { jsonl: "..." }
  router.post("/sessions/ingest", async (req, res) => {
    try {
      const { tenant_id, user_id, brand_key, workspace_key, records, jsonl } = req.body;
      if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

      let parsed = records;
      if (!parsed && jsonl) parsed = parseJsonl(String(jsonl));
      if (!Array.isArray(parsed) || !parsed.length)
        return res.status(400).json({ error: "records array or jsonl string required" });

      const { session_id } = await ingestParsedRecords(parsed, { tenant_id, user_id, brand_key, workspace_key });

      res.status(201).json({ ok: true, session_id, record_count: parsed.length });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, code: err.code });
    }
  });

  // ── POST /sessions/:id/complete — mark session ended ─────────────────────
  router.post("/sessions/:id/complete", async (req, res) => {
    try {
      const { status = "completed" } = req.body;
      const allowed = ["completed", "failed", "aborted"];
      if (!allowed.includes(status))
        return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });

      await getPool().query(
        "UPDATE `customer_sessions` SET session_status = ?, ended_at = NOW() WHERE session_id = ?",
        [status, req.params.id]
      );
      res.json({ ok: true, session_id: req.params.id, session_status: status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sessions — list sessions for a tenant ────────────────────────────
  router.get("/sessions", async (req, res) => {
    try {
      const { tenant_id, user_id, originator, session_status, brand_key, workspace_key, limit = 50 } = req.query;
      if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

      let sql = `
        SELECT cs.*,
               u.email          AS user_email,
               u.display_name   AS user_display_name,
               u.status         AS user_status,
               ap.actor_type,
               b.brand_name,
               b.brand_domain,
               b.hosting_provider,
               b.server_environment_type,
               wr.display_name  AS workspace_name,
               wr.workspace_type,
               wr.bootstrap_status AS workspace_bootstrap_status
        FROM \`customer_sessions\` cs
        LEFT JOIN \`users\`              u  ON u.user_id       = cs.user_id
        LEFT JOIN \`actor_profiles\`     ap ON ap.user_id      = cs.user_id AND ap.tenant_id = cs.tenant_id
        LEFT JOIN \`brands\`             b  ON b.target_key    = cs.brand_key
        LEFT JOIN \`workspace_registry\` wr ON wr.workspace_key = cs.workspace_key AND wr.tenant_id = cs.tenant_id
        WHERE cs.tenant_id = ?`;
      const params = [tenant_id];
      if (user_id)        { sql += " AND cs.user_id = ?";        params.push(user_id); }
      if (originator)     { sql += " AND cs.originator = ?";     params.push(originator); }
      if (session_status) { sql += " AND cs.session_status = ?"; params.push(session_status); }
      if (brand_key)      { sql += " AND cs.brand_key = ?";      params.push(brand_key); }
      if (workspace_key)  { sql += " AND cs.workspace_key = ?";  params.push(workspace_key); }
      sql += " ORDER BY cs.started_at DESC LIMIT ?";
      params.push(Number(limit));

      const [rows] = await getPool().query(sql, params);
      res.json({ sessions: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sessions/:id — single session with turns + enriched properties ──
  router.get("/sessions/:id", async (req, res) => {
    try {
      const pool = getPool();
      const [[sessions], [turns]] = await Promise.all([
        pool.query(
          `SELECT cs.*,
                  u.email            AS user_email,
                  u.display_name     AS user_display_name,
                  u.status           AS user_status,
                  ap.actor_type,
                  m.role             AS membership_role,
                  b.brand_name,
                  b.brand_domain,
                  b.base_url         AS brand_base_url,
                  b.hosting_provider,
                  b.server_environment_type,
                  b.server_region_or_datacenter,
                  b.auth_type        AS brand_auth_type,
                  b.write_allowed    AS brand_write_allowed,
                  bc.doc_key         AS brand_doc_key,
                  bc.status          AS brand_core_status,
                  wr.workspace_id,
                  wr.display_name    AS workspace_name,
                  wr.workspace_type,
                  wr.linked_brand_key,
                  wr.bootstrap_status AS workspace_bootstrap_status
           FROM \`customer_sessions\` cs
           LEFT JOIN \`users\`              u  ON u.user_id        = cs.user_id
           LEFT JOIN \`actor_profiles\`     ap ON ap.user_id       = cs.user_id AND ap.tenant_id = cs.tenant_id
           LEFT JOIN \`memberships\`        m  ON m.user_id        = cs.user_id AND m.tenant_id  = cs.tenant_id AND m.status = 'active'
           LEFT JOIN \`brands\`             b  ON b.target_key     = cs.brand_key
           LEFT JOIN \`brand_core\`         bc ON bc.brand_key     = cs.brand_key
           LEFT JOIN \`workspace_registry\` wr ON wr.workspace_key = cs.workspace_key AND wr.tenant_id = cs.tenant_id
           WHERE cs.session_id = ? LIMIT 1`,
          [req.params.id]
        ),
        pool.query(
          "SELECT * FROM `session_turns` WHERE session_id = ? ORDER BY turn_index ASC",
          [req.params.id]
        ),
      ]);
      if (!sessions[0]) return res.status(404).json({ error: "session_not_found" });
      res.json({ session: sessions[0], turns });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sessions/:id/turns — turns for a session ────────────────────────
  router.get("/sessions/:id/turns", async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `session_turns` WHERE session_id = ? ORDER BY turn_index ASC",
        [req.params.id]
      );
      res.json({ turns: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /sessions/:id/events — events for a session ──────────────────────
  router.get("/sessions/:id/events", async (req, res) => {
    try {
      const { record_type, event_type, turn_id, limit = 200 } = req.query;

      let sql = "SELECT * FROM `session_events` WHERE session_id = ?";
      const params = [req.params.id];
      if (record_type) { sql += " AND record_type = ?"; params.push(record_type); }
      if (event_type)  { sql += " AND event_type = ?";  params.push(event_type); }
      if (turn_id)     { sql += " AND turn_id = ?";     params.push(turn_id); }
      sql += " ORDER BY event_timestamp ASC, id ASC LIMIT ?";
      params.push(Number(limit));

      const [rows] = await getPool().query(sql, params);
      res.json({ events: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /sessions/:id/assimilate — queue for knowledge assimilation ──────
  // Enqueues the session into session_assimilation_queue for the
  // post_conversation_knowledge_assimilation workflow consumer.
  router.post("/sessions/:id/assimilate", async (req, res) => {
    try {
      const pool = getPool();
      const [sessions] = await pool.query(
        "SELECT session_id, tenant_id, session_status FROM `customer_sessions` WHERE session_id = ? LIMIT 1",
        [req.params.id]
      );
      const session = sessions[0];
      if (!session) return res.status(404).json({ error: "session_not_found" });

      const { workflow_key = "post_conversation_knowledge_assimilation" } = req.body;
      const queue_id = randomUUID();

      await pool.query(
        `INSERT INTO \`session_assimilation_queue\`
           (queue_id, session_id, tenant_id, workflow_key, status)
         VALUES (?,?,?,?,'pending')
         ON DUPLICATE KEY UPDATE status = IF(status = 'failed', 'pending', status)`,
        [queue_id, session.session_id, session.tenant_id, workflow_key]
      );

      res.status(202).json({
        ok: true,
        queue_id,
        session_id: session.session_id,
        workflow_key,
        status: "pending",
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /session-assimilation-queue — queue status for tenant ────────────
  router.get("/session-assimilation-queue", async (req, res) => {
    try {
      const { tenant_id, status, limit = 100 } = req.query;
      if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

      let sql = `SELECT q.*, cs.originator, cs.session_status
                 FROM \`session_assimilation_queue\` q
                 LEFT JOIN \`customer_sessions\` cs ON cs.session_id = q.session_id
                 WHERE q.tenant_id = ?`;
      const params = [tenant_id];
      if (status) { sql += " AND q.status = ?"; params.push(status); }
      sql += " ORDER BY q.queued_at DESC LIMIT ?";
      params.push(Number(limit));

      const [rows] = await getPool().query(sql, params);
      res.json({ queue: rows, total: rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /session-assimilation-queue/process-pending — batch consumer ────
  // Registered before /:id/process so Express does not match "process-pending" as :id.
  // Picks up pending queue items, creates an execution_plan per session, and dispatches
  // the post_conversation_knowledge_assimilation workflow via dispatchPlan().
  router.post("/session-assimilation-queue/process-pending", async (req, res) => {
    try {
      const { tenant_id, limit = 10 } = req.body || {};
      const pool = getPool();

      let sql = `
        SELECT q.queue_id, q.session_id, q.tenant_id, q.workflow_key,
               cs.originator, cs.user_id, cs.brand_key, cs.workspace_key,
               cs.git_repo_url, cs.git_branch, cs.turn_count,
               cs.started_at AS session_started_at
        FROM \`session_assimilation_queue\` q
        JOIN \`customer_sessions\` cs ON cs.session_id = q.session_id
        WHERE q.status = 'pending'`;
      const params = [];
      if (tenant_id) { sql += " AND q.tenant_id = ?"; params.push(tenant_id); }
      sql += " ORDER BY q.queued_at ASC LIMIT ?";
      params.push(Number(limit));

      const [items] = await pool.query(sql, params);
      if (!items.length) return res.json({ ok: true, processed: 0, results: [] });

      const results = [];

      for (const item of items) {
        // Atomic claim
        const [claim] = await pool.query(
          "UPDATE `session_assimilation_queue` SET status = 'processing' WHERE queue_id = ? AND status = 'pending'",
          [item.queue_id]
        );
        if (claim.affectedRows === 0) {
          results.push({ queue_id: item.queue_id, skipped: true });
          continue;
        }

        let plan_id, run_id, dispatchErr;
        try {
          plan_id = randomUUID();

          // Build a plan whose steps carry the session context for the assimilation workflow
          await pool.query(
            `INSERT INTO \`execution_plans\`
               (plan_id, tenant_id, user_id, workflow_key, intent_key,
                plan_status, access_decision, service_mode, steps_json, created_at)
             VALUES (?,?,?,?,?,'validated','ALLOW_SELF_SERVE','self_serve',?,NOW())`,
            [
              plan_id,
              item.tenant_id,
              item.user_id || null,
              item.workflow_key,
              `assimilate_session:${item.session_id}`,
              JSON.stringify([{
                step_key:      "assimilate_session",
                session_id:    item.session_id,
                originator:    item.originator,
                brand_key:     item.brand_key,
                workspace_key: item.workspace_key,
                git_repo_url:  item.git_repo_url,
                git_branch:    item.git_branch,
                turn_count:    item.turn_count,
                session_started_at: item.session_started_at,
              }]),
            ]
          );

          const dispatch = await dispatchPlan(plan_id, { actor_id: "system:session_assimilation" });
          if (!dispatch.ok) throw new Error(dispatch.error?.message || "dispatch returned ok=false");
          run_id = dispatch.run_id;

          await pool.query(
            "UPDATE `session_assimilation_queue` SET status = 'completed', run_id = ?, processed_at = NOW() WHERE queue_id = ?",
            [run_id, item.queue_id]
          );
          results.push({ queue_id: item.queue_id, plan_id, run_id, ok: true });
        } catch (err) {
          dispatchErr = err;
          await pool.query(
            "UPDATE `session_assimilation_queue` SET status = 'failed', error_msg = ?, processed_at = NOW() WHERE queue_id = ?",
            [err.message.slice(0, 500), item.queue_id]
          ).catch(() => {});
          results.push({ queue_id: item.queue_id, plan_id: plan_id || null, ok: false, error: err.message });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      const failed    = results.filter(r => !r.ok && !r.skipped).length;
      res.json({ ok: failed === 0, processed: succeeded, failed, skipped: results.filter(r => r.skipped).length, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── POST /session-assimilation-queue/:id/process — mark queue item done ──
  // Called by the workflow on completion to update the queue entry status.
  router.post("/session-assimilation-queue/:id/process", async (req, res) => {
    try {
      const { status = "completed", run_id, error_msg } = req.body;
      const allowed = ["completed", "failed", "skipped"];
      if (!allowed.includes(status))
        return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });

      await getPool().query(
        `UPDATE \`session_assimilation_queue\`
           SET status = ?, run_id = ?, error_msg = ?, processed_at = NOW()
         WHERE queue_id = ?`,
        [status, run_id || null, error_msg || null, req.params.id]
      );
      res.json({ ok: true, queue_id: req.params.id, status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
