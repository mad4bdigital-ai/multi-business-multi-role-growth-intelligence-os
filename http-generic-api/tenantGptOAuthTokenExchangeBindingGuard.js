import express, { Router } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { normalizeTenantGptOAuthResource } from "./tenantGptOAuthResourceProfile.js";

const REQUIRED_CODE_BINDING_CLAIMS = Object.freeze([
  "jti",
  "user_id",
  "tenant_id",
  "redirect_uri",
  "client_id",
  "resource",
]);

function text(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function invalidCodeClaim(code, message) {
  const error = new Error(message);
  error.name = "JsonWebTokenError";
  error.code = code;
  return error;
}

function validRedirectUri(value) {
  try {
    const url = new URL(text(value));
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function validateTenantGptOAuthAuthorizationCodeBindings(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidCodeClaim("oauth_code_payload_invalid", "OAuth authorization-code payload must be an object.");
  }
  if (payload.purpose !== "custom_gpt_oauth_code") {
    throw invalidCodeClaim("oauth_code_purpose_invalid", "OAuth authorization-code purpose is invalid.");
  }

  for (const claim of REQUIRED_CODE_BINDING_CLAIMS) {
    if (!text(payload[claim])) {
      throw invalidCodeClaim(
        `oauth_code_${claim}_required`,
        `OAuth authorization-code claim ${claim} is required.`,
      );
    }
  }

  if (!validRedirectUri(payload.redirect_uri)) {
    throw invalidCodeClaim("oauth_code_redirect_uri_invalid", "OAuth authorization-code redirect_uri is invalid.");
  }
  if (!normalizeTenantGptOAuthResource(payload.resource)) {
    throw invalidCodeClaim("oauth_code_resource_invalid", "OAuth authorization-code resource is invalid.");
  }

  return payload;
}

export function buildTenantGptOAuthTokenExchangeDeps(deps = {}, env = deps.env || process.env) {
  const injectedVerifyCode = typeof deps.verifyCode === "function" ? deps.verifyCode : null;
  const verifyCode = injectedVerifyCode || ((code) => {
    const jwtSecret = text(env?.JWT_SECRET, 4096);
    if (!jwtSecret) {
      const error = new Error("JWT_SECRET is required for Tenant GPT OAuth token exchange.");
      error.code = "oauth_jwt_secret_unavailable";
      throw error;
    }
    return jwt.verify(text(code, 16384), jwtSecret);
  });

  return {
    ...deps,
    verifyCode(code) {
      return validateTenantGptOAuthAuthorizationCodeBindings(verifyCode(code));
    },
  };
}

export function buildTenantGptOAuthTokenRequestBindingGuard(options = {}) {
  const router = Router();
  const createId = typeof options.randomUUID === "function" ? options.randomUUID : randomUUID;

  router.post("/auth/oauth/token", express.urlencoded({ extended: false }), (req, res, next) => {
    if (text(req.body?.redirect_uri)) return next();

    const requestId = createId();
    delete req.headers.cookie;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("x-request-id", requestId);
    return res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri is required for this authorization code.",
      error_code: "oauth_redirect_uri_required",
      request_id: requestId,
      retry_same_code: true,
      restart_authorization: false,
      outcome_unknown: false,
      operator_reconciliation_required: false,
      secrets_included: false,
    });
  });

  return router;
}

export { REQUIRED_CODE_BINDING_CLAIMS };
