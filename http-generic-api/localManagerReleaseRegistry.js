import { getPool } from "./db.js";
import { resolveRuntimeEnvironment } from "./runtimeEnvironmentResolver.js";

export const LOCAL_MANAGER_WINDOWS_LATEST_VERSION = "0.2.31";
export const LOCAL_MANAGER_WINDOWS_RELEASE_TAG = "local-manager-windows-latest";
export const LOCAL_MANAGER_WINDOWS_EXE_URL = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup-0.2.31.exe";
export const LOCAL_MANAGER_WINDOWS_SHA256_URL = "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/releases/download/local-manager-windows-latest/Mad4B-Local-Manager-Setup-0.2.31.exe.sha256.json";

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

export async function latestLocalManagerWindowsRelease({ pool = null, env = process.env } = {}) {
  const runtime = resolveRuntimeEnvironment(env);
  const staging = runtime.ok && runtime.environment_key === "staging";
  const channel = staging ? "latest-staging" : "latest-prerelease";
  if (!runtime.ok && runtime.reason !== "runtime_environment_missing") throw Object.assign(new Error("Release environment is unresolved."), {status: 503, code: "local_manager_release_environment_unresolved"});
  const unavailable = () => Object.assign(new Error("No verified Local Manager staging release is registered."), {status:503, code:"local_manager_staging_release_unavailable"});
  const fallback = localManagerFallbackReleaseRow();
  try {
    const [rows] = await (pool || getPool()).query(
      `SELECT * FROM \`local_app_releases\`
        WHERE app_key = 'mad4b-local-manager'
          AND platform = 'windows'
          AND release_channel = ?
          AND status = 'active'
        ORDER BY COALESCE(published_at, updated_at, created_at) DESC, version DESC, release_id DESC
        LIMIT 2`, [channel]
    );
    const [selectedRow = null] = rows;
    if (!selectedRow) {
      if (staging) throw unavailable();
      return {
        ...fallback,
        source: "code_fallback_registry_empty",
        registry_degraded: true,
        registry_reason: "local_app_release_registry_empty",
      };
    }
    const selected = { ...selectedRow, source: "db", registry_degraded: false, registry_reason: null };
    if (staging) {
      if (!/^https:\/\/github\.com\/mad4bdigital-ai\/multi-business-multi-role-growth-intelligence-os\/releases\/download\/local-manager-windows-staging\//u.test(String(selected.artifact_url || "")) || !/^[a-f0-9]{64}$/iu.test(String(selected.sha256 || ""))) throw unavailable();
      return selected;
    }
    const fallbackVersion = normalizeVersion(fallback.version);
    const selectedVersion = normalizeVersion(selected.version);
    if (compareVersions(fallbackVersion, selectedVersion) > 0) {
      return {
        ...fallback,
        source: "code_fallback_newer_than_db",
        registry_degraded: true,
        registry_reason: "local_app_release_registry_stale",
        stale_db_version: selected.version || null,
        stale_db_release_id: selected.release_id || null,
      };
    }
    return selected;
  } catch {
    if (staging) throw unavailable();
    return {
      ...fallback,
      source: "code_fallback_registry_unavailable",
      registry_degraded: true,
      registry_reason: "local_app_release_registry_unavailable",
    };
  }
}

