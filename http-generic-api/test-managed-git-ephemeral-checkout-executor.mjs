import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ManagedGitEphemeralCheckoutError,
  createManagedGitEphemeralCheckout,
  getManagedGitEphemeralCheckoutPath,
  listManagedGitEphemeralRootEntries,
  releaseManagedGitEphemeralCheckout,
} from "./managedGitEphemeralCheckoutExecutor.js";

const root = await mkdtemp(join(tmpdir(), "managed-git-t500-test-"));

try {
  const first = await createManagedGitEphemeralCheckout({
    worker_id: "11111111-1111-4111-8111-111111111111",
    root_dir: root,
  });
  const second = await createManagedGitEphemeralCheckout({
    worker_id: "11111111-1111-4111-8111-111111111111",
    root_dir: root,
  });
  const firstPath = getManagedGitEphemeralCheckoutPath(first);
  const secondPath = getManagedGitEphemeralCheckoutPath(second);

  assert.notEqual(firstPath, secondPath);
  assert.equal(first.checkout_strategy, "ephemeral_checkout");
  assert.equal(first.workspace_created, true);
  assert.equal(first.git_repository_initialized, true);
  assert.equal(first.remote_fetch_performed, false);
  assert.equal(first.remote_checkout_performed, false);
  assert.equal(first.credentials_read, false);
  assert.equal(first.workspace_path_exposed, false);
  assert.equal("workspace_path" in first, false);
  assert.ok(!JSON.stringify(first).includes(firstPath));
  assert.equal((await stat(firstPath)).isDirectory(), true);
  assert.equal((await stat(join(firstPath, ".git"))).isDirectory(), true);
  assert.equal((await stat(secondPath)).isDirectory(), true);

  const entriesBeforeRelease = await listManagedGitEphemeralRootEntries(root);
  assert.equal(entriesBeforeRelease.length, 2);

  const released = await releaseManagedGitEphemeralCheckout(first);
  assert.equal(released.workspace_released, true);
  assert.equal(released.cleanup_verified, true);
  await assert.rejects(() => stat(firstPath), (error) => error?.code === "ENOENT");
  assert.equal((await stat(secondPath)).isDirectory(), true);

  await releaseManagedGitEphemeralCheckout(second);
  assert.deepEqual(await listManagedGitEphemeralRootEntries(root), []);

  assert.throws(
    () => getManagedGitEphemeralCheckoutPath({ worker_id: "forged" }),
    (error) => error instanceof ManagedGitEphemeralCheckoutError && error.code === "managed_git_ephemeral_handle_invalid",
  );

  await assert.rejects(
    () => createManagedGitEphemeralCheckout({ worker_id: "../escape", root_dir: root }),
    (error) => error instanceof ManagedGitEphemeralCheckoutError && error.code === "managed_git_ephemeral_worker_id_invalid",
  );

  const failingExec = async () => {
    const error = new Error("synthetic git failure");
    error.code = "SYNTHETIC_FAILURE";
    throw error;
  };
  await assert.rejects(
    () => createManagedGitEphemeralCheckout({
      worker_id: "22222222-2222-4222-8222-222222222222",
      root_dir: root,
      exec_file: failingExec,
    }),
    (error) => error.code === "managed_git_ephemeral_git_init_failed" && error.status === 503,
  );
  assert.deepEqual(await listManagedGitEphemeralRootEntries(root), []);
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("managed Git ephemeral checkout executor tests passed");
