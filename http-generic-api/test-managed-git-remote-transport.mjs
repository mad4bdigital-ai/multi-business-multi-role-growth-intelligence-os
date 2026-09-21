import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  ManagedGitRemoteTransportError,
  commitManagedGitRemoteChanges,
  prepareManagedGitRemoteTransport,
  pushManagedGitRemoteChanges,
  readManagedGitRemoteTransport,
} from "./managedGitRemoteTransport.js";
import {
  createManagedGitRepositoryCredentialBinding,
  releaseManagedGitRepositoryCredentialBinding,
} from "./managedGitRepositoryCredentialBinding.js";

const execFile = promisify(execFileCallback);
const root = await mkdtemp(join(tmpdir(), "managed-git-t502-test-"));
const seed = join(root, "seed");
const bare = join(root, "remote.git");
const workspace = join(root, "workspace");
const clone2 = join(root, "clone2");
const hostileGitConfig = join(root, "hostile.gitconfig");
const worker = "11111111-1111-4111-8111-111111111111";
const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;

async function git(args, cwd, env = {}) {
  return execFile("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "core.autocrlf",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.safecrlf",
      GIT_CONFIG_VALUE_1: "false",
      GIT_CONFIG_KEY_2: "core.eol",
      GIT_CONFIG_VALUE_2: "lf",
      ...env,
    },
    maxBuffer: 1024 * 1024,
  });
}

