import fs from "node:fs";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u;

function parseArgs(argv) {
  const options = { earliest: null, headSha: null, event: null, includeActionRequired: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--include-action-required") {
      options.includeActionRequired = true;
      continue;
    }
    if (!["--earliest", "--head-sha", "--event"].includes(value)) {
      throw new Error(`Unknown selector option: ${value}`);
    }
    const next = argv[index + 1];
    if (!next) throw new Error(`Missing value for ${value}`);
    const optionKey = { "--earliest": "earliest", "--head-sha": "headSha", "--event": "event" }[value];
    options[optionKey] = next;
    index += 1;
  }
  if (options.headSha && !SHA_PATTERN.test(options.headSha)) {
    throw new Error("--head-sha must be a lowercase 40-character SHA");
  }
  if (options.earliest && Number.isNaN(Date.parse(options.earliest))) {
    throw new Error("--earliest must be an ISO timestamp");
  }
  return options;
}

function isValidRunId(value) {
  return RUN_ID_PATTERN.test(String(value ?? ""));
}

function runTimestamp(run) {
  const timestamp = Date.parse(run?.createdAt ?? "");
  return Number.isNaN(timestamp) ? -1 : timestamp;
}

function compareRuns(left, right) {
  const timestampDelta = runTimestamp(left) - runTimestamp(right);
  if (timestampDelta !== 0) return timestampDelta;
  return Number(left.databaseId) - Number(right.databaseId);
}

/**
 * Select one exact-head run. A terminal success is always preferred to a
 * newer queued run so a duplicate dispatch cannot hide a valid result.
 */
export function selectPromotionRun(runs, {
  earliest = null,
  headSha = null,
  event = null,
  includeActionRequired = false,
} = {}) {
  if (!Array.isArray(runs)) throw new TypeError("runs must be an array");
  if (headSha && !SHA_PATTERN.test(headSha)) throw new Error("headSha must be a lowercase 40-character SHA");
  const earliestTimestamp = earliest ? Date.parse(earliest) : null;
  if (earliest && Number.isNaN(earliestTimestamp)) throw new Error("earliest must be an ISO timestamp");

  const candidates = runs
    .filter((run) => isValidRunId(run?.databaseId))
    .filter((run) => !headSha || run.headSha === headSha)
    .filter((run) => !event || run.event === event)
    .filter((run) => runTimestamp(run) >= 0)
    .filter((run) => earliestTimestamp === null || runTimestamp(run) >= earliestTimestamp)
    .filter((run) => {
      if (run.status !== "completed") return true;
      if (run.conclusion === "success") return true;
      return includeActionRequired && run.conclusion === "action_required";
    })
    .sort(compareRuns);

  const terminalSuccess = candidates.filter((run) => run.status === "completed" && run.conclusion === "success");
  return terminalSuccess.at(-1) ?? candidates.at(-1) ?? null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = fs.readFileSync(0, "utf8");
  const runs = JSON.parse(input);
  const selected = selectPromotionRun(runs, options);
  if (selected) process.stdout.write(`${selected.databaseId}\n`);
}

if (process.argv[1]?.endsWith("production-promotion-run-selector.mjs")) main();
