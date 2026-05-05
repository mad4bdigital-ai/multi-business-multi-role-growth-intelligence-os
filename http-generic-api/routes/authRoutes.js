import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

// Default fallback secret for development if missing.
const JWT_SECRET = process.env.JWT_SECRET || "development_fallback_secret_only";

// The client ID shouldn't strictly be required in development for testing,
// but validation logic will use it if provided.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export function buildAuthRoutes(deps) {
  const router = Router();

  // ── POST /auth/register ─────────────────────────────────────────────────────
  router.post("/register", async (req, res) => {
    try {
      const { email, password, display_name } = req.body || {};
      if (!email || !password || !display_name) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "email, password, and display_name are required." } });
      }

      const user_id = randomUUID();
      const password_hash = await bcrypt.hash(password, 10);

      // Attempt to create user
      const connection = await getPool().getConnection();
      try {
        await connection.beginTransaction();

        await connection.query(
          `INSERT INTO \`users\` (user_id, email, display_name, status) VALUES (?, ?, ?, ?)`,
          [user_id, email, display_name, "active"]
        );

        await connection.query(
          `INSERT INTO \`user_credentials\` (user_id, auth_provider, password_hash) VALUES (?, ?, ?)`,
          [user_id, "platform", password_hash]
        );

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        if (err.code === "ER_DUP_ENTRY") {
          return res.status(409).json({ ok: false, error: { code: "user_already_exists", message: "A user with this email already exists." } });
        }
        throw err;
      } finally {
        connection.release();
      }

      // Generate token
      const token = jwt.sign({ user_id, email }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(201).json({ ok: true, user_id, email, display_name, token });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "registration_failed", message: err.message } });
    }
  });

  // ── POST /auth/login ────────────────────────────────────────────────────────
  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "email and password are required." } });
      }

      const [rows] = await getPool().query(
        `SELECT u.user_id, u.email, u.display_name, u.status, uc.password_hash
         FROM \`users\` u
         JOIN \`user_credentials\` uc ON u.user_id = uc.user_id
         WHERE u.email = ? AND uc.auth_provider = 'platform' LIMIT 1`,
        [email]
      );

      if (!rows.length) {
        return res.status(401).json({ ok: false, error: { code: "invalid_credentials", message: "Invalid email or password." } });
      }

      const user = rows[0];
      if (user.status !== "active") {
        return res.status(403).json({ ok: false, error: { code: "account_inactive", message: "Account is not active." } });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        return res.status(401).json({ ok: false, error: { code: "invalid_credentials", message: "Invalid email or password." } });
      }

      // Generate token
      const token = jwt.sign({ user_id: user.user_id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(200).json({ ok: true, user_id: user.user_id, email: user.email, display_name: user.display_name, token });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "login_failed", message: err.message } });
    }
  });

  // ── POST /auth/google ───────────────────────────────────────────────────────
  router.post("/google", async (req, res) => {
    try {
      const { id_token } = req.body || {};
      if (!id_token) {
        return res.status(400).json({ ok: false, error: { code: "missing_fields", message: "id_token is required." } });
      }

      // Verify Google token
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken: id_token,
          audience: GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID : undefined,
        });
        payload = ticket.getPayload();
      } catch (verifyErr) {
        return res.status(401).json({ ok: false, error: { code: "invalid_token", message: "Invalid Google ID token." } });
      }

      const { sub: provider_id, email, name: display_name } = payload;

      const connection = await getPool().getConnection();
      let user_id;

      try {
        await connection.beginTransaction();

        // Check if user credentials already exist for this Google ID
        const [credRows] = await connection.query(
          `SELECT user_id FROM \`user_credentials\` WHERE auth_provider = 'google' AND provider_id = ? LIMIT 1`,
          [provider_id]
        );

        if (credRows.length) {
          user_id = credRows[0].user_id;
        } else {
          // Check if a user with this email already exists
          const [userRows] = await connection.query(
            `SELECT user_id FROM \`users\` WHERE email = ? LIMIT 1`,
            [email]
          );

          if (userRows.length) {
            user_id = userRows[0].user_id;
          } else {
            // Create a new user
            user_id = randomUUID();
            await connection.query(
              `INSERT INTO \`users\` (user_id, email, display_name, status) VALUES (?, ?, ?, ?)`,
              [user_id, email, display_name, "active"]
            );
          }

          // Link Google credential
          await connection.query(
            `INSERT INTO \`user_credentials\` (user_id, auth_provider, provider_id) VALUES (?, ?, ?)`,
            [user_id, "google", provider_id]
          );
        }

        await connection.commit();
      } catch (err) {
        await connection.rollback();
        throw err;
      } finally {
        connection.release();
      }

      // Generate JWT
      const token = jwt.sign({ user_id, email }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(200).json({ ok: true, user_id, email, display_name, token });
    } catch (err) {
      return res.status(500).json({ ok: false, error: { code: "google_auth_failed", message: err.message } });
    }
  });

  return router;
}
