import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createDeviceFilesEngine } from "./device-files-engine.mjs";

const hash = (s) => createHash("sha256").update(s).digest("hex");
function fixture(write = false) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-device-files-"));
  const root = path.join(base, "project");
  const state = path.join(base, "state");
  fs.mkdirSync(root);
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "index.js"), "const greeting = 'hello';\n");
  fs.writeFileSync(path.join(root, ".env"), "SHOULD_NOT_BE_READ=secret\n");
  const env = {
    CONNECTOR_DEVICE_FILES_ENABLED: "true",
    CONNECTOR_DEVICE_FILE_ROOT: root,
    CONNECTOR_FILE_PATHS: root,
    CONNECTOR_DEVICE_STATE_DIR: state,
    CONNECTOR_DEVICE_FILE_WRITES_ENABLED: write ? "true" : "false",
    CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN: write ? "local-approval-only" : "",
  };
  return { base, root, state, env, engine: createDeviceFilesEngine({ env }),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
test("files engine is disabled by default and requires exact allowlist binding", () => {
  assert.equal(createDeviceFilesEngine().dispatch({ action: "read", relative_path: "src/index.js" }).code, "disabled");
  const f = fixture();
  try {
    assert.equal(f.engine.capabilities.enabled, true);
    assert.equal(createDeviceFilesEngine({ env: { ...f.env, CONNECTOR_FILE_PATHS: f.base } }).capabilities.enabled, false);
    assert.equal(f.engine.capabilities.write_enabled, false);
    assert.equal(f.engine.dispatch({ action: "patch", relative_path: "src/index.js" }).code, "write_denied");
  } finally { f.cleanup(); }
});
test("scoped read, list, info and search use deterministic paged results", () => {
  const f = fixture();
  try {
    const read = f.engine.dispatch({ action: "read", relative_path: "src/index.js" });
    assert.equal(read.sha256, hash("const greeting = 'hello';\n"));
    assert.match(read.content, /hello/);
    const info = f.engine.dispatch({ action: "info", relative_path: "src/index.js" });
    assert.equal(info.content, undefined);
    const list = f.engine.dispatch({ action: "list", relative_path: ".", limit: 1 });
    assert.equal(list.entries[0].name, "src");
    assert.equal(list.next_cursor, null);
    const contents = f.engine.dispatch({ action: "search", relative_path: ".", query: "greeting" });
    assert.equal(contents.matches[0].relative_path, "src/index.js");
    assert.equal(contents.matches[0].line, 1);
    assert.equal(f.engine.dispatch({ action: "read", relative_path: ".env" }).code, "path_denied");
    assert.equal(f.engine.dispatch({ action: "read", relative_path: "../secret.txt" }).code, "path_denied");
    assert.equal(f.engine.dispatch({ action: "read", relative_path: "/etc/passwd" }).code, "path_denied");
  } finally { f.cleanup(); }
});
test("symlinked paths cannot escape the bound root", (t) => {
  const f = fixture();
  const external = path.join(f.base, "outside.js");
  fs.writeFileSync(external, "outside");
  try {
    try { fs.symlinkSync(external, path.join(f.root, "src", "linked.js")); }
    catch (err) { t.diagnostic("symlink creation unavailable: " + err.code); return; }
    assert.equal(f.engine.dispatch({ action: "read", relative_path: "src/linked.js" }).code, "path_denied");
    const matches = f.engine.dispatch({ action: "search", relative_path: "src", query: "outside" });
    assert.deepEqual(matches.matches, []);
  } finally { f.cleanup(); }
});
test("atomic optimistic patch requires explicit write approval and supports rollback", () => {
  const f = fixture(true);
  try {
    const existing = f.engine.dispatch({ action: "read", relative_path: "src/index.js" });
    const request = {
      action: "patch", relative_path: "src/index.js", old_text: "hello", new_text: "world",
      expected_sha256: existing.sha256,
    };
    assert.equal(f.engine.dispatch(request).code, "approval_required");
    assert.equal(f.engine.dispatch({ ...request, approval_token: "local-approval-only", expected_sha256: hash("x") }).code, "digest_mismatch");
    const changed = f.engine.dispatch({ ...request, approval_token: "local-approval-only" });
    assert.equal(changed.ok, true);
    assert.notEqual(changed.after_sha256, changed.before_sha256);
    assert.match(fs.readFileSync(path.join(f.root, "src", "index.js"), "utf8"), /world/);
    assert.equal(f.engine.dispatch({ ...request, approval_token: "local-approval-only" }).code, "digest_mismatch");
    const restored = f.engine.dispatch({ action: "rollback", transaction_id: changed.transaction_id,
      approval_token: "local-approval-only" });
    assert.equal(restored.ok, true);
    assert.equal(restored.restored_sha256, existing.sha256);
    assert.equal(f.engine.dispatch({ action: "rollback", transaction_id: changed.transaction_id,
      approval_token: "local-approval-only" }).code, "rollback_unknown");
  } finally { f.cleanup(); }
});
test("patch rejects ambiguous match and blocks rollback after independent modification", () => {
  const f = fixture(true);
  try {
    const file = path.join(f.root, "src", "index.js");
    fs.writeFileSync(file, "hello hello");
    const unchanged = f.engine.dispatch({ action: "patch", relative_path: "src/index.js",
      old_text: "hello", new_text: "x", expected_sha256: hash("hello hello"),
      approval_token: "local-approval-only" });
    assert.equal(unchanged.code, "patch_not_unique");
    const patched = f.engine.dispatch({ action: "patch", relative_path: "src/index.js",
      old_text: "hello hello", new_text: "updated", expected_sha256: hash("hello hello"),
      approval_token: "local-approval-only" });
    assert.equal(patched.ok, true);
    fs.writeFileSync(file, "edited by another writer");
    assert.equal(f.engine.dispatch({ action: "rollback", transaction_id: patched.transaction_id,
      approval_token: "local-approval-only" }).code, "digest_mismatch");
    assert.equal(fs.readFileSync(file, "utf8"), "edited by another writer");
  } finally { f.cleanup(); }
});


test("bounded multi-file read and stat support desktop workspace previews", () => {
  const f = fixture();
  try {
    const manager = f.engine;
    assert.equal(manager.dispatch({ action: "stat", relative_path: "src" }).type, "directory");
    const read = manager.dispatch({ action: "read_many", paths: ["src/index.js", ".env"] });
    assert.equal(read.ok, true);
    assert.match(read.items[0].content, /hello/);
    assert.equal(read.items[1].code, "path_denied");
    assert.equal(manager.dispatch({ action: "read_many", paths: [] }).code, "invalid_request");
    assert.equal(manager.dispatch({ action: "read_many", paths: Array(9).fill("src/index.js") }).code, "invalid_request");
  } finally { f.cleanup(); }
});
test("exclusive create, copy and same-volume move enforce approval, SHA and no overwrite", () => {
  const f = fixture(true);
  const token = "local-approval-only";
  const go = req => f.engine.dispatch({ ...req, approval_token: token });
  try {
    assert.equal(f.engine.dispatch({ action: "create_directory", relative_path: "public" }).code, "approval_required");
    assert.equal(go({ action: "create_directory", relative_path: "public" }).ok, true);
    assert.equal(go({ action: "create_file", relative_path: "public/a.txt", content: "alpha" }).ok, true);
    assert.equal(go({ action: "create_file", relative_path: "public/a.txt", content: "overwrite" }).ok, false);
    assert.equal(fs.readFileSync(path.join(f.root, "public", "a.txt"), "utf8"), "alpha");
    assert.equal(go({ action: "copy", relative_path: "public/a.txt", target_path: "public/b.txt",
      expected_sha256: hash("other") }).code, "digest_mismatch");
    const copied = go({ action: "copy", relative_path: "public/a.txt", target_path: "public/b.txt",
      expected_sha256: hash("alpha") });
    assert.equal(copied.ok, true);
    assert.equal(copied.rollback_supported, false);
    assert.equal(go({ action: "move", relative_path: "public/a.txt", target_path: "public/b.txt",
      expected_sha256: hash("alpha") }).ok, false);
    const moved = go({ action: "move", relative_path: "public/a.txt", target_path: "public/c.txt",
      expected_sha256: hash("alpha") });
    assert.equal(moved.ok, true);
    assert.equal(fs.existsSync(path.join(f.root, "public", "a.txt")), false);
    assert.equal(fs.readFileSync(path.join(f.root, "public", "c.txt"), "utf8"), "alpha");
    assert.equal(go({ action: "create_file", relative_path: "../outside.txt", content: "not allowed" }).code, "path_denied");
    assert.equal(go({ action: "create_directory", relative_path: ".ssh" }).code, "path_denied");
  } finally { f.cleanup(); }
});

test("a failed or corrupted copy never exposes a partial target", () => {
  const f = fixture(true);
  const source = path.join(f.root, "src", "index.js");
  const target = path.join(f.root, "src", "copied.js");
  const expected_sha256 = hash(fs.readFileSync(source));
  const actualCopy = fs.copyFileSync;
  const copy = () => f.engine.dispatch({ action: "copy", relative_path: "src/index.js",
    target_path: "src/copied.js", expected_sha256, approval_token: "local-approval-only" });
  try {
    fs.copyFileSync = (from, to, flags) => {
      actualCopy(from, to, flags);
      fs.writeFileSync(to, "corrupted");
    };
    assert.equal(copy().code, "digest_mismatch");
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readdirSync(path.dirname(target)).some(x => x.startsWith(".mad4b-copy-")), false);

    fs.copyFileSync = (_from, to) => {
      fs.writeFileSync(to, "partial", { flag: "wx" });
      throw Object.assign(new Error("simulated interrupted copy"), { code: "EIO" });
    };
    assert.equal(copy().code, "io_error");
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readdirSync(path.dirname(target)).some(x => x.startsWith(".mad4b-copy-")), false);
  } finally {
    fs.copyFileSync = actualCopy;
    f.cleanup();
  }
});

