import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scripts = [
  "test-brand-skill-migration-preflight.mjs",
  "scripts/run-test-manifest.mjs",
  "test-managed-git-remote-transport.mjs",
  "test-operation-orchestrator-managed-git-transport.mjs",
  "test-managed-git-remote-transport-input-hardening.mjs",
  "test-dynamic-container-override-governance-smoke.mjs",
  "scripts/run-adaptive-authorization-verification-manifest.mjs",
];

for (const script of scripts) {
  const completed = spawnSync(process.execPath, [script], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });

  if (completed.error) throw completed.error;
  if (completed.status !== 0) process.exit(completed.status ?? 1);
}
