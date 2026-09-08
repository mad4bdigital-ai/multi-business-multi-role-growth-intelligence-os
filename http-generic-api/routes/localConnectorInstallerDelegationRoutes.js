import { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

function httpError(status, code, message) {
  const err = new Error(message || code);
  err.status = status;
  err.code = code;
  return err;
}

function installerTokenSecret(env = process.env) {
  const secret = String(env.BACKEND_API_KEY || "").trim();
  if (!secret) throw httpError(500, "installer_token_secret_missing", "BACKEND_API_KEY is required for installer download delegation.");
  return secret;
}

function decodeAndVerifyInstallerToken(token, env = process.env) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) throw httpError(401, "invalid_download_token", "Invalid installer download token.");
  const expected = createHmac("sha256", installerTokenSecret(env)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw httpError(401, "invalid_download_token", "Invalid installer download token signature.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, "invalid_download_token", "Invalid installer download token payload.");
  }
  if (!payload?.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
    throw httpError(401, "download_token_expired", "Installer download token has expired.");
  }
  return payload;
}

function signInstallerToken(payload, env = process.env) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", installerTokenSecret(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function publicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "auth.mad4b.com").split(",")[0].trim();
  return `${proto}://${host}`;
}

function safeDeviceId(value) {
  return String(value || "device").replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function buildCanonicalBootstrapBat({ ps1Url, deviceId, appManaged = false }) {
  const url = String(ps1Url || "").replace(/"/g, "");
  const id = safeDeviceId(deviceId);
  const failSuffix = appManaged ? "exit /b 1" : "pause & exit /b 1";
  const doneSuffix = appManaged ? "exit /b 0" : "pause";
  return [
    "@echo off",
    "setlocal EnableExtensions",
    "REM Mad4B Local Connector canonical installer bootstrap.",
    "REM This BAT never installs or reconfigures cloudflared itself.",
    "",
    "net session >nul 2>&1",
    `if %ERRORLEVEL% neq 0 (echo ERROR: Run as Administrator. & ${failSuffix})`,
    "",
    "set ROOT=%~dp0",
    `set PS1=%ROOT%install-local-connector-${id}.ps1`,
    `set PS1_URL=${url}`,
    "echo Downloading canonical connector-agent installer...",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1%' -UseBasicParsing -TimeoutSec 90\"",
    `if %ERRORLEVEL% neq 0 (echo ERROR: Failed to download canonical PowerShell installer. & ${failSuffix})`,
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PS1%\"",
    `if %ERRORLEVEL% neq 0 (echo ERROR: Canonical PowerShell installer failed. & ${failSuffix})`,
    "echo Done. Canonical Local Connector installer completed.",
    doneSuffix,
  ].join("\r\n");
}

export function buildLocalConnectorInstallerDelegationRoutes({ env = process.env } = {}) {
  const router = Router();

  router.get("/local-connector/install/download", (req, res) => {
    try {
      const payload = decodeAndVerifyInstallerToken(req.query.token, env);
      if (!["ps1", "bat"].includes(payload.format)) {
        throw httpError(400, "unsupported_format", "Only ps1 or bat installer downloads are supported.");
      }

      if (payload.format === "ps1") {
        const canonicalUrl = `${publicBaseUrl(req)}/connector-agent/installer.ps1?token=${encodeURIComponent(String(req.query.token || ""))}`;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Mad4B-Installer-Delegation", "connector-agent-canonical");
        return res.redirect(307, canonicalUrl);
      }

      const ps1Token = signInstallerToken({ ...payload, format: "ps1" }, env);
      const ps1Url = `${publicBaseUrl(req)}/connector-agent/installer.ps1?token=${encodeURIComponent(ps1Token)}`;
      const installer = buildCanonicalBootstrapBat({
        ps1Url,
        deviceId: payload.device_id,
        appManaged: payload.app_managed === true || payload.suppress_pause === true || payload.no_pause === true,
      });
      const filename = `install-local-connector-${safeDeviceId(payload.device_id)}.bat`;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename=\"${filename}\"`);
      res.setHeader("X-Mad4B-Installer-Delegation", "connector-agent-canonical");
      return res.status(200).send(installer);
    } catch (err) {
      return res.status(err.status || 500).json({
        ok: false,
        error: { code: err.code || "installer_delegation_failed", message: err.message },
        secrets_included: false,
      });
    }
  });

  return router;
}

export const _testingLocalConnectorInstallerDelegation = {
  decodeAndVerifyInstallerToken,
  signInstallerToken,
  buildCanonicalBootstrapBat,
};