test("state directory cannot resolve inside the approved project via ancestor junction", t => {
  const f = fixture(true);
  try {
    const exposed = path.join(f.root, "exposed");
    fs.mkdirSync(exposed);
    const alias = path.join(f.base, "alias");
    try { fs.symlinkSync(f.root, alias, "junction"); }
    catch (error) { t.diagnostic("directory junction unavailable: " + error.code); return; }
    const engine = createDeviceFilesEngine({ env: {
      ...f.env, CONNECTOR_DEVICE_STATE_DIR: path.join(alias, "exposed"),
    } });
    assert.equal(engine.capabilities.state_available, false);
    assert.equal(engine.capabilities.write_enabled, false);
  } finally { f.cleanup(); }
});

test("same-content source replacement during move cannot unlink the replacement", () => {
  const f = fixture(true);
  const from = path.join(f.root, "src", "index.js");
  const to = path.join(f.root, "src", "moved.js");
  const saved = path.join(f.root, "src", "original.txt");
  const originalLink = fs.linkSync;
  const body = fs.readFileSync(from);
  try {
    fs.linkSync = (source, target) => {
      originalLink(source, target);
      fs.renameSync(source, saved);
      fs.writeFileSync(source, body);
    };
    const result = f.engine.dispatch({ action: "move",
      relative_path: "src/index.js", target_path: "src/moved.js",
      expected_sha256: hash(body), approval_token: "local-approval-only" });
    assert.equal(result.code, "digest_mismatch");
    assert.equal(fs.readFileSync(from).toString(), body.toString());
    assert.equal(fs.existsSync(to), false);
    assert.equal(fs.readFileSync(saved).toString(), body.toString());
  } finally { fs.linkSync = originalLink; f.cleanup(); }
});

