import { promises as fs } from 'node:fs';

const PHASE = String(process.env.ROLLOUT_PHASE || '').trim();
const DIR = String(process.env.EVIDENCE_DIR || `${process.env.RUNNER_TEMP || '/tmp'}/github-repository-policy-1050`).trim();
const originalFetch = globalThis.fetch;
let adminControlFailureCount = 0;

function safeCode(value) {
  const code = String(value || '').trim();
  return /^[A-Za-z0-9_.:-]{1,128}$/.test(code) ? code : null;
}

function requestUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return typeof input?.url === 'string' ? input.url : '';
}

function parseChildErrorCode(payload) {
  const adminError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
  const stdout = typeof adminError?.stdout === 'string' ? adminError.stdout.trim() : '';
  if (!stdout) return { parseable: false, code: null, child_secrets_included: null };
  try {
    const parsed = JSON.parse(stdout);
    return {
      parseable: true,
      code: safeCode(parsed?.error?.code),
      child_secrets_included: parsed?.secrets_included === false ? false : null,
    };
  } catch {
    return { parseable: false, code: null, child_secrets_included: null };
  }
}

async function recordAdminControlFailure(response) {
  if (PHASE !== 'readiness' || response.ok) return;
  try {
    const payload = await response.clone().json();
    const adminError = payload?.error && typeof payload.error === 'object' ? payload.error : null;
    const child = parseChildErrorCode(payload);
    adminControlFailureCount += 1;
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(
      `${DIR}/admin-control-failure-diagnostic-${adminControlFailureCount}.json`,
      `${JSON.stringify({
        contract: 'github_repository_policy_1050_readiness_failure_diagnostic.v1',
        phase: PHASE,
        transport: 'admin_control',
        http_status: Number(response.status || 0) || null,
        admin_error_code: safeCode(adminError?.code),
        exit_code: Number.isInteger(adminError?.exit_code) ? adminError.exit_code : null,
        child_error_json_parseable: child.parseable,
        child_error_code: child.code,
        child_secrets_included: child.child_secrets_included,
        raw_stdout_included: false,
        raw_stderr_included: false,
        error_message_included: false,
        request_body_included: false,
        response_headers_included: false,
        request_headers_included: false,
        request_retried: false,
        secrets_included: false,
      }, null, 2)}\n`,
      'utf8'
    );
  } catch {
    // Diagnostic capture must never alter or retry the governed request.
  }
}

globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init);
  const url = requestUrl(input);
  if (PHASE === 'readiness' && /\/admin\/control(?:$|[?#])/.test(url) && !response.ok) {
    await recordAdminControlFailure(response);
  }
  return response;
};

await import('./github-repository-policy-1050-governed-rollout.mjs');
