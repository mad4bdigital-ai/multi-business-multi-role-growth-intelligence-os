import express from "express";
import {
  SqlManagedGoogleOAuthStore,
  createManagedGoogleOAuthBroker,
  managedGoogleOAuthErrorResponse,
} from "../managedGoogleOAuthBroker.js";
import { getPool } from "../db.js";

function sendBrokerError(res, error) {
  const normalized = managedGoogleOAuthErrorResponse(error);
  return res.status(normalized.status).json(normalized.body);
}

export function buildManagedGoogleOAuthRoutes(deps = {}) {
  const router = express.Router();
  const env = deps.env || process.env;
  const pool = typeof deps.getPool === "function" ? deps.getPool() : getPool();
  const store = deps.managedGoogleOAuthStore || new SqlManagedGoogleOAuthStore(pool);
  const broker = deps.managedGoogleOAuthBroker || createManagedGoogleOAuthBroker({
    env,
    store,
    fetchImpl: deps.fetch || globalThis.fetch,
    now: deps.now,
    randomBytesImpl: deps.randomBytes,
    randomUuidImpl: deps.randomUUID,
  });

  router.post("/v1/google/oauth/session", async (req, res) => {
    try {
      const result = await broker.createSession(req.body || {});
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendBrokerError(res, error);
    }
  });

  router.get("/v1/google/oauth/callback", async (req, res) => {
    try {
      const result = await broker.handleGoogleCallback({
        code: req.query?.code,
        state: req.query?.state,
        error: req.query?.error,
      });
      if (!result?.redirect_url) {
        return res.status(500).send("Managed Google OAuth callback could not resolve a safe redirect.");
      }
      return res.redirect(302, result.redirect_url);
    } catch (error) {
      const normalized = managedGoogleOAuthErrorResponse(error);
      return res.status(normalized.status).send(normalized.body.error.message);
    }
  });

  router.post("/v1/google/oauth/redeem", async (req, res) => {
    try {
      const result = await broker.redeem(req.body || {});
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendBrokerError(res, error);
    }
  });

  router.post("/v1/google/oauth/refresh", async (req, res) => {
    try {
      const result = await broker.refresh(req.body || {});
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendBrokerError(res, error);
    }
  });

  return router;
}
