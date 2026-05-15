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

function looksLikePem(value = "") {
  return value.trim().startsWith("-----BEGIN") && value.includes("PRIVATE KEY-----");
}

function stripCommonEnvAssignment(value = "") {
  const text = String(value || "").trim();
  const match = text.match(/^(?:export\s+)?(?:GITHUB_APP_PRIVATE_KEY_B64|GITHUB_APP_PRIVATE_KEY)\s*=\s*([\s\S]*)$/);
  return match ? match[1].trim() : text;
}

function normalizePemText(value = "") {
  return stripCommonEnvAssignment(value)
    .trim()
    .replace(/^\uFEFF/, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");
}

function tryDecodeBase64(value = "") {
  try {
    const compact = stripCommonEnvAssignment(value).replace(/\s+/g, "");
    if (!compact) return "";
    return Buffer.from(compact, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

function tryDecodeJsonWrappedSecret(value = "") {
  try {
    const parsed = JSON.parse(stripCommonEnvAssignment(value));
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      return (
        parsed.private_key ||
        parsed.privateKey ||
        parsed.pem ||
        parsed.key ||
        parsed.value ||
        ""
      );
    }
  } catch {
    // Not JSON-wrapped.
  }
  return "";
}

function buildPemCandidates(value = "") {
  const raw = stripCommonEnvAssignment(String(value || "").trim());
  const candidates = [];

  const push = (candidate) => {
    const normalized = normalizePemText(candidate);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };

  push(raw);

  const jsonCandidate = tryDecodeJsonWrappedSecret(raw);
  if (jsonCandidate) push(jsonCandidate);

  const decoded = tryDecodeBase64(raw);
  if (decoded) {
    push(decoded);

    const decodedJsonCandidate = tryDecodeJsonWrappedSecret(decoded);
    if (decodedJsonCandidate) push(decodedJsonCandidate);

    const decodedTwice = tryDecodeBase64(decoded);
    if (decodedTwice) push(decodedTwice);
  }

  return candidates;
}

export function decodeGitHubAppPrivateKey(value = "") {
  const candidates = buildPemCandidates(value);
  const pem = candidates.find(looksLikePem);
  return pem || candidates[0] || "";
}

function createInvalidPrivateKeyError(cause) {
  const err = new Error(
    "GitHub App private key could not be parsed. Provide GITHUB_APP_PRIVATE_KEY as the raw PEM with newline escapes preserved, or GITHUB_APP_PRIVATE_KEY_B64 as base64 of the full PEM private key."
  );
  err.code = "github_app_auth_invalid_private_key";
  err.status = 500;
  err.details = {
    cause_code: cause?.code || "",
    cause_message: cause?.message || "",
    expected_prefixes: ["-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----"],
  };
  return err;
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

  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(key);
  } catch (error) {
    throw createInvalidPrivateKeyError(error);
  }

  return `${signingInput}.${base64Url(signature)}`;
}

export function resolveGitHubAppConfig(action = {}) {
  return {
    appId:
      String(action.github_app_id || "").trim() ||
      String(process.env.GITHUB_APP_ID || "").trim(),
    installationId:
      String(action.github_app_installation_id || "").trim() ||
      String(process.env.GITHUB_APP_INSTALLATION_ID || "").trim(),
    privateKey:
      envSecretFromReference(action.secret_store_ref) ||
      String(process.env.GITHUB_APP_PRIVATE_KEY || "").trim() ||
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
