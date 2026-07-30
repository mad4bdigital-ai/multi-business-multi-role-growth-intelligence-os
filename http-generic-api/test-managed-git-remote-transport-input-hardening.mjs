import assert from "node:assert/strict";
import {
  ManagedGitRemoteTransportError,
  prepareManagedGitRemoteTransport,
} from "./managedGitRemoteTransport.js";

const base = {
  worker_id: "11111111-1111-4111-8111-111111111111",
  owner: "owner",
  repo: "repo",
  branch: "feature/safe",
  expected_head_sha: "a".repeat(40),
  workspace_path: "/tmp/managed-git-worker",
  credential_binding: Object.freeze({ credential_binding_id: "binding-1" }),
};

await assert.rejects(
  () => prepareManagedGitRemoteTransport({ ...base, branch: "-upload-pack=malicious" }),
  (error) => error instanceof ManagedGitRemoteTransportError
    && error.code === "MANAGED_GIT_REMOTE_BRANCH_INVALID"
    && error.status === 400,
);

await assert.rejects(
  () => prepareManagedGitRemoteTransport({ ...base, workspace_path: "relative/workspace" }),
  (error) => error instanceof ManagedGitRemoteTransportError
    && error.code === "MANAGED_GIT_REMOTE_WORKSPACE_INVALID"
    && error.status === 500,
);

console.log("managed Git remote transport input hardening tests passed");
