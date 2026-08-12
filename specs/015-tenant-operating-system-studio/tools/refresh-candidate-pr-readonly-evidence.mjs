import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPOSITORY = 'mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os';
const CANDIDATE_PRS = [3922, 4432, 4386, 2385, 2284, 2949, 3139, 3145, 3159];
const OUTPUT = path.resolve(
  process.cwd(),
  'docs/spec-portfolio/spec015-candidate-pr-readonly-evidence-20260812.jsonl',
);

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    env: {
      ...process.env,
      GH_FORCE_TTY: '0',
      NO_COLOR: '1',
      TERM: 'dumb',
    },
  }).trim();
}

function readCurrentMainSha() {
  return run('git', ['rev-parse', 'origin/main']);
}

function readPullRequest(number) {
  const json = run('gh', [
    'pr',
    'view',
    String(number),
    '--repo',
    REPOSITORY,
    '--json',
    'baseRefName,baseRefOid,headRefName,headRefOid,files,isDraft,mergeable,number,state,title,url',
  ]);
  const pullRequest = JSON.parse(json);
  const files = Array.isArray(pullRequest.files) ? pullRequest.files : [];
  return {
    baseRefName: pullRequest.baseRefName,
    baseRefOid: pullRequest.baseRefOid,
    snapshotBaseMainSha: CURRENT_MAIN_SHA,
    headRefName: pullRequest.headRefName,
    headRefOid: pullRequest.headRefOid,
    file_count: files.length,
    isDraft: pullRequest.isDraft,
    mergeable: pullRequest.mergeable,
    number: pullRequest.number,
    paths: files.map((file) => file.path).filter((value) => typeof value === 'string').sort(),
    state: pullRequest.state,
    title: pullRequest.title,
    url: pullRequest.url,
    safe_read_only: true,
    merge_executed: false,
    secrets_included: false,
    captured_at_utc: CAPTURED_AT_UTC,
  };
}

const CURRENT_MAIN_SHA = readCurrentMainSha();
const CAPTURED_AT_UTC = new Date().toISOString();
const records = CANDIDATE_PRS.map(readPullRequest);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(
  OUTPUT,
  `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  'utf8',
);

console.log(JSON.stringify({
  ok: true,
  output: path.relative(process.cwd(), OUTPUT),
  candidate_count: records.length,
  snapshot_base_main_sha: CURRENT_MAIN_SHA,
  captured_at_utc: CAPTURED_AT_UTC,
  safe_read_only: true,
  merge_executed: false,
  secrets_included: false,
}, null, 2));
