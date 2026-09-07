import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coordinator = readFileSync("../apps/local-manager-windows/SignedInstallerCoordinator.cs", "utf8");
const runbook = readFileSync("../docs/runbooks/local-manager-capability-installer-diagnostics.md", "utf8");

assert.match(coordinator, /internal int\? LastExitCode \{ get; private set; \}/u, "Signed installer coordinator must retain the exact child exit code for bounded diagnostics");
assert.match(coordinator, /LastExitCode\s*=\s*process\.ExitCode/u);
assert.match(coordinator, /if \(process\.ExitCode != 0\)[\s\S]*throw new SignedInstallerExitCodeException\(process\.ExitCode\)/u);
assert.match(coordinator, /Signed connector installer exited with code \{exitCode\}\./u);
assert.doesNotMatch(coordinator, /if \(process\.ExitCode != 0\)\s*return SignedInstallerRunResult\.Failed/u, "Non-zero child exits must not collapse into a boolean-only failure enum");
assert.match(runbook, /preserve the actual installer exit code/u);
assert.match(runbook, /run post-install runtime verification only after a zero child exit/u);

console.log(JSON.stringify({ ok: true, contract: "mad4b.local-manager-signed-installer-exit-code-test.v1", exact_exit_code_preserved: true, secrets_included: false }));
