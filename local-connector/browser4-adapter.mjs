import path from 'node:path';

const DEFAULT_CHECKS = ['snapshot'];
const ALLOWED_CHECKS = new Set([
  'snapshot',
  'screenshot',
  'console',
  'network',
  'dom_snapshot',
  'seo_metadata',
]);

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, '');
}

function hostAllowed(host, allowlist = []) {
  const normalizedHost = normalizeHost(host);
  return allowlist.some((entry) => {
    const allowed = normalizeHost(entry);
    return allowed && (normalizedHost === allowed || normalizedHost.endsWith(`.${allowed}`));
  });
}

export function parseBrowser4AllowedHosts(value) {
  if (Array.isArray(value)) return value.map(normalizeHost).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(normalizeHost)
    .filter(Boolean);
}

export function validateBrowser4Url(rawUrl, allowedHosts = []) {
  let parsed;
  try { parsed = new URL(String(rawUrl || '').trim()); } catch {
    const err = new Error('url must be an absolute http or https URL');
    err.code = 'browser4_invalid_url';
    err.status = 400;
    throw err;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    const err = new Error('url must use http or https');
    err.code = 'browser4_url_scheme_blocked';
    err.status = 400;
    throw err;
  }
  const allowlist = parseBrowser4AllowedHosts(allowedHosts);
  if (allowlist.length && !hostAllowed(parsed.hostname, allowlist)) {
    const err = new Error('url host is not in the Browser4 connector allowlist');
    err.code = 'browser4_domain_not_allowlisted';
    err.status = 403;
    err.details = { host: parsed.hostname, allowed_hosts: allowlist };
    throw err;
  }
  return { url: parsed.toString(), host: parsed.hostname.toLowerCase() };
}

export function sanitizeBrowser4Checks(checks = DEFAULT_CHECKS) {
  const requested = Array.isArray(checks) && checks.length ? checks : DEFAULT_CHECKS;
  const sanitized = [];
  for (const check of requested) {
    const normalized = String(check || '').trim().toLowerCase();
    if (!normalized) continue;
    if (!ALLOWED_CHECKS.has(normalized)) {
      const err = new Error(`unsupported Browser4 check '${normalized}'`);
      err.code = 'browser4_check_not_allowed';
      err.status = 400;
      err.details = { allowed_checks: [...ALLOWED_CHECKS] };
      throw err;
    }
    if (!sanitized.includes(normalized)) sanitized.push(normalized);
  }
  return sanitized.length ? sanitized : DEFAULT_CHECKS;
}

function psString(value) {
  return JSON.stringify(String(value ?? ''));
}

function safeRunKey(value) {
  return String(value || `browser4_${Date.now()}`)
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .slice(0, 120) || `browser4_${Date.now()}`;
}

function normalizeWindowsPath(value) {
  return String(value || '').replace(/\\/g, '\\\\');
}

