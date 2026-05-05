import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

export function buildCustomerRoutes(deps) {
  const { requireBackendApiKey } = deps;
  const router = Router();

  // ── POST /customers ────────────────────────────────────────────────────────
  router.post("/customers", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, display_name, email, phone, company, metadata_json } = req.body || {};
      if (!tenant_id || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and display_name are required." } });
      }
      const customer_id = randomUUID();
      const meta = metadata_json ? JSON.stringify(metadata_json) : null;
      await getPool().query(
        `INSERT INTO \`customers\` (customer_id, tenant_id, display_name, email, phone, company, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [customer_id, tenant_id, display_name, email || null, phone || null, company || null, meta]
      );
      return res.status(201).json({ ok: true, customer_id, tenant_id, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customer_create_failed", message: err.message } });
    }
  });

  // ── GET /customers/:id ─────────────────────────────────────────────────────
  router.get("/customers/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `customers` WHERE customer_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "customer_not_found", message: `Customer ${req.params.id} not found.` } });
      const c = rows[0];
      if (c.metadata_json) try { c.metadata_json = JSON.parse(c.metadata_json); } catch {}
      return res.status(200).json({ ok: true, customer: c });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customer_read_failed", message: err.message } });
    }
  });

  // ── POST /tickets ──────────────────────────────────────────────────────────
  router.post("/tickets", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, title, subject, customer_id, thread_id, category = "general", priority = "normal", service_mode = "self_serve", metadata_json } = req.body || {};
      const finalTitle = title || subject;
      if (!tenant_id || !finalTitle) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and title (or subject) are required." } });
      }
      const ticket_id = randomUUID();
      const meta = metadata_json ? JSON.stringify(metadata_json) : null;
      await getPool().query(
        `INSERT INTO \`tickets\` (ticket_id, tenant_id, title, customer_id, thread_id, category, priority, service_mode, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ticket_id, tenant_id, finalTitle, customer_id || null, thread_id || null, category, priority, service_mode, meta]
      );
      return res.status(201).json({ ok: true, ticket_id, tenant_id, title: finalTitle, category, priority, status: "open" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_create_failed", message: err.message } });
    }
  });

  // ── GET /tickets/:id ───────────────────────────────────────────────────────
  router.get("/tickets/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query("SELECT * FROM `tickets` WHERE ticket_id = ? LIMIT 1", [req.params.id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "ticket_not_found", message: `Ticket ${req.params.id} not found.` } });
      return res.status(200).json({ ok: true, ticket: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_read_failed", message: err.message } });
    }
  });

  // ── PATCH /tickets/:id/status ─────────────────────────────────────────────
  router.patch("/tickets/:id/status", requireBackendApiKey, async (req, res) => {
    try {
      const { status, assigned_to } = req.body || {};
      const VALID = ["open", "in_review", "awaiting_approval", "resolved", "closed"];
      if (!status || !VALID.includes(status)) {
        return res.status(400).json({ ok: false, error: { code: "invalid_status", message: `status must be one of: ${VALID.join(", ")}` } });
      }
      const sets = ["status = ?"];
      const vals = [status];
      if (assigned_to !== undefined) { sets.push("assigned_to = ?"); vals.push(assigned_to || null); }
      vals.push(req.params.id);
      await getPool().query(`UPDATE \`tickets\` SET ${sets.join(", ")} WHERE ticket_id = ?`, vals);
      return res.status(200).json({ ok: true, ticket_id: req.params.id, status });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_update_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/tickets ───────────────────────────────────────────────
  router.get("/tenants/:id/tickets", requireBackendApiKey, async (req, res) => {
    try {
      const { status, category } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (status) { conditions.push("status = ?"); params.push(status); }
      if (category) { conditions.push("category = ?"); params.push(category); }
      const [rows] = await getPool().query(
        `SELECT ticket_id, title, category, priority, status, service_mode, customer_id, assigned_to, created_at
         FROM \`tickets\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, tickets: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "tickets_list_failed", message: err.message } });
    }
  });

  // ── POST /timeline-events ─────────────────────────────────────────────────
  router.post("/timeline-events", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, event_type, customer_id, ticket_id, thread_id, actor_id, actor_type, summary, payload_json } = req.body || {};
      if (!tenant_id || !event_type) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and event_type are required." } });
      }
      const event_id = randomUUID();
      const payload = payload_json ? JSON.stringify(payload_json) : null;
      await getPool().query(
        `INSERT INTO \`timeline_events\` (event_id, tenant_id, event_type, customer_id, ticket_id, thread_id, actor_id, actor_type, summary, payload_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event_id, tenant_id, event_type, customer_id || null, ticket_id || null, thread_id || null, actor_id || null, actor_type || null, summary || null, payload]
      );
      return res.status(201).json({ ok: true, event_id, event_type, tenant_id });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "event_create_failed", message: err.message } });
    }
  });

  // ── GET /customers/:id/timeline ───────────────────────────────────────────
  router.get("/customers/:id/timeline", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT event_id, event_type, actor_id, actor_type, summary, occurred_at
         FROM \`timeline_events\` WHERE customer_id = ? ORDER BY occurred_at DESC LIMIT 200`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, customer_id: req.params.id, events: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "timeline_read_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/customers ────────────────────────────────────────────
  router.get("/tenants/:id/customers", requireBackendApiKey, async (req, res) => {
    try {
      const { status } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (status) { conditions.push("status = ?"); params.push(status); }
      const [rows] = await getPool().query(
        `SELECT customer_id, display_name, email, phone, company, status, created_at
         FROM \`customers\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 500`,
        params
      );
      return res.status(200).json({ ok: true, customers: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customers_list_failed", message: err.message } });
    }
  });

  // ── PUT /customers/:id ────────────────────────────────────────────────────
  router.put("/customers/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { display_name, email, phone, company, status, metadata_json } = req.body || {};
      if (!display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "display_name is required." } });
      }
      const meta = metadata_json != null ? JSON.stringify(metadata_json) : null;
      await getPool().query(
        `UPDATE \`customers\` SET display_name=?, email=?, phone=?, company=?, status=COALESCE(?,status), metadata_json=? WHERE customer_id=?`,
        [display_name, email || null, phone || null, company || null, status || null, meta, req.params.id]
      );
      return res.status(200).json({ ok: true, customer_id: req.params.id, display_name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customer_update_failed", message: err.message } });
    }
  });

  // ── DELETE /customers/:id ─────────────────────────────────────────────────
  router.delete("/customers/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query("UPDATE `customers` SET status = 'archived' WHERE customer_id = ?", [req.params.id]);
      return res.status(200).json({ ok: true, customer_id: req.params.id, status: "archived" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "customer_delete_failed", message: err.message } });
    }
  });

  // ── POST /contacts ────────────────────────────────────────────────────────
  router.post("/contacts", requireBackendApiKey, async (req, res) => {
    try {
      const { customer_id, tenant_id, name, email, phone, role, primary: isPrimary = false } = req.body || {};
      if (!tenant_id || !name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and name are required." } });
      }
      const contact_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`contacts\` (contact_id, customer_id, tenant_id, name, email, phone, role, \`primary\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [contact_id, customer_id || null, tenant_id, name, email || null, phone || null, role || null, isPrimary ? 1 : 0]
      );
      return res.status(201).json({ ok: true, contact_id, tenant_id, name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "contact_create_failed", message: err.message } });
    }
  });

  // ── DELETE /contacts/:id ─────────────────────────────────────────────────
  router.delete("/contacts/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query("DELETE FROM `contacts` WHERE contact_id = ?", [req.params.id]);
      return res.status(200).json({ ok: true, contact_id: req.params.id, deleted: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "contact_delete_failed", message: err.message } });
    }
  });

  // ── PUT /contacts/:id ────────────────────────────────────────────────────
  router.put("/contacts/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { name, email, phone, role, primary: isPrimary, status } = req.body || {};
      if (!name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "name is required." } });
      }
      await getPool().query(
        `UPDATE \`contacts\` SET name=?, email=?, phone=?, role=?, \`primary\`=COALESCE(?,\`primary\`), status=COALESCE(?,status) WHERE contact_id=?`,
        [name, email || null, phone || null, role || null,
         isPrimary != null ? (isPrimary ? 1 : 0) : null,
         status || null, req.params.id]
      );
      return res.status(200).json({ ok: true, contact_id: req.params.id, name });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "contact_update_failed", message: err.message } });
    }
  });

  // ── DELETE /threads/:id ───────────────────────────────────────────────────
  router.delete("/threads/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query("UPDATE `threads` SET status = 'closed' WHERE thread_id = ?", [req.params.id]);
      return res.status(200).json({ ok: true, thread_id: req.params.id, status: "closed" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "thread_delete_failed", message: err.message } });
    }
  });

  // ── PUT /threads/:id ──────────────────────────────────────────────────────
  router.put("/threads/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { subject, channel, status, assigned_to } = req.body || {};
      if (!subject) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "subject is required." } });
      }
      await getPool().query(
        `UPDATE \`threads\` SET subject=?, channel=COALESCE(?,channel), status=COALESCE(?,status), assigned_to=? WHERE thread_id=?`,
        [subject, channel || null, status || null, assigned_to || null, req.params.id]
      );
      return res.status(200).json({ ok: true, thread_id: req.params.id, subject });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "thread_update_failed", message: err.message } });
    }
  });

  // ── DELETE /tickets/:id ───────────────────────────────────────────────────
  router.delete("/tickets/:id", requireBackendApiKey, async (req, res) => {
    try {
      await getPool().query("UPDATE `tickets` SET status = 'closed' WHERE ticket_id = ?", [req.params.id]);
      return res.status(200).json({ ok: true, ticket_id: req.params.id, status: "closed" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_delete_failed", message: err.message } });
    }
  });

  // ── PUT /tickets/:id ──────────────────────────────────────────────────────
  router.put("/tickets/:id", requireBackendApiKey, async (req, res) => {
    try {
      const { title, category, priority, status, assigned_to, metadata_json } = req.body || {};
      if (!title) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "title is required." } });
      }
      const meta = metadata_json != null ? JSON.stringify(metadata_json) : null;
      await getPool().query(
        `UPDATE \`tickets\` SET title=?, category=COALESCE(?,category), priority=COALESCE(?,priority),
         status=COALESCE(?,status), assigned_to=?, metadata_json=COALESCE(?,metadata_json) WHERE ticket_id=?`,
        [title, category || null, priority || null, status || null, assigned_to || null, meta, req.params.id]
      );
      return res.status(200).json({ ok: true, ticket_id: req.params.id, title });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "ticket_update_failed", message: err.message } });
    }
  });

  // ── GET /customers/:id/contacts ───────────────────────────────────────────
  router.get("/customers/:id/contacts", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        `SELECT contact_id, name, email, phone, role, \`primary\`, status, created_at
         FROM \`contacts\` WHERE customer_id = ? ORDER BY \`primary\` DESC, created_at ASC`,
        [req.params.id]
      );
      return res.status(200).json({ ok: true, customer_id: req.params.id, contacts: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "contacts_read_failed", message: err.message } });
    }
  });

  // ── POST /threads ─────────────────────────────────────────────────────────
  router.post("/threads", requireBackendApiKey, async (req, res) => {
    try {
      const { tenant_id, customer_id, subject, channel = "email", assigned_to } = req.body || {};
      if (!tenant_id || !subject) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "tenant_id and subject are required." } });
      }
      const thread_id = randomUUID();
      await getPool().query(
        `INSERT INTO \`threads\` (thread_id, tenant_id, customer_id, subject, channel, assigned_to)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [thread_id, tenant_id, customer_id || null, subject, channel, assigned_to || null]
      );
      return res.status(201).json({ ok: true, thread_id, tenant_id, subject, channel, status: "open" });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "thread_create_failed", message: err.message } });
    }
  });

  // ── GET /threads/:id ──────────────────────────────────────────────────────
  router.get("/threads/:id", requireBackendApiKey, async (req, res) => {
    try {
      const [rows] = await getPool().query(
        "SELECT * FROM `threads` WHERE thread_id = ? LIMIT 1", [req.params.id]
      );
      if (!rows.length) return res.status(404).json({ ok: false, error: { code: "thread_not_found", message: `Thread ${req.params.id} not found.` } });
      return res.status(200).json({ ok: true, thread: rows[0] });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "thread_read_failed", message: err.message } });
    }
  });

  // ── GET /tenants/:id/threads ──────────────────────────────────────────────
  router.get("/tenants/:id/threads", requireBackendApiKey, async (req, res) => {
    try {
      const { status, channel } = req.query;
      const conditions = ["tenant_id = ?"];
      const params = [req.params.id];
      if (status)  { conditions.push("status = ?");  params.push(status); }
      if (channel) { conditions.push("channel = ?"); params.push(channel); }
      const [rows] = await getPool().query(
        `SELECT thread_id, customer_id, subject, channel, status, assigned_to, created_at
         FROM \`threads\` WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT 200`,
        params
      );
      return res.status(200).json({ ok: true, threads: rows, count: rows.length });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "threads_list_failed", message: err.message } });
    }
  });

  return router;
}
