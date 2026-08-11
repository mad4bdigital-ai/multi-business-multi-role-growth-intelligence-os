import { closeGovernancePool } from "../governanceDb.js";
import { getPool } from "../db.js";
import { runGovernanceDbPrivilegeReadiness } from "../governanceDbPrivilegeReadinessService.js";

const runtimePool = getPool();

try {
  const result = await runGovernanceDbPrivilegeReadiness({}, { runtimePool });
  const output = JSON.stringify(result);
  if (result.ready === true) {
    console.log(output);
  } else {
    console.error(output);
    process.exitCode = 1;
  }
} finally {
  await Promise.allSettled([
    closeGovernancePool(),
    runtimePool.end(),
  ]);
}
