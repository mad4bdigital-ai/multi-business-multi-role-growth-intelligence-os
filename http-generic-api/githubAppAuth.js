import crypto from "node:crypto";

let cachedInstallationToken = null;

function envSecretFromReference(reference = "") {
  const ref = String(reference || "").trim();
  const prefix = "ref:secret:";
  const envKey = ref.startsWith(prefix) ? ref.slice(prefix.length).trim() : ref;
  if (!envKey) return "";
  return String(process.env[envKey] || "").trim();
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function decodeGitHubAppPrivateKey(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("BEGIN") && raw.includes("PRIVATE KEY")) return raw.replace(/\\n/g, "\n");

  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    if (decoded.includes("BEGIN") && decoded.includes("PRIVATE KEY")) {
      return decoded.replace(/\\n/g, "\n");
    }
  } catch {
    // Fall through to raw value.
  }

  return raw.replace(/\\n/g, "\n");
}

export function createGitHubAppJwt({ appId, privateKey, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const iss = String(appId || "").trim();
  const key = decodeGitHubAppPrivateKey(privateKey);

  if (!iss) {
    const err = new Error("Missing GitHub App id.");
    err.code = "github_app_auth_missing_app_id";
    err.status = 500;
    throw err;
  }

  if (!key) {
    const err = new Error("Missing GitHub App private key.");
    err.code = "github_app_auth_missing_private_key";
    err.status = 500;
    throw err;
  }

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss,
  };

  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(key);
  return `${signingInput}.${base64Url(signature)}`;
}

export function resolveGitHubAppConfig(action = {}) {
  return {
    appId:
      String(action.github_app_id || "").trim() ||
      String(process.env.GITHUB_APP_ID || "").trim() ||
      "3654304",
    installationId:
      String(action.github_app_installation_id || "").trim() ||
      String(process.env.GITHUB_APP_INSTALLATION_ID || "").trim() ||
      "130821054",
    privateKey:
      envSecretFromReference(action.secret_store_ref) ||
      String(process.env.GITHUB_APP_PRIVATE_KEY_B64 || "").trim(),
  };
}

export async function getGitHubAppInstallationToken({ action = {}, fetchImpl = fetch } = {}) {
  const nowMs = Date.now();
  if (
    cachedInstallationToken?.token &&
    cachedInstallationToken?.expiresAtMs &&
    cachedInstallationToken.expiresAtMs - 60_000 > nowMs
  ) {
    return cachedInstallationToken.token;
  }

  const { appId, installationId, privateKey } = resolveGitHubAppConfig(action);
  if (!installationId) {
    const err = new Error("Missing GitHub App installation id.");
    err.code = "github_app_auth_missing_installation_id";
    err.status = 500;
    throw err;
  }

  const jwt = createGitHubAppJwt({ appId, privateKey });
  const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mad4b-growth-os-github-app",
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.token) {
    const err = new Error(`GitHub App installation token request failed with status ${response.status}.`);
    err.code = "github_app_installation_token_failed";
    err.status = 500;
    err.details = { upstream_status: response.status, message: body?.message || "" };
    throw err;
  }

  const expiresAtMs = body.expires_at ? Date.parse(body.expires_at) : nowMs + 55 * 60_000;
  cachedInstallationToken = {
    token: body.token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : nowMs + 55 * 60_000,
  };

  return cachedInstallationToken.token;
}

export function clearGitHubAppInstallationTokenCache() {
  cachedInstallationToken = null;
}
