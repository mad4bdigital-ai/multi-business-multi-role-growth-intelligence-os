export function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  return value;
}

export function debugEnabled() {
  return String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true";
}

export function debugLog(...args) {
  if (debugEnabled()) console.log(...args);
}

export function backendApiKeyEnabled() {
  return !!String(process.env.BACKEND_API_KEY || "").trim();
}

export function requireBackendApiKey(req, res, next) {
  const expected = process.env.BACKEND_API_KEY;
  if (!backendApiKeyEnabled()) return next();

  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    return res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "Invalid backend API key." }
    });
  }
  next();
}
