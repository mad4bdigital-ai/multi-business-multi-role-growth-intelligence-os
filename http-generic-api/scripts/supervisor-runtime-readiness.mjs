import { runSupervisorRuntimeReadiness } from "../supervisorRuntimeReadiness.js";

const live = process.argv.includes("--live");

try {
  const result = await runSupervisorRuntimeReadiness({ live });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    execution_ready: false,
    mode: live ? "static_and_live_schema_readonly" : "static",
    error: { code: error.code || "supervisor_readiness_failed", message: error.message },
    secrets_included: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
