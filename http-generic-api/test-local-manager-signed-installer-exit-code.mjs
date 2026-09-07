import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coordinator = readFileSync("../apps/local-manager-windows/SignedInstallerCoordinator.cs", "utf8");
const runbook = readFileSync("../docs/runbooks/local-manager-capability-installer-diagnostics.md", "utf8");

// This guard intentionally remains red until the Windows coordinator preserves the
// exact child exit code. The combined recovery PR must not regress to the current
// boolean-only `installer_exit_nonzero` diagnostic.
assert.match(coordinator, /LastExitCode/u, "Signed installer coordinator must retain the exact child exit code for bounded diagnostics");
assert.match(coordinator, /LastExitCode\s*=\s*process\.ExitCode/u);
assert.match(runbook, /preserve the actual installer exit code/u);

console.log(JSON.stringify({ ok: true, contract: "mad4b.local-manager-signed-installer-exit-code-test.v1", secrets_included: false }));
