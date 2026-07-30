import { testCommands as spec011Commands } from "./manifests/test-manifest-spec011.mjs";

const upstreamCommands = [
  "node test-managed-git-ephemeral-checkout-executor.mjs",
  "node scripts/test-managed-git-worker-lifecycle.mjs",
  "node test-operation-orchestrator-managed-workspace-dependency.mjs",
  "node test-managed-git-repository-credential-binding.mjs",
  "node test-operation-orchestrator-repository-credential.mjs",
];

export const testCommands = Object.freeze([
  ...new Set([...spec011Commands, ...upstreamCommands]),
]);
