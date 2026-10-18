// Scoped Device Files Engine. No arbitrary filesystem access or shell execution.
// Mounted by the Local Connector only after device authentication and explicit opt-in.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_BYTES = 256 * 1024;
const MAX_VISITS = 1500;
const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json", ".md",
  ".txt", ".yaml", ".yml", ".html", ".css", ".scss", ".php",
  ".py", ".ps1", ".sh", ".xml", ".sql", ".csv", ".go", ".rs",
]);
const DENIED_SEGMENTS = new Set([
  ".git", ".ssh", ".gnupg", "node_modules", ".next", ".venv",
  ".env", ".aws", ".azure", ".kube", ".npmrc", ".pypirc",
]);
const ERRORS = Object.freeze({
  disabled: 403, invalid_path: 400, path_denied: 403, path_not_found: 404,
  invalid_action: 400, invalid_request: 400, invalid_content: 400, file_too_large: 413,
  not_text_file: 400, not_directory: 400, not_file: 400, digest_required: 400,
  digest_mismatch: 409, patch_not_unique: 409, write_denied: 403,
  approval_required: 403, backup_unavailable: 409, rollback_unknown: 404,
  state_not_configured: 403, path_exists: 409, io_error: 500,
});
function failure(code) {
  return { ok: false, code, http_status: ERRORS[code] || 400, secrets_included: false };
}
function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
function rootConfig(env) {
  const request = String(env.CONNECTOR_DEVICE_FILE_ROOT || "").trim();
  if (!path.isAbsolute(request) || request === path.parse(request).root) return null;
  let configured;
  try {
    configured = JSON.parse(env.CONNECTOR_FILE_PATHS || "[]");
  } catch {
    configured = String(env.CONNECTOR_FILE_PATHS || "").split(",");
  }
  if (!Array.isArray(configured)) return null;
  try {
    const canonical = fs.realpathSync(request);
    if (!fs.statSync(canonical).isDirectory()) return null;
    const permitted = configured.filter(Boolean).some((r) => {
      try { return fs.realpathSync(String(r).trim()) === canonical; }
      catch { return false; }
    });
    return permitted ? canonical : null;
  } catch { return null; }
}
function cleanRelative(value) {
  if (typeof value !== "string" || value.length > 512 || value.includes("\0") ||
      value.includes("\\") || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return null;
  if (value === "." || value === "") return ".";
  const parts = value.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || DENIED_SEGMENTS.has(p.toLowerCase()) ||
      p.toLowerCase().startsWith(".env.") || p.includes(":"))) return null;
  return parts.join("/");
}
function resolve(root, relative, { mustExist = true } = {}) {
  const clean = cleanRelative(relative);
  if (clean === null || !root) return null;
  let current = root;
  const parts = clean === "." ? [] : clean.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink()) return null;
      if (i < parts.length - 1 && !st.isDirectory()) return null;
    } catch (e) {
      if (e.code !== "ENOENT" || mustExist || i !== parts.length - 1) return null;
    }
  }
  if (mustExist) {
    try {
      if (!fs.realpathSync(current).startsWith(root + path.sep) && current !== root) return null;
    } catch { return null; }
  }
  return current;
}
function isText(relative) {
  return TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase());
}
function getStateDirectory(env, root) {
  const value = String(env.CONNECTOR_DEVICE_STATE_DIR || "").trim();
  if (!path.isAbsolute(value) || value === path.parse(value).root) return null;
  const absolute = path.resolve(value);
  if (absolute === root || absolute.startsWith(root + path.sep)) return null;
  try {
    if (!fs.lstatSync(absolute).isDirectory() || fs.lstatSync(absolute).isSymbolicLink()) return null;
    // Canonical validation closes ancestor-symlink paths into the project.
    // Backup state must never be readable through Device Files.
    const canonical = fs.realpathSync(absolute);
    if (canonical === root || canonical.startsWith(root + path.sep)) return null;
    return canonical;
  } catch { return null; }
}
function sameSecret(supplied, expected) {
  if (!supplied || !expected) return false;
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createDeviceFilesEngine({ env = process.env } = {}) {
  const root = rootConfig(env);
  const enabled = env.CONNECTOR_DEVICE_FILES_ENABLED === "true" && Boolean(root);
  const stateDir = root ? getStateDirectory(env, root) : null;
  const writes = enabled && env.CONNECTOR_DEVICE_FILE_WRITES_ENABLED === "true" &&
    Boolean(stateDir) && Boolean(env.CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN);
  const capabilities = {
    enabled, read_enabled: enabled, write_enabled: writes, root_bound: Boolean(root),
    state_available: Boolean(stateDir), max_file_bytes: MAX_FILE_BYTES,
    max_search_files: MAX_VISITS, atomic_patch: true, rollback: true,
    root: root || null, arbitrary_shell_allowed: false, secrets_included: false,
  };

  function requireWrite(input) {
    if (!writes) return failure("write_denied");
    if (!sameSecret(input.approval_token, env.CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN))
      return failure("approval_required");
    return null;
  }
  function readFile(relative) {
    const absolute = resolve(root, relative);
    if (!absolute) return failure("path_denied");
    const st = fs.statSync(absolute);
    if (!st.isFile()) return failure("not_file");
    if (!isText(relative)) return failure("not_text_file");
    if (st.size > MAX_FILE_BYTES) return failure("file_too_large");
    const bytes = fs.readFileSync(absolute);
    return { ok: true, http_status: 200, relative_path: relative,
      content: bytes.toString("utf8"), sha256: digest(bytes), size: bytes.length,
      secrets_included: false };
  }

  function statPath(relative) {
    const absolute = resolve(root, relative);
    if (!absolute) return failure("path_denied");
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) return failure("path_denied");
    if (!stat.isFile() && !stat.isDirectory()) return failure("path_denied");
    if (stat.isFile() && !isText(relative)) return failure("not_text_file");
    if (stat.isFile() && stat.size > MAX_FILE_BYTES) return failure("file_too_large");
    const result = { ok: true, http_status: 200, relative_path: relative,
      type: stat.isDirectory() ? "directory" : "file", size: stat.size,
      created_at: stat.birthtime.toISOString(), modified_at: stat.mtime.toISOString(),
      secrets_included: false };
    if (stat.isFile()) result.sha256 = digest(fs.readFileSync(absolute));
    return result;
  }
  function readMultiple(input) {
    if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > 8 ||
        input.paths.some(p => typeof p !== "string")) return failure("invalid_request");
    const results = [];
    let total = 0;
    for (const relative of input.paths) {
      const item = readFile(relative);
      if (item.ok) {
        total += item.size;
        if (total > MAX_FILE_BYTES) return failure("file_too_large");
      }
      results.push(item);
    }
    return { ok: true, http_status: 200, items: results, secrets_included: false };
  }
  function destination(relative, directory = false) {
    if (typeof relative !== "string" || relative === ".") return null;
    const absolute = resolve(root, relative, { mustExist: false });
    if (!absolute || fs.existsSync(absolute)) return null;
    if (!directory && !isText(relative)) return null;
    const parent = path.dirname(absolute);
    try {
      if (!fs.statSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink())
        return null;
    } catch { return null; }
    return absolute;
  }
  function createDirectory(input) {
    const denied = requireWrite(input);
    if (denied) return denied;
    const absolute = destination(input.relative_path, true);
    if (!absolute) return failure("path_denied");
    fs.mkdirSync(absolute, { recursive: false, mode: 0o700 });
    return { ok: true, http_status: 200, relative_path: input.relative_path,
      created: true, rollback_supported: false, secrets_included: false };
  }
  function createFile(input) {
    const denied = requireWrite(input);
    if (denied) return denied;
    if (typeof input.content !== "string" ||
        Buffer.byteLength(input.content) > MAX_FILE_BYTES) return failure("invalid_content");
    const absolute = destination(input.relative_path);
    if (!absolute) return failure("path_denied");
    fs.writeFileSync(absolute, input.content, { flag: "wx", mode: 0o600 });
    return { ok: true, http_status: 200, relative_path: input.relative_path,
      sha256: digest(Buffer.from(input.content)), bytes_written: Buffer.byteLength(input.content),
      rollback_supported: false, secrets_included: false };
  }
  function copyOrMove(input, move) {
    const denied = requireWrite(input);
    if (denied) return denied;
    const from = input.relative_path;
    const to = input.target_path;
    const source = resolve(root, from);
    const target = destination(to);
    if (!source || !target || !isText(from) || !isText(to)) return failure("path_denied");
    if (!/^[a-f0-9]{64}$/i.test(input.expected_sha256 || "")) return failure("digest_required");
    if (!fs.statSync(source).isFile()) return failure("not_file");
    if (fs.statSync(source).size > MAX_FILE_BYTES) return failure("file_too_large");
    const before = fs.readFileSync(source);
    if (before.length > MAX_FILE_BYTES) return failure("file_too_large");
    const expected = digest(before);
    if (expected !== input.expected_sha256.toLowerCase()) return failure("digest_mismatch");
    if (move) {
      // Hard link creation is exclusive. Source stays intact on a failed link.
      // Same-volume restriction avoids silent cross-volume partial moves.
      fs.linkSync(source, target);
      try {
        if (fs.statSync(source).size > MAX_FILE_BYTES ||
            fs.statSync(target).size > MAX_FILE_BYTES ||
            digest(fs.readFileSync(target)) !== expected ||
            digest(fs.readFileSync(source)) !== expected) return failure("digest_mismatch");
        fs.unlinkSync(source);
      } finally {
        // A failed rename may have created a temporary second hard link.
        // Remove that second link only while the source still exists, so
        // successful moves never lose the destination.
        if (fs.existsSync(source)) {
          try {
            const a = fs.statSync(source), b = fs.statSync(target);
            if (a.ino === b.ino && a.dev === b.dev) fs.unlinkSync(target);
          } catch { /* no data-loss cleanup fallback */ }
        }
      }
    } else {
      // Verify an unpublished temporary file first, then hard-link it into
      // the destination exclusively. A corrupt/interrupted copy is never visible.
      const temporary = path.join(path.dirname(target), ".mad4b-copy-" + randomUUID() + ".tmp");
      try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        if (fs.statSync(temporary).size > MAX_FILE_BYTES ||
            digest(fs.readFileSync(temporary)) !== expected ||
            digest(fs.readFileSync(source)) !== expected) return failure("digest_mismatch");
        fs.linkSync(temporary, target);
      } finally {
        try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
      }
    }
    return { ok: true, http_status: 200, operation: move ? "move" : "copy",
      source_path: from, target_path: to, sha256: expected,
      rollback_supported: false, secrets_included: false };
  }

  function list(relative, input) {
    const absolute = resolve(root, relative);
    if (!absolute) return failure("path_denied");
    if (!fs.statSync(absolute).isDirectory()) return failure("not_directory");
    const pageSize = Math.min(100, Math.max(1, Number(input.limit) || 50));
    const offset = Number(input.cursor || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return failure("invalid_request");
    const entries = fs.readdirSync(absolute, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink() && cleanRelative(
        relative === "." ? entry.name : relative + "/" + entry.name) !== null)
      .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "dir" : "file" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const page = entries.slice(offset, offset + pageSize);
    return { ok: true, http_status: 200, entries: page, next_cursor:
      offset + pageSize < entries.length ? offset + pageSize : null,
      scanned: entries.length, secrets_included: false };
  }
  function search(input) {
    const needle = String(input.query || "");
    if (!needle || needle.length > 120) return failure("invalid_request");
    const relative = input.relative_path || ".";
    const base = resolve(root, relative);
    if (!base || !fs.statSync(base).isDirectory()) return failure("path_denied");
    const mode = input.mode === "filename" ? "filename" : "content";
    const maxResults = Math.min(100, Math.max(1, Number(input.limit) || 50));
    const offset = Number(input.cursor || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return failure("invalid_request");
    const queue = [{ absolute: base, relative }];
    const found = [];
    let scanned = 0;
    while (queue.length && scanned < MAX_VISITS && found.length < offset + maxResults + 1) {
      const dir = queue.shift();
      const items = fs.readdirSync(dir.absolute, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
      for (const item of items) {
        if (scanned++ >= MAX_VISITS) break;
        const rel = dir.relative === "." ? item.name : dir.relative + "/" + item.name;
        if (cleanRelative(rel) === null || item.isSymbolicLink()) continue;
        const abs = resolve(root, rel);
        if (!abs) continue;
        if (item.isDirectory()) { queue.push({ absolute: abs, relative: rel }); continue; }
        if (!item.isFile() || !isText(rel)) continue;
        if (mode === "filename") {
          if (item.name.toLowerCase().includes(needle.toLowerCase())) found.push({ relative_path: rel });
          continue;
        }
        const size = fs.statSync(abs).size;
        if (size > MAX_SEARCH_BYTES) continue;
        const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
        const line = lines.findIndex((s) => s.toLowerCase().includes(needle.toLowerCase()));
        if (line !== -1) found.push({ relative_path: rel, line: line + 1 });
      }
    }
    return { ok: true, http_status: 200, matches: found.slice(offset, offset + maxResults),
      next_cursor: found.length > offset + maxResults ? offset + maxResults : null,
      scan_limited: scanned >= MAX_VISITS, scanned, secrets_included: false };
  }
  function patch(input) {
    const denied = requireWrite(input);
    if (denied) return denied;
    const relative = input.relative_path;
    const absolute = resolve(root, relative);
    if (!absolute || !isText(relative)) return failure("path_denied");
    if (!fs.statSync(absolute).isFile()) return failure("not_file");
    if (!/^[a-f0-9]{64}$/i.test(input.expected_sha256 || "")) return failure("digest_required");
    if (typeof input.old_text !== "string" || !input.old_text ||
      typeof input.new_text !== "string") return failure("invalid_content");
    if (fs.statSync(absolute).size > MAX_FILE_BYTES) return failure("file_too_large");
    const before = fs.readFileSync(absolute);
    if (before.length > MAX_FILE_BYTES) return failure("file_too_large");
    if (digest(before) !== input.expected_sha256.toLowerCase()) return failure("digest_mismatch");
    const original = before.toString("utf8");
    const first = original.indexOf(input.old_text);
    if (first === -1 || original.indexOf(input.old_text, first + input.old_text.length) !== -1)
      return failure("patch_not_unique");
    const updated = Buffer.from(original.slice(0, first) + input.new_text +
      original.slice(first + input.old_text.length), "utf8");
    if (updated.length > MAX_FILE_BYTES) return failure("file_too_large");
    const transaction = randomUUID();
    const backup = path.join(stateDir, transaction + ".backup");
    const meta = path.join(stateDir, transaction + ".json");
    const temp = path.join(path.dirname(absolute), ".mad4b-" + transaction + ".tmp");
    try {
      fs.writeFileSync(backup, before, { flag: "wx", mode: 0o600 });
      fs.writeFileSync(meta, JSON.stringify({ relative_path: relative, before: digest(before),
        after: digest(updated), created_at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      fs.writeFileSync(temp, updated, { flag: "wx", mode: 0o600 });
      if (!resolve(root, relative) || digest(fs.readFileSync(absolute)) !== digest(before))
        return failure("digest_mismatch");
      fs.chmodSync(temp, fs.statSync(absolute).mode & 0o777);
      fs.renameSync(temp, absolute);
      return { ok: true, http_status: 200, transaction_id: transaction,
        before_sha256: digest(before), after_sha256: digest(updated), secrets_included: false };
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    }
  }
  function rollback(input) {
    const denied = requireWrite(input);
    if (denied) return denied;
    const id = String(input.transaction_id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id)) return failure("rollback_unknown");
    const metaPath = path.join(stateDir, id + ".json");
    const backupPath = path.join(stateDir, id + ".backup");
    if (!fs.existsSync(metaPath) || !fs.existsSync(backupPath)) return failure("rollback_unknown");
    if (fs.lstatSync(metaPath).isSymbolicLink() || fs.lstatSync(backupPath).isSymbolicLink())
      return failure("backup_unavailable");
    const record = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const absolute = resolve(root, record.relative_path);
    if (!absolute || !isText(record.relative_path)) return failure("path_denied");
    if (fs.statSync(backupPath).size > MAX_FILE_BYTES) return failure("backup_unavailable");
    const before = fs.readFileSync(backupPath);
    if (digest(before) !== record.before) return failure("backup_unavailable");
    const current = fs.readFileSync(absolute);
    if (digest(current) !== record.after) return failure("digest_mismatch");
    const temp = path.join(path.dirname(absolute), ".mad4b-" + randomUUID() + ".tmp");
    try {
      fs.writeFileSync(temp, before, { flag: "wx", mode: 0o600 });
      if (digest(fs.readFileSync(absolute)) !== record.after) return failure("digest_mismatch");
      fs.chmodSync(temp, fs.statSync(absolute).mode & 0o777);
      fs.renameSync(temp, absolute);
      fs.rmSync(metaPath, { force: true });
      fs.rmSync(backupPath, { force: true });
      return { ok: true, http_status: 200, restored_sha256: record.before,
        transaction_id: id, secrets_included: false };
    } finally {
      try { fs.rmSync(temp, { force: true }); } catch { /* best effort */ }
    }
  }
  function dispatch(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return failure("invalid_request");
    if (input.action === "capabilities") return { ok: true, http_status: 200, ...capabilities };
    if (!enabled) return failure("disabled");
    try {
      if (input.action === "list") return list(input.relative_path || ".", input);
      if (input.action === "stat") return statPath(input.relative_path || ".");
      if (input.action === "read_many") return readMultiple(input);
      if (input.action === "create_directory") return createDirectory(input);
      if (input.action === "create_file") return createFile(input);
      if (input.action === "copy") return copyOrMove(input, false);
      if (input.action === "move") return copyOrMove(input, true);
      if (input.action === "read" || input.action === "info") {
        const result = readFile(input.relative_path);
        if (input.action === "info" && result.ok) delete result.content;
        return result;
      }
      if (input.action === "search") return search(input);
      if (input.action === "patch") return patch(input);
      if (input.action === "rollback") return rollback(input);
      return failure("invalid_action");
    } catch (error) {
      if (error.code === "ENOENT") return failure("path_not_found");
      return failure("io_error");
    }
  }
  return { dispatch, capabilities };
}
