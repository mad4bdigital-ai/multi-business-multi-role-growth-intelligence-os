import { getPool } from "./db.js";
import { resolveRuntimeEnvironment } from "./runtimeEnvironmentResolver.js";

export const LOCAL_MANAGER_WINDOWS_LATEST_VERSION = "0.2.31";
export const LOCAL_MANAGER_WINDOWS_RELEASE_TAG = "local-manager-windows-latest";
export const LOCAL_MANAGER_WINDOWS_EXE_URL = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup-0.2.31.exe";
export const LOCAL_MANAGER_WINDOWS_SHA256_URL = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup-0.2.31.exe.sha256.json";

const RELEASE_REPOSITORY_PATH = Object.freeze([
  "mad4bdigital-ai",
  "multi-business-multi-role-growth-intelligence-os",
  "releases",
  "download",
]);

const RELEASE_POLICIES = Object.freeze({
  production: Object.freeze({ channel: "latest-prerelease", tag: "local-manager-windows-latest" }),
  staging: Object.freeze({ channel: "latest-staging", tag: "local-manager-windows-staging" }),
});

export function normalizeVersion(value) {
  const raw = String(value || "").trim().replace(/^v/i, "");
  return raw.split(/[+-]/)[0] || raw;
}

export function compareVersions(left, right) {
  const leftParts = normalizeVersion(left).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < maxLength; i += 1) {
    const delta = (leftParts[i] || 0) - (rightParts[i] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function releaseError(code, message, status = 503) {
  return Object.assign(new Error(message), { status, code });
}

function policyForRuntime(runtime) {
  if (!runtime?.ok || !RELEASE_POLICIES[runtime.environment_key]) {
    throw releaseError(
      "local_manager_release_environment_unresolved",
      "Local Manager release selection requires an explicit supported runtime environment.",
    );
  }
  return RELEASE_POLICIES[runtime.environment_key];
}

function parseReleaseAsset(value, expectedTag) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw releaseError("local_manager_release_artifact_invalid", "Local Manager release artifact URL is invalid.");
  }
  if (parsed.protocol !== "https:"
      || parsed.hostname !== "github.com"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash) {
    throw releaseError("local_manager_release_artifact_invalid", "Local Manager release artifact origin is not canonical.");
  }
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw releaseError("local_manager_release_artifact_invalid", "Local Manager release artifact path encoding is invalid.");
  }
  const segments = decodedPath.split("/").filter(Boolean);
  if (segments.some((part) => part === "." || part === "..")
      || segments.length !== 6
      || RELEASE_REPOSITORY_PATH.some((part, index) => segments[index] !== part)
      || segments[4] !== expectedTag) {
    throw releaseError("local_manager_release_channel_mismatch", "Local Manager release artifact does not match the runtime release channel.");
  }
  return { url: parsed.href, filename: segments[5] };
}

function allowedExecutableNames(version) {
  const normalized = normalizeVersion(version);
  const names = new Set(["Mad4B-Local-Manager-Setup.exe"]);
  if (normalized) names.add(`Mad4B-Local-Manager-Setup-${normalized}.exe`);
  return names;
}

export function validateLocalManagerReleaseForEnvironment(release, { runtime, requireHash = true } = {}) {
  const policy = policyForRuntime(runtime);
  if (String(release?.release_channel || "") !== policy.channel) {
    throw releaseError("local_manager_release_channel_mismatch", "Local Manager release registry channel does not match this runtime.");
  }
  if (release?.release_tag && String(release.release_tag) !== policy.tag) {
    throw releaseError("local_manager_release_channel_mismatch", "Local Manager release tag does not match this runtime.");
  }

  const artifact = parseReleaseAsset(release?.artifact_url, policy.tag);
  if (!allowedExecutableNames(release?.version).has(artifact.filename)) {
    throw releaseError("local_manager_release_filename_mismatch", "Local Manager release filename does not match the registered version.");
  }

  let sha256Url = release?.sha256_url || null;
  if (sha256Url) {
    const checksum = parseReleaseAsset(sha256Url, policy.tag);
    if (checksum.filename !== `${artifact.filename}.sha256.json`) {
      throw releaseError("local_manager_release_checksum_mismatch", "Local Manager checksum metadata does not match the executable.");
    }
    sha256Url = checksum.url;
  }

  const sha256 = String(release?.sha256 || "").trim();
  if (requireHash && !/^[a-f0-9]{64}$/iu.test(sha256)) {
    throw releaseError("local_manager_release_integrity_unavailable", "Local Manager release SHA-256 is missing or invalid.");
  }

  return {
    ...release,
    release_channel: policy.channel,
    release_tag: policy.tag,
    artifact_url: artifact.url,
    sha256_url: sha256Url,
    sha256: sha256 || null,
  };
}