test("late symlink substitution cannot disclose a path outside the allowed root", t => {
  const f = fixture();
  const protectedPath = path.join(f.root, "src", "index.js");
  const parked = path.join(f.root, "src", "original-parked.js");
  const outside = path.join(f.base, "outside.js");
  fs.writeFileSync(outside, "outside-private-content");
  try {
    const probe = path.join(f.base, "link-probe");
    try { fs.symlinkSync(outside, probe, "file"); fs.rmSync(probe); }
    catch (error) { t.diagnostic("symlinks unavailable: " + error.code); return; }
    const actualOpen = fs.openSync;
    let swapped = false;
    try {
      fs.openSync = (file, flags, mode) => {
        if (!swapped && file === protectedPath) {
          swapped = true;
          fs.renameSync(protectedPath, parked);
          fs.symlinkSync(outside, protectedPath, "file");
        }
        return actualOpen(file, flags, mode);
      };
      const result = f.engine.dispatch({ action: "read", relative_path: "src/index.js" });
      assert.equal(swapped, true);
      assert.equal(result.ok, false);
      assert.equal(JSON.stringify(result).includes("outside-private-content"), false);
    } finally { fs.openSync = actualOpen; }
  } finally { f.cleanup(); }
});

test("failed patch preparation does not retain a false rollback receipt", () => {
  const f = fixture(true);
  const file = path.join(f.root, "src", "index.js");
  const actualRename = fs.renameSync;
  try {
    const content = fs.readFileSync(file, "utf8");
    fs.renameSync = (from, to) => {
      if (to === file) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
      return actualRename(from, to);
    };
    const result = f.engine.dispatch({
      action: "patch", relative_path: "src/index.js",
      old_text: content.slice(0, 4), new_text: "new",
      expected_sha256: hash(content), approval_token: "local-approval-only",
    });
    assert.equal(result.ok, false);
    assert.equal(fs.readdirSync(f.state).filter(name => name.endsWith(".backup") || name.endsWith(".json")).length, 0);
    assert.equal(fs.readFileSync(file, "utf8"), content);
  } finally { fs.renameSync = actualRename; f.cleanup(); }
});
