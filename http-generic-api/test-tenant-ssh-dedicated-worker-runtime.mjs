import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync("tenantSshCliExecutionWorker.js", "utf8");
const jobRunner = readFileSync("jobRunner.js", "utf8");
const executionAsync = readFileSync("executionAsync.js", "utf8");
const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/204_sprint66_tenant_ssh_cli_execute_job_result_tool.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const openapi = readFileSync("openapi.yaml", "utf8");

assert(worker.includes('TENANT_SSH_CLI_EXECUTE_JOB_TYPE = "tenant_ssh_cli_allowlisted_execute"'), "worker must export stable SSH execute job type");
assert(worker.includes('loadTenantSshConnection'), "worker must load tenant-scoped SSH connection");
assert(worker.includes('WHERE connection_id = ? AND tenant_id = ? AND user_id = ?'), "worker connection lookup must scope by tenant/user/connection");
assert(worker.includes('loadApprovalRequest'), "worker must reload approval request server-side");
assert(worker.includes('approval.status !== "approved" || approval.hold_status !== "approved"'), "worker must require approved approval and hold");
assert(worker.includes('SSH_CLI_COMMAND_ALLOWLIST'), "worker must use fixed command allowlist");
assert(worker.includes('spawn("ssh", sshArgs, { shell: false'), "worker must spawn ssh without shell");
assert(worker.includes('mkdtemp') && worker.includes('rm(tempDir'), "worker must use and clean a temporary key file");
assert(worker.includes('normalizePrivateKey'), "worker must normalize escaped newline SSH private key payloads before writing the temp key file");
assert(worker.includes('ssh_password'), "worker must support Hostinger password-based SSH credentials");
assert(worker.includes('SSH_ASKPASS'), "worker must use SSH_ASKPASS for password auth without passing secrets on argv");
assert(worker.includes('TENANT_SSH_WORKER_TMP_DIR'), "worker must allow an executable temp directory override for SSH_ASKPASS on noexec /tmp hosts");
assert(worker.includes('path.join(process.cwd(), ".tenant-ssh-worker-tmp")'), "worker must default askpass temp files to app workdir instead of noexec /tmp");
assert(worker.includes('PreferredAuthentications=password,keyboard-interactive'), "worker must restrict password auth mode when password is used");
assert(worker.includes('missing_ssh_authentication_secret'), "worker must reject SSH execution when neither key nor password is present");
assert(worker.includes('.replace(/\\\\r\\\\n/g, "\\n")'), "worker must convert literal escaped CRLF to PEM newlines");
assert(worker.includes('.replace(/\\\\n/g, "\\n")'), "worker must convert literal escaped newlines to PEM newlines");
assert(worker.includes('.replace(/\\\\r/g, "\\n")'), "worker must convert literal escaped CR to PEM newlines");
assert(worker.includes('resolvePublicSshAddress'), "worker must block private/local SSH targets");
assert(worker.includes('capOutput') && worker.includes('redactExecutionOutput'), "worker must cap and redact output");
assert(worker.includes('secrets_included: false'), "worker responses must never include secrets");
assert(!worker.includes('req.body?.command'), "worker must not accept freeform command text");

assert(jobRunner.includes('TENANT_SSH_CLI_EXECUTE_JOB_TYPE'), "jobRunner must import SSH execute job type");
assert(jobRunner.includes('runTenantSshCliExecuteJob'), "jobRunner must call SSH execute worker");
assert(jobRunner.includes('jobType === TENANT_SSH_CLI_EXECUTE_JOB_TYPE'), "jobRunner must branch on SSH execute job type");
assert(executionAsync.includes('requestedJobType === TENANT_SSH_CLI_EXECUTE_JOB_TYPE'), "async submission must allow SSH execute job type");
assert(executionAsync.includes('tenantSshCliExecutePayload'), "async submission must sanitize SSH execute job payload");
assert(executionAsync.includes('secrets_included: false'), "async job payload must declare no secrets");

assert(routes.includes('queued_for_dedicated_worker: true'), "execute route must queue on dedicated worker driver");
assert(routes.includes('executionFacade.submitJob'), "execute route must submit a job instead of executing in request path for dedicated driver");
assert(routes.includes('/me/infrastructure/ssh/connections/:connection_id/cli/execute-jobs/:job_id/result'), "tenant route must expose scoped job result endpoint");
assert(routes.includes('jobRead.body?.target_key !== connectionId'), "job result endpoint must scope job to connection");
assert(routes.includes('jobRead.body?.requested_by !== req.auth.user_id'), "job result endpoint must scope job to requesting user");
assert(routes.includes('tenant_ssh_cli_allowlisted_execute'), "route must identify stable execute source");

assert(migration.includes('tenant_ssh_cli_execute_job_result'), "migration must register execute job result tool");
assert(migration.includes('/me/infrastructure/ssh/connections/{connection_id}/cli/execute-jobs/{job_id}/result'), "migration must use scoped result path");
assert(migration.includes('read_only') && migration.includes('no_secrets'), "result tool must be read-only/no-secrets");
assert(runner.includes('"204_sprint66_tenant_ssh_cli_execute_job_result_tool.sql"'), "governed runner must allow migration 204");
assert(openapi.includes('/me/infrastructure/ssh/connections/{connection_id}/cli/execute-jobs/{job_id}/result'), "OpenAPI must document SSH execute job result endpoint");
assert(openapi.includes('tenantSshCliExecuteJobResult'), "OpenAPI must expose stable operationId for SSH execute job result");

console.log("Tenant SSH dedicated worker runtime guard passed");