function localManagerFallbackReleaseRow() {
  return {
    app_key: "mad4b-local-manager",
    platform: "windows",
    release_channel: "latest-prerelease",
    version: LOCAL_MANAGER_WINDOWS_LATEST_VERSION,
    minimum_supported_version: null,
    release_tag: LOCAL_MANAGER_WINDOWS_RELEASE_TAG,
    artifact_url: LOCAL_MANAGER_WINDOWS_EXE_URL,
    sha256_url: LOCAL_MANAGER_WINDOWS_SHA256_URL,
    sha256: null,
    update_required: 0,
    release_notes_json: [
      "Adds Continue with Google to Local Manager device approval.",
      "Adds forgot-password entry point while preserving the pairing code.",
      "Keeps device approval on the installed app polling flow after authentication."
    ],
    source: "code_fallback",
  };
}

function stagingUnavailable() {
  return releaseError(
    "local_manager_staging_release_unavailable",
    "No verified Local Manager staging release is registered.",
  );
}

export async function latestLocalManagerWindowsRelease({ pool = null, env = process.env } = {}) {
  const runtime = resolveRuntimeEnvironment(env);
  const policy = policyForRuntime(runtime);
  const fallback = validateLocalManagerReleaseForEnvironment(localManagerFallbackReleaseRow(), {
    runtime: { ok: true, environment_key: "production" },
    requireHash: false,
  });

  let rows;
  try {
    [rows] = await (pool || getPool()).query(
      `SELECT * FROM \`local_app_releases\`
        WHERE app_key = 'mad4b-local-manager'
          AND platform = 'windows'
          AND release_channel = ?
          AND status = 'active'
        ORDER BY COALESCE(published_at, updated_at, created_at) DESC, version DESC, release_id DESC
        LIMIT 2`,
      [policy.channel],
    );
  } catch {
    if (runtime.environment_key === "staging") throw stagingUnavailable();
    return {
      ...fallback,
      source: "code_fallback_registry_unavailable",
      registry_degraded: true,
      registry_reason: "local_app_release_registry_unavailable",
    };
  }

  const [selectedRow = null] = rows;
  if (!selectedRow) {
    if (runtime.environment_key === "staging") throw stagingUnavailable();
    return {
      ...fallback,
      source: "code_fallback_registry_empty",
      registry_degraded: true,
      registry_reason: "local_app_release_registry_empty",
    };
  }

  const selected = validateLocalManagerReleaseForEnvironment(selectedRow, { runtime, requireHash: true });
  const normalizedSelected = { ...selected, source: "db", registry_degraded: false, registry_reason: null };
  if (runtime.environment_key === "staging") return normalizedSelected;

  const fallbackVersion = normalizeVersion(fallback.version);
  const selectedVersion = normalizeVersion(normalizedSelected.version);
  if (compareVersions(fallbackVersion, selectedVersion) > 0) {
    return {
      ...fallback,
      source: "code_fallback_newer_than_db",
      registry_degraded: true,
      registry_reason: "local_app_release_registry_stale",
      stale_db_version: normalizedSelected.version || null,
      stale_db_release_id: normalizedSelected.release_id || null,
    };
  }
  return normalizedSelected;
}