try {
  await writeFile(hostileGitConfig, [
    "[core]",
    "\tautocrlf = true",
    "\tsafecrlf = true",
    "\teol = crlf",
    "[credential]",
    "\thelper = hostile-helper",
    "[http \"https://github.com/\"]",
    "\textraheader = Authorization: Basic hostile",
    "",
  ].join("\n"));
  await mkdir(seed);
  await git(["init", "--quiet", "--initial-branch=feature/safe"], seed);
  await writeFile(join(seed, "hello.txt"), "v1\n");
  await git(["add", "--all"], seed);
  await git(["commit", "--quiet", "-m", "seed"], seed, {
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  });
  const initial = String((await git(["rev-parse", "HEAD"], seed)).stdout).trim();
  await git(["clone", "--quiet", "--bare", seed, bare], root);

  await mkdir(workspace);
  await git(["init", "--quiet"], workspace);
  process.env.GIT_CONFIG_GLOBAL = hostileGitConfig;
  const binding = await createManagedGitRepositoryCredentialBinding({
    worker_id: worker,
    owner: "owner",
    repo: "repo",
    connection_id: "22222222-2222-4222-8222-222222222222",
    ttl_seconds: 900,
    resolve_credential: async () => ({
      secret: "super-secret-token",
      credential_source: "test_credential_binding",
      owner_type: "user",
    }),
  });
  const calls = [];
  const authenticatedEnvironments = [];
  const wrappedExec = async (binary, args, options) => {
    assert.equal(args.some((arg) => String(arg).includes("super-secret-token")), false);
    if (args[0] === "push") {
      assert.equal(args.includes("--force"), false);
      assert.equal(args.some((arg) => String(arg).startsWith("--force-with-lease")), false);
    }
    const configEntries = Array.from(
      { length: Number.parseInt(String(options?.env?.GIT_CONFIG_COUNT || "0"), 10) },
      (_, index) => [options.env[`GIT_CONFIG_KEY_${index}`], options.env[`GIT_CONFIG_VALUE_${index}`]],
    );
    const config = new Map(configEntries);
    assert.equal(config.get("core.autocrlf"), "false");
    assert.equal(config.get("core.safecrlf"), "false");
    assert.equal(config.get("core.eol"), "lf");
    if (config.has("http.https://github.com/.extraheader")) {
      assert.equal(config.get("credential.helper"), "");
      assert.match(config.get("http.https://github.com/.extraheader"), /^Authorization: Basic /);
      authenticatedEnvironments.push(options.env);
    }
    calls.push({ args: [...args] });
    return execFile(binary, args, options);
  };
  const session = await prepareManagedGitRemoteTransport({
    worker_id: worker,
    owner: "owner",
    repo: "repo",
    branch: "feature/safe",
    expected_head_sha: initial,
    workspace_path: workspace,
    credential_binding: binding,
    exec_file: wrappedExec,
    remote_url_builder: () => bare,
  });
  assert.equal(await readFile(join(workspace, "hello.txt"), "utf8"), "v1\n");
  assert.equal((await readFile(join(workspace, "hello.txt"))).includes(13), false);
  assert.equal(session.remote_fetch_performed, true);
  assert.equal(session.remote_checkout_performed, true);
  assert.equal(session.credentials_read, true);
  assert.equal("workspace_path" in session, false);
  assert.equal(JSON.stringify(session).includes(workspace), false);
  assert.equal(JSON.stringify(session).includes("super-secret-token"), false);

  await writeFile(join(workspace, "hello.txt"), "v2\n");
  const committed = await commitManagedGitRemoteChanges(session, { message: "feat: update hello" });
  assert.equal(committed.committed, true);
  assert.notEqual(committed.commit_head_sha, initial);
  const pushed = await pushManagedGitRemoteChanges(session, { expected_remote_head_sha: initial });
  assert.equal(pushed.pushed, true);
  assert.equal(pushed.force_push_performed, false);
  assert.equal(pushed.readback_verified, true);
  assert.equal(readManagedGitRemoteTransport(session).remote_push_performed, true);
  const bareHead = String((await git(["rev-parse", "refs/heads/feature/safe"], bare)).stdout).trim();
  assert.equal(bareHead, committed.commit_head_sha);
  const localBlob = String((await git(["show", `${committed.commit_head_sha}:hello.txt`], workspace)).stdout);
  const remoteBlob = String((await git(["show", "refs/heads/feature/safe:hello.txt"], bare)).stdout);
  assert.equal(localBlob, "v2\n");
  assert.equal(remoteBlob, "v2\n");
  assert.equal(Buffer.from(localBlob).includes(13), false);
  assert.equal(Buffer.from(remoteBlob).includes(13), false);

  await git(["clone", "--quiet", bare, clone2], root);
  await git(["checkout", "--quiet", "feature/safe"], clone2);
  await writeFile(join(clone2, "other.txt"), "other\n");
  await git(["add", "--all"], clone2);
  await git(["commit", "--quiet", "-m", "concurrent"], clone2, {
    GIT_AUTHOR_NAME: "Other",
    GIT_AUTHOR_EMAIL: "other@example.invalid",
    GIT_COMMITTER_NAME: "Other",
    GIT_COMMITTER_EMAIL: "other@example.invalid",
  });
  await git(["push", "--quiet", "origin", "HEAD:refs/heads/feature/safe"], clone2);
  await writeFile(join(workspace, "third.txt"), "third\n");
  await commitManagedGitRemoteChanges(session, {
    message: "feat: third",
    expected_parent_sha: committed.commit_head_sha,
  });
  await assert.rejects(
    () => pushManagedGitRemoteChanges(session, { expected_remote_head_sha: committed.commit_head_sha }),
    (error) => error instanceof ManagedGitRemoteTransportError
      && error.code === "MANAGED_GIT_REMOTE_HEAD_MISMATCH"
      && error.status === 409,
  );

  assert.ok(calls.some((call) => call.args[0] === "fetch"));
  assert.ok(calls.some((call) => call.args[0] === "push"));
  assert.equal(calls.some((call) => JSON.stringify(call.args).includes("super-secret-token")), false);
  assert.ok(authenticatedEnvironments.length > 0);
  for (const environment of authenticatedEnvironments) {
    assert.equal(Object.values(environment).some((value) => String(value).startsWith("Authorization: Basic ")), false);
  }
  const released = releaseManagedGitRepositoryCredentialBinding(binding);
  assert.equal(released.credential_zeroized, true);
} finally {
  if (previousGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
  await rm(root, { recursive: true, force: true });
}

console.log("managed Git remote transport tests passed");