export function buildBrowser4InspectionScript({
  url,
  checks = DEFAULT_CHECKS,
  runKey,
  workDir,
  javaHome = '',
  serverUrl = 'http://localhost:8182',
} = {}) {
  const normalizedChecks = sanitizeBrowser4Checks(checks);
  const key = safeRunKey(runKey);
  const safeWorkDir = normalizeWindowsPath(workDir || path.join(process.cwd(), 'browser4-artifacts'));
  const safeJavaHome = normalizeWindowsPath(javaHome || '');
  const safeServerUrl = String(serverUrl || 'http://localhost:8182');
  const wantsSnapshot = normalizedChecks.includes('snapshot') || normalizedChecks.includes('dom_snapshot');
  const wantsScreenshot = normalizedChecks.includes('screenshot');

  const lines = [
    "$ErrorActionPreference = 'Continue'",
    `$work = ${psString(safeWorkDir)}`,
    `New-Item -ItemType Directory -Force -Path $work | Out-Null`,
    `Set-Location $work`,
    `$runKey = ${psString(key)}`,
    `$targetUrl = ${psString(url)}`,
    `$serverUrl = ${psString(safeServerUrl)}`,
    `$statusFile = Join-Path $work ($runKey + '.status.json')`,
    `$outFile = Join-Path $work ($runKey + '.out.txt')`,
    `$errFile = Join-Path $work ($runKey + '.err.txt')`,
    `$snapshotFile = Join-Path $work ($runKey + '.snapshot.txt')`,
    `$screenshotFile = Join-Path $work ($runKey + '.screenshot.txt')`,
    `@{ status='running'; started_at=(Get-Date).ToString('o'); target_host=([System.Uri]$targetUrl).Host; secrets_included=$false } | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8`,
  ];

  if (safeJavaHome) {
    lines.push(`$env:JAVA_HOME = ${psString(safeJavaHome)}`);
    lines.push(`$env:PATH = (Join-Path ${psString(safeJavaHome)} 'bin') + ';' + $env:PATH`);
  }

  lines.push(
    `"## browser4 open" | Out-File $outFile -Encoding UTF8`,
    `& npx -y browser4-cli open --server $serverUrl 1>> $outFile 2>> $errFile`,
    `$openExit = $LASTEXITCODE`,
    `@{ status='running'; step='goto'; open_exit=$openExit; updated_at=(Get-Date).ToString('o'); secrets_included=$false } | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8`,
    '"`n## browser4 goto" | Out-File $outFile -Append -Encoding UTF8',
    `& npx -y browser4-cli goto $targetUrl 1>> $outFile 2>> $errFile`,
    `$gotoExit = $LASTEXITCODE`,
  );

  if (wantsSnapshot) {
    lines.push(
      `@{ status='running'; step='snapshot'; open_exit=$openExit; goto_exit=$gotoExit; updated_at=(Get-Date).ToString('o'); secrets_included=$false } | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8`,
      `"`n## browser4 snapshot" | Out-File $outFile -Append -Encoding UTF8`,
      `& npx -y browser4-cli snapshot 1> $snapshotFile 2>> $errFile`,
      `$snapshotExit = $LASTEXITCODE`,
    );
  } else {
    lines.push(`$snapshotExit = 0`);
  }

  if (wantsScreenshot) {
    lines.push(
      `@{ status='running'; step='screenshot'; open_exit=$openExit; goto_exit=$gotoExit; snapshot_exit=$snapshotExit; updated_at=(Get-Date).ToString('o'); secrets_included=$false } | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8`,
      `"`n## browser4 screenshot" | Out-File $outFile -Append -Encoding UTF8`,
      `& npx -y browser4-cli screenshot 1> $screenshotFile 2>> $errFile`,
      `$screenshotExit = $LASTEXITCODE`,
    );
  } else {
    lines.push(`$screenshotExit = 0`);
  }

  lines.push(
    `$exitCode = @($openExit, $gotoExit, $snapshotExit, $screenshotExit) | Where-Object { $_ -ne 0 } | Select-Object -First 1`,
    `if ($null -eq $exitCode) { $exitCode = 0 }`,
    `@{ status='completed'; completed_at=(Get-Date).ToString('o'); exit_code=$exitCode; open_exit=$openExit; goto_exit=$gotoExit; snapshot_exit=$snapshotExit; screenshot_exit=$screenshotExit; stdout_path=$outFile; stderr_path=$errFile; snapshot_path=$snapshotFile; screenshot_path=$screenshotFile; secrets_included=$false } | ConvertTo-Json -Compress | Set-Content $statusFile -Encoding UTF8`,
    `exit $exitCode`,
  );

  return {
    script: lines.join('\n'),
    run_key: key,
    checks: normalizedChecks,
    artifacts: {
      status_path: path.join(safeWorkDir, `${key}.status.json`),
      stdout_path: path.join(safeWorkDir, `${key}.out.txt`),
      stderr_path: path.join(safeWorkDir, `${key}.err.txt`),
      snapshot_path: path.join(safeWorkDir, `${key}.snapshot.txt`),
      screenshot_path: path.join(safeWorkDir, `${key}.screenshot.txt`),
    },
    secrets_included: false,
  };
}

export const _testingBrowser4Adapter = { ALLOWED_CHECKS, hostAllowed, safeRunKey };
